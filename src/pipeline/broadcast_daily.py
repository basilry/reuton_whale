from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.distributor.telegram_bot import WhaleScopeBot
from src.notify.telegram_broadcast import TelegramBroadcastAdapter
from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
from src.pipeline.common import (
    build_sheets_client,
    coerce_json_list,
    init_run_result,
    load_pipeline_env,
    safe_float,
)
from src.storage.queries import now_iso
from src.utils.logger import get_logger

logger = get_logger("pipeline.broadcast_daily")
_KST = ZoneInfo("Asia/Seoul")
_TERMINAL_RUN_STATUSES = {
    "completed",
    "completed_with_errors",
    "completed_empty",
    "skipped_window",
    "skipped_budget",
}


def _is_broadcast_window(now: datetime) -> bool:
    current = now.astimezone(_KST)
    return current.hour == 9


def _should_force_broadcast() -> bool:
    return (
        os.getenv("FORCE_BROADCAST_DAILY", "").strip().lower() in {"1", "true", "yes", "on"}
        or os.getenv("GITHUB_EVENT_NAME", "").strip() == "workflow_dispatch"
    )


def _broadcast_window(now: datetime) -> tuple[datetime, datetime]:
    current = now.astimezone(_KST)
    slot_start_kst = current.replace(hour=9, minute=0, second=0, microsecond=0)
    slot_end_kst = slot_start_kst + timedelta(minutes=15)
    return slot_start_kst.astimezone(timezone.utc), slot_end_kst.astimezone(timezone.utc)


def _record_broadcast_heartbeat(
    sheets,
    result: dict[str, object],
    *,
    subscriber_result: dict[str, int] | None = None,
    channel_status: str | None = None,
) -> None:
    append_service_heartbeat(
        sheets,
        service="pipeline.broadcast_daily",
        component="pipeline",
        status=pipeline_status_to_health(result.get("status")),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": result.get("status"),
            "details": result.get("details", ""),
        },
        error=result.get("errors", ""),
    )
    if subscriber_result is not None or channel_status is not None:
        append_service_heartbeat(
            sheets,
            service="telegram.broadcast",
            component="bot",
            status=pipeline_status_to_health(result.get("status")),
            heartbeat_key=str(result.get("run_id", "")),
            details={
                "channel_status": channel_status or "",
                "subscriber_result": subscriber_result or {},
            },
            error=result.get("errors", ""),
        )


def run_broadcast_daily(*, force: bool = False) -> dict[str, object]:
    result = init_run_result("broadcast_daily")
    errors: list[str] = []

    env = load_pipeline_env(require_telegram=True)
    sheets = build_sheets_client(env)
    now = datetime.now(timezone.utc)
    force = force or _should_force_broadcast()
    if not force and not _is_broadcast_window(now):
        result.update(
            status="skipped_window",
            finished_at=now_iso(),
            errors="[]",
            details="Outside KST 09:00 broadcast window",
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(sheets, result)
        return result

    window_start, window_end = _broadcast_window(now)
    if sheets.has_logged_run_in_window(
        run_type="broadcast_daily",
        window_start=window_start,
        window_end=window_end,
        statuses=_TERMINAL_RUN_STATUSES,
    ):
        result.update(
            status="skipped_duplicate",
            finished_at=now_iso(),
            errors="[]",
            details="Broadcast already completed for current KST 09:00 slot",
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(sheets, result)
        return result

    brief = sheets.get_latest_daily_brief()
    if not brief or not str(brief.get("summary", "")).strip():
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            errors="[]",
            details="No latest daily brief available",
        )
        sheets.log_run(result)
        _record_broadcast_heartbeat(sheets, result)
        return result

    date_value = str(brief.get("date", "")).strip() or now.astimezone(_KST).strftime("%Y-%m-%d")
    highlights = coerce_json_list(brief.get("highlights"))
    brief_text = str(brief.get("summary", "")).strip()
    broadcaster = TelegramBroadcastAdapter(
        token=env.telegram_broadcast_token or env.telegram_token,
        chat_id=env.telegram_broadcast_chat,
        storage=sheets,
        enabled=env.telegram_broadcast_enabled,
        dry_run=env.telegram_broadcast_dry_run,
        dry_run_reason="TELEGRAM_BROADCAST_DRY_RUN is true",
    )
    broadcast_attempt = broadcaster.broadcast_daily_brief(
        date=date_value,
        brief_text=brief_text,
        highlights=highlights,
        signal_count=int(safe_float(brief.get("alert_count"))),
        total_volume_usd=safe_float(brief.get("total_volume_usd")),
    )

    bot = WhaleScopeBot(env.telegram_token, sheets)
    bot.build()
    subscriber_result = {"sent": 0, "failed": 0, "blocked": 0}
    try:
        import asyncio

        subscriber_result = asyncio.run(bot.send_daily_brief(brief_text))
    except Exception as exc:
        errors.append(f"subscriber_delivery:{exc}")
        logger.error("Telegram subscriber delivery failed: %s", exc)

    details = (
        f"broadcast={broadcast_attempt.status}; "
        f"subscribers=sent={subscriber_result['sent']},failed={subscriber_result['failed']},blocked={subscriber_result['blocked']}"
    )
    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        errors=json.dumps(errors, ensure_ascii=False),
        details=details,
    )
    sheets.log_run(result)
    _record_broadcast_heartbeat(
        sheets,
        result,
        subscriber_result=subscriber_result,
        channel_status=broadcast_attempt.status,
    )
    return result


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run_broadcast_daily(force=args.force)


if __name__ == "__main__":
    main()
