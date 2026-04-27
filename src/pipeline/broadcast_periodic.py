from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.channel.message_formatter import format_event_alert_message, format_market_pulse_message
from src.channel.message_planner import FallbackSnapshot, plan_periodic_channel_message
from src.channel.policy import DEFAULT_MARKET_PULSE_MIN_INTERVAL
from src.notify.telegram_broadcast import TelegramBroadcastAdapter
from src.observability.service_health import append_service_heartbeat
from src.pipeline.common import build_sheets_client, init_run_result, load_pipeline_env
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
_BROADCAST_LOG_LOOKBACK = timedelta(hours=24)
_FALLBACK_NEWS_LOOKBACK = timedelta(hours=6)


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


def _build_periodic_message(
    *,
    slot_start_kst: datetime,
    signal_rows: list[dict],
    transaction_rows: list[dict],
) -> str:
    return format_event_alert_message(
        slot_start_kst=slot_start_kst,
        signal_rows=signal_rows,
        transaction_rows=transaction_rows,
    )


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


def _load_fallback_snapshot(sheets, *, now: datetime) -> FallbackSnapshot:
    daily_brief = None
    get_latest_daily_brief = getattr(sheets, "get_latest_daily_brief", None)
    if callable(get_latest_daily_brief):
        try:
            daily_brief = get_latest_daily_brief()
        except StorageError as exc:
            logger.warning("Periodic fallback daily_brief read failed: %s", exc)

    news_rows: list[dict] = []
    list_news_feed = getattr(sheets, "list_news_feed", None)
    if callable(list_news_feed):
        try:
            news_rows = list_news_feed(since=now - _FALLBACK_NEWS_LOOKBACK, limit=5)
        except StorageError as exc:
            logger.warning("Periodic fallback news_feed read failed: %s", exc)

    market_snapshot = _load_market_snapshot_fallback(sheets, now=now)
    return FallbackSnapshot.from_parts(
        daily_brief=daily_brief,
        news_rows=news_rows,
        market_snapshot=market_snapshot,
    )


def _load_market_snapshot_fallback(sheets, *, now: datetime) -> dict | None:
    get_latest_market_snapshot = getattr(sheets, "get_latest_market_snapshot", None)
    if callable(get_latest_market_snapshot):
        try:
            snapshot = get_latest_market_snapshot()
            return dict(snapshot) if snapshot else None
        except StorageError as exc:
            logger.warning("Periodic fallback market snapshot read failed: %s", exc)

    list_market_snapshots = getattr(sheets, "list_market_snapshots", None)
    if not callable(list_market_snapshots):
        return None
    try:
        rows = list_market_snapshots(since=now - _FALLBACK_NEWS_LOOKBACK, limit=10)
    except TypeError:
        try:
            rows = list_market_snapshots()
        except StorageError as exc:
            logger.warning("Periodic fallback market snapshots read failed: %s", exc)
            return None
    except StorageError as exc:
        logger.warning("Periodic fallback market snapshots read failed: %s", exc)
        return None
    return dict(rows[-1]) if rows else None


def _list_recent_broadcast_rows(sheets, *, now: datetime) -> list[dict]:
    try:
        return sheets.list_broadcast_log(kind=None, since=now - _BROADCAST_LOG_LOOKBACK, limit=200)
    except StorageError as exc:
        logger.warning("Periodic channel cadence log read failed: %s", exc)
        return []


def _list_candidate_transactions(sheets, *, since: datetime, limit: int) -> list[dict]:
    list_recent_observed = getattr(sheets, "list_recent_observed_transactions", None)
    if callable(list_recent_observed):
        try:
            return list_recent_observed(since=since, limit=limit)
        except StorageError as exc:
            logger.warning(
                "Periodic observed transaction read failed, falling back to created_at window: %s",
                exc,
            )
    return sheets.list_transactions(since=since, limit=limit)


def _append_attempt_log(sheets, attempt, metadata: dict[str, object]) -> None:
    try:
        entry = attempt.to_sheet_row()
        entry.update(metadata)
        sheets.append_broadcast_log(entry)
    except Exception as exc:
        logger.warning(
            "Failed to persist broadcast log kind=%s status=%s: %s",
            getattr(attempt, "kind", ""),
            getattr(attempt, "status", ""),
            exc,
        )


def _quiet_skip_status(reason: str) -> str:
    if reason == "market_pulse_interval_not_elapsed":
        return "skipped_window"
    return "skipped_empty"


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
    transaction_rows = _list_candidate_transactions(sheets, since=window_start, limit=50)
    slot_key = slot_start_kst.strftime("%Y%m%dT%H%M")
    dedup_key = f"broadcast_periodic:{slot_key}"

    fallback_snapshot = FallbackSnapshot()
    recent_broadcast_rows: list[dict] = []
    if not signal_rows and not transaction_rows:
        fallback_snapshot = _load_fallback_snapshot(sheets, now=now)
        recent_broadcast_rows = _list_recent_broadcast_rows(sheets, now=now)

    plan = plan_periodic_channel_message(
        now=now,
        signal_rows=signal_rows,
        transaction_rows=transaction_rows,
        fallback_snapshot=fallback_snapshot,
        recent_broadcast_rows=recent_broadcast_rows,
        market_pulse_min_interval=DEFAULT_MARKET_PULSE_MIN_INTERVAL,
    )
    plan_metadata = plan.to_broadcast_log_metadata()

    if not plan.should_broadcast:
        skip_status = _quiet_skip_status(plan.reason)
        details = (
            f"decision={plan.decision}; reason={plan.reason}; "
            f"fallback={plan.fallback_source or 'none'}; "
            f"signals={plan.candidate_signal_count}; "
            f"transactions={plan.candidate_transaction_count}; recent_window=15m"
        )
        sheets.append_broadcast_log(
            {
                "ts": now_iso(),
                "kind": "broadcast_periodic",
                "dedup_key": dedup_key,
                "chat_id": env.telegram_broadcast_chat,
                "message_id": "",
                "status": skip_status,
                "error": details,
                "message_length": 0,
                "content_hash": "",
                "signal_count": plan.candidate_signal_count,
                "transaction_count": plan.candidate_transaction_count,
                "slot_key": slot_key,
                "delivery_mode": "skipped",
                **plan_metadata,
            }
        )
        result.update(
            status=skip_status,
            finished_at=now_iso(),
            errors="[]",
            details=details,
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(
            sheets,
            result,
            processed_count=plan.candidate_signal_count + plan.candidate_transaction_count,
        )
        return result

    broadcaster = TelegramBroadcastAdapter(
        token=env.telegram_broadcast_token or env.telegram_token,
        chat_id=env.telegram_broadcast_chat,
        storage=None,
        enabled=env.telegram_broadcast_enabled,
        dry_run=env.telegram_broadcast_dry_run,
        dry_run_reason="TELEGRAM_BROADCAST_DRY_RUN is true",
    )
    if plan.decision == "event_alert":
        message_body = _build_periodic_message(
            slot_start_kst=slot_start_kst,
            signal_rows=list(plan.signal_rows),
            transaction_rows=list(plan.transaction_rows),
        )
    else:
        message_body = format_market_pulse_message(
            now_kst=now.astimezone(_KST),
            fallback=plan.fallback,
        )
    message = _clip_periodic_message(message_body)
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
                "signal_count": plan.candidate_signal_count,
                "transaction_count": plan.candidate_transaction_count,
                "slot_key": slot_key,
                "delivery_mode": "skipped",
                **plan_metadata,
            }
        )
        result.update(
            status="skipped_duplicate_content",
            finished_at=now_iso(),
            transactions_count=plan.candidate_transaction_count,
            errors="[]",
            details=(
                f"decision={plan.decision}; signals={plan.candidate_signal_count}; "
                f"transactions={plan.candidate_transaction_count}; duplicate_window=60m; "
                f"message_len={len(message)}"
            ),
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(
            sheets,
            result,
            channel_status="skipped_duplicate_content",
            processed_count=plan.candidate_signal_count + plan.candidate_transaction_count,
        )
        logger.info(
            "broadcast_periodic skipped duplicate content decision=%s signals=%d transactions=%d slot=%s",
            plan.decision,
            plan.candidate_signal_count,
            plan.candidate_transaction_count,
            slot_key,
        )
        return result

    attempt_metadata = {
        "message_length": len(message),
        "content_hash": content_hash,
        "signal_count": plan.candidate_signal_count,
        "transaction_count": plan.candidate_transaction_count,
        "slot_key": slot_key,
        **plan_metadata,
    }
    attempt = broadcaster.broadcast_text(
        text=message,
        kind="broadcast_periodic",
        dedup_key=dedup_key,
        metadata=attempt_metadata,
    )
    _append_attempt_log(sheets, attempt, plan_metadata)
    if attempt.status in {"failed", "skipped_unconfigured"}:
        errors.append(f"telegram_broadcast:{attempt.error}")

    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        transactions_count=plan.candidate_transaction_count,
        errors=json.dumps(errors, ensure_ascii=False),
        details=(
            f"decision={plan.decision}; reason={plan.reason}; "
            f"fallback={plan.fallback_source or 'none'}; "
            f"signals={plan.candidate_signal_count}; "
            f"transactions={plan.candidate_transaction_count}; "
            f"broadcast={attempt.status}; message_len={len(message)}"
        ),
    )
    sheets.log_run(result)
    _record_broadcast_heartbeat(
        sheets,
        result,
        channel_status=attempt.status,
        processed_count=plan.candidate_signal_count + plan.candidate_transaction_count,
    )
    logger.info(
        "broadcast_periodic finished status=%s decision=%s signals=%d transactions=%d broadcast=%s",
        result["status"],
        plan.decision,
        plan.candidate_signal_count,
        plan.candidate_transaction_count,
        attempt.status,
    )
    return result


def main() -> None:
    run_broadcast_periodic()


if __name__ == "__main__":
    main()
