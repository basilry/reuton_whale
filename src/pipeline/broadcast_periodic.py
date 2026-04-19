from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.notify.telegram_broadcast import TelegramBroadcastAdapter
from src.observability.service_health import append_service_heartbeat
from src.pipeline.common import build_sheets_client, init_run_result, load_pipeline_env, safe_float
from src.storage.queries import now_iso
from src.utils.logger import get_logger
from src.utils.errors import StorageError

logger = get_logger("pipeline.broadcast_periodic")
_KST = ZoneInfo("Asia/Seoul")
_SLOT_WIDTH_MINUTES = 15
_TERMINAL_RUN_STATUSES = {
    "completed",
    "completed_with_errors",
    "completed_empty",
    "skipped_empty",
    "skipped_budget",
    "skipped_window",
    "skipped_duplicate_content",
}
_PERIODIC_MESSAGE_MAX_LENGTH = 1500


def _format_compact_usd(value: float) -> str:
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:,.2f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.0f}"


def _slot_window(now: datetime) -> tuple[datetime, datetime, datetime]:
    current = now.astimezone(_KST)
    slot_minute = (current.minute // _SLOT_WIDTH_MINUTES) * _SLOT_WIDTH_MINUTES
    slot_start_kst = current.replace(minute=slot_minute, second=0, microsecond=0)
    slot_end_kst = slot_start_kst + timedelta(minutes=_SLOT_WIDTH_MINUTES)
    return (
        slot_start_kst.astimezone(timezone.utc),
        slot_end_kst.astimezone(timezone.utc),
        slot_start_kst,
    )


def _health_for_status(status: object) -> str:
    normalized = str(status or "").strip().lower()
    if normalized in {
        "completed",
        "completed_empty",
        "skipped_empty",
        "skipped_window",
        "skipped_budget",
        "skipped_duplicate_content",
    }:
        return "ok"
    if normalized in {"completed_with_errors", "skipped_duplicate"}:
        return "degraded"
    return "error"


def _owner_label(row: dict, prefix: str) -> str:
    return str(
        row.get(f"{prefix}_owner")
        or row.get(f"{prefix}_owner_type")
        or row.get(f"{prefix}_address")
        or "unknown"
    ).strip()


def _movement_label(row: dict) -> str:
    from_type = str(row.get("from_owner_type") or "").strip().lower()
    to_type = str(row.get("to_owner_type") or "").strip().lower()
    if from_type == "exchange" and to_type == "exchange":
        return "거래소 간 이동"
    if from_type == "exchange":
        return "거래소 유출"
    if to_type == "exchange":
        return "거래소 유입"
    return "지갑 간 이동"


def _transaction_sort_key(row: dict) -> tuple[float, float]:
    amount_usd = safe_float(row.get("amount_usd"))
    amount_token = safe_float(row.get("amount"))
    return (amount_usd, amount_token)


def _format_transaction_line(row: dict) -> str:
    symbol = str(row.get("symbol") or "UNKNOWN").strip().upper()
    amount_usd = safe_float(row.get("amount_usd"))
    if amount_usd > 0:
        amount_label = _format_compact_usd(amount_usd)
    else:
        amount_token = safe_float(row.get("amount"))
        if amount_token >= 100:
            amount_label = f"{amount_token:,.0f} {symbol}"
        else:
            amount_label = f"{amount_token:,.2f}".rstrip("0").rstrip(".")
            amount_label = f"{amount_label} {symbol}"
    return (
        f"• {symbol} · {amount_label} · {_movement_label(row)} · "
        f"{_owner_label(row, 'from')} → {_owner_label(row, 'to')}"
    )


def _format_signal_line(row: dict) -> str:
    severity = str(row.get("severity") or "info").strip().upper()
    summary = str(row.get("summary") or "").strip() or "시그널 요약 없음"
    rule = str(row.get("rule") or "signal").strip()
    source = str(row.get("source") or "").strip()
    meta = " · ".join(part for part in [severity, rule, source] if part)
    return f"• {summary}" if not meta else f"• {summary} ({meta})"


def _build_periodic_message(
    *,
    slot_start_kst: datetime,
    signal_rows: list[dict],
    transaction_rows: list[dict],
) -> str:
    lines = [
        "<b>WhaleScope Periodic Update</b>",
        f"<i>{slot_start_kst.strftime('%Y-%m-%d %H:%M')} KST · recent 15m</i>",
    ]

    if signal_rows:
        lines.extend(["", "<b>Signals</b>"])
        for row in signal_rows[:5]:
            lines.append(_format_signal_line(row))

    if transaction_rows:
        lines.extend(["", "<b>Transactions</b>"])
        ranked_rows = sorted(transaction_rows, key=_transaction_sort_key, reverse=True)[:5]
        for row in ranked_rows:
            lines.append(_format_transaction_line(row))

    total_volume = sum(safe_float(row.get("amount_usd")) for row in transaction_rows)
    lines.extend(
        [
            "",
            (
                f"<i>signals={len(signal_rows)} | tx={len(transaction_rows)} | "
                f"volume={_format_compact_usd(total_volume)}</i>"
            ),
        ]
    )
    return "\n".join(lines).strip()


def _clip_periodic_message(text: str, *, limit: int = _PERIODIC_MESSAGE_MAX_LENGTH) -> str:
    normalized = (text or "").strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: max(0, limit - 1)].rstrip()}…"


def _content_hash(text: str) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _logged_delivery_mode(row: dict) -> str:
    delivery_mode = str(row.get("delivery_mode") or "").strip().lower()
    if delivery_mode:
        return delivery_mode
    status = str(row.get("status") or "").strip().lower()
    if status == "sent":
        return "live"
    if status == "dry_run":
        return "dry_run"
    return "skipped"


def _has_recent_duplicate_content(
    sheets,
    *,
    kind: str,
    content_hash: str,
    since: datetime,
) -> bool:
    if not content_hash:
        return False
    rows = sheets.list_broadcast_log(kind=kind, since=since, limit=100)
    for row in reversed(rows):
        if str(row.get("content_hash") or "").strip() != content_hash:
            continue
        if _logged_delivery_mode(row) not in {"live", "dry_run"}:
            continue
        return True
    return False


def _record_broadcast_heartbeat(
    sheets,
    result: dict[str, object],
    *,
    channel_status: str = "",
    processed_count: int | None = None,
) -> None:
    health_status = _health_for_status(result.get("status"))
    append_service_heartbeat(
        sheets,
        service="pipeline.broadcast_periodic",
        component="pipeline",
        status=health_status,
        run_status=result.get("status"),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": result.get("status"),
            "details": result.get("details", ""),
        },
        error=result.get("errors", ""),
        observed_at=result.get("finished_at") or result.get("started_at"),
        processed_count=processed_count,
        source_name="signals+transactions+telegram",
    )
    if channel_status:
        append_service_heartbeat(
            sheets,
            service="telegram.broadcast.periodic",
            component="bot",
            status=health_status,
            run_status=result.get("status"),
            heartbeat_key=str(result.get("run_id", "")),
            details={
                "channel_status": channel_status,
            },
            error=result.get("errors", ""),
            observed_at=result.get("finished_at") or result.get("started_at"),
            processed_count=processed_count,
            source_name="telegram",
        )


def run_broadcast_periodic() -> dict[str, object]:
    result = init_run_result("broadcast_periodic")
    errors: list[str] = []

    env = load_pipeline_env()
    sheets = build_sheets_client(env)
    now = datetime.now(timezone.utc)
    window_start, window_end, slot_start_kst = _slot_window(now)

    duplicate_in_window = False
    try:
        duplicate_in_window = sheets.has_logged_run_in_window(
            run_type="broadcast_periodic",
            window_start=window_start,
            window_end=window_end,
            statuses=_TERMINAL_RUN_STATUSES,
        )
    except StorageError as exc:
        logger.warning("Periodic duplicate guard read failed: %s", exc)

    if duplicate_in_window:
        result.update(
            status="skipped_duplicate",
            finished_at=now_iso(),
            errors="[]",
            details="Periodic broadcast already completed for current 15m slot",
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(sheets, result, processed_count=0)
        return result

    signal_rows = sheets.list_signals(since=window_start, limit=20)
    transaction_rows = sheets.list_transactions(since=window_start, limit=50)
    slot_key = slot_start_kst.strftime("%Y%m%dT%H%M")
    dedup_key = f"broadcast_periodic:{slot_key}"
    if not signal_rows and not transaction_rows:
        sheets.append_broadcast_log(
            {
                "ts": now_iso(),
                "kind": "broadcast_periodic",
                "dedup_key": dedup_key,
                "chat_id": env.telegram_broadcast_chat,
                "message_id": "",
                "status": "skipped_empty",
                "error": "signals=0; transactions=0; recent_window=15m",
                "message_length": 0,
                "content_hash": "",
                "signal_count": 0,
                "transaction_count": 0,
                "slot_key": slot_key,
                "delivery_mode": "skipped",
            }
        )
        result.update(
            status="skipped_empty",
            finished_at=now_iso(),
            errors="[]",
            details="signals=0; transactions=0; recent_window=15m",
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(sheets, result, processed_count=0)
        return result

    broadcaster = TelegramBroadcastAdapter(
        token=env.telegram_broadcast_token or env.telegram_token,
        chat_id=env.telegram_broadcast_chat,
        storage=sheets,
        enabled=env.telegram_broadcast_enabled,
        dry_run=env.telegram_broadcast_dry_run,
        dry_run_reason="TELEGRAM_BROADCAST_DRY_RUN is true",
    )
    message = _clip_periodic_message(
        _build_periodic_message(
            slot_start_kst=slot_start_kst,
            signal_rows=signal_rows,
            transaction_rows=transaction_rows,
        )
    )
    content_hash = _content_hash(message)
    if _has_recent_duplicate_content(
        sheets,
        kind="broadcast_periodic",
        content_hash=content_hash,
        since=now - timedelta(hours=1),
    ):
        sheets.append_broadcast_log(
            {
                "ts": now_iso(),
                "kind": "broadcast_periodic",
                "dedup_key": dedup_key,
                "chat_id": env.telegram_broadcast_chat,
                "message_id": "",
                "status": "skipped_duplicate_content",
                "error": "matched previous content hash within 1h",
                "message_length": len(message),
                "content_hash": content_hash,
                "signal_count": len(signal_rows),
                "transaction_count": len(transaction_rows),
                "slot_key": slot_key,
                "delivery_mode": "skipped",
            }
        )
        result.update(
            status="skipped_duplicate_content",
            finished_at=now_iso(),
            transactions_count=len(transaction_rows),
            errors="[]",
            details=(
                f"signals={len(signal_rows)}; transactions={len(transaction_rows)}; "
                f"duplicate_window=60m; message_len={len(message)}"
            ),
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(
            sheets,
            result,
            channel_status="skipped_duplicate_content",
            processed_count=len(signal_rows) + len(transaction_rows),
        )
        logger.info(
            "broadcast_periodic skipped duplicate content signals=%d transactions=%d slot=%s",
            len(signal_rows),
            len(transaction_rows),
            slot_key,
        )
        return result

    attempt = broadcaster.broadcast_text(
        text=message,
        kind="broadcast_periodic",
        dedup_key=dedup_key,
        metadata={
            "message_length": len(message),
            "content_hash": content_hash,
            "signal_count": len(signal_rows),
            "transaction_count": len(transaction_rows),
            "slot_key": slot_key,
        },
    )
    if attempt.status in {"failed", "skipped_unconfigured"}:
        errors.append(f"telegram_broadcast:{attempt.error}")

    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        transactions_count=len(transaction_rows),
        errors=json.dumps(errors, ensure_ascii=False),
        details=(
            f"signals={len(signal_rows)}; transactions={len(transaction_rows)}; "
            f"broadcast={attempt.status}; message_len={len(message)}"
        ),
    )
    sheets.log_run(result)
    _record_broadcast_heartbeat(
        sheets,
        result,
        channel_status=attempt.status,
        processed_count=len(signal_rows) + len(transaction_rows),
    )
    logger.info(
        "broadcast_periodic finished status=%s signals=%d transactions=%d broadcast=%s",
        result["status"],
        len(signal_rows),
        len(transaction_rows),
        attempt.status,
    )
    return result


def main() -> None:
    run_broadcast_periodic()


if __name__ == "__main__":
    main()
