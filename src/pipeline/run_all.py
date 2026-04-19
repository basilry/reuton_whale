from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import time
from typing import Callable
from zoneinfo import ZoneInfo

from src.ingestion.curated_balance_refresh import run_curated_balance_refresh
from src.ingestion.news_rss import run_news_rss_refresh
from src.notify.pipeline_events import publish_success_event
from src.observability.service_health import (
    append_service_heartbeat,
    build_heartbeat_key,
    pipeline_status_to_health,
)
from src.pipeline.brief import run_brief_pipeline
from src.pipeline.broadcast_daily import run_broadcast_daily
from src.pipeline.broadcast_periodic import run_broadcast_periodic
from src.pipeline.channel_health import run_channel_health
from src.pipeline.common import build_sheets_client, load_pipeline_env
from src.pipeline.signals import run_signals_pipeline
from src.pipeline.stories import run_stories_pipeline
from src.utils.logger import get_logger
from src.utils.errors import StorageError

logger = get_logger("pipeline.run_all")
_KST = ZoneInfo("Asia/Seoul")
_SLOT_WIDTH_MINUTES = 15
_TERMINAL_RUN_STATUSES = {
    "completed",
    "completed_with_errors",
    "completed_empty",
    "skipped_empty",
    "skipped_inactive",
    "skipped_window",
    "skipped_budget",
}
_PUBLISHABLE_RUN_ALL_SECTIONS = {
    "news_rss": "news",
    "curated_balance": "watchlist",
}
_JOB_SOURCE_NAMES = {
    "signals": "etherscan+solscan+tg_whale_events",
    "curated_balance": "curated_wallets",
    "news_rss": "rss_feeds",
    "broadcast_periodic": "signals+transactions+telegram",
    "stories": "signals+llm",
    "brief": "signals+transactions+llm",
    "broadcast_daily": "daily_brief+telegram",
    "channel_health": "telegram_api",
    "weekly_trend": "signals+transactions",
}


@dataclass(frozen=True)
class DispatchSlot:
    current_utc: datetime
    current_kst: datetime
    slot_start_kst: datetime
    slot_end_kst: datetime
    slot_start_utc: datetime
    slot_end_utc: datetime

    @property
    def minute(self) -> int:
        return self.slot_start_kst.minute

    @property
    def hour(self) -> int:
        return self.slot_start_kst.hour

    @property
    def weekday(self) -> int:
        return self.slot_start_kst.weekday()

    @property
    def heartbeat_key(self) -> str:
        return self.slot_start_kst.strftime("%Y%m%dT%H%M")


def _run_weekly_trend_job() -> dict[str, object]:
    from scripts.run_weekly_trend import run_weekly_trend

    return run_weekly_trend()


def _normalize_now(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current


def _resolve_dispatch_slot(now: datetime | None = None) -> DispatchSlot:
    current_utc = _normalize_now(now).astimezone(timezone.utc)
    current_kst = current_utc.astimezone(_KST)
    slot_minute = (current_kst.minute // _SLOT_WIDTH_MINUTES) * _SLOT_WIDTH_MINUTES
    slot_start_kst = current_kst.replace(
        minute=slot_minute,
        second=0,
        microsecond=0,
    )
    slot_end_kst = slot_start_kst + timedelta(minutes=_SLOT_WIDTH_MINUTES)
    return DispatchSlot(
        current_utc=current_utc,
        current_kst=current_kst,
        slot_start_kst=slot_start_kst,
        slot_end_kst=slot_end_kst,
        slot_start_utc=slot_start_kst.astimezone(timezone.utc),
        slot_end_utc=slot_end_kst.astimezone(timezone.utc),
    )


def due_job_names(now: datetime | None = None) -> list[str]:
    slot = _resolve_dispatch_slot(now)
    minute = slot.minute
    hour = slot.hour
    weekday = slot.weekday
    due = ["signals", "curated_balance", "news_rss", "broadcast_periodic"]
    if minute == 0 and hour in {0, 6, 12, 18}:
        due.append("stories")
    if minute == 0:
        due.append("brief")
    if minute == 0 and hour == 9:
        due.append("broadcast_daily")
    if minute == 15 and hour == 9:
        due.append("channel_health")
    if minute == 0 and hour == 8 and weekday == 1:
        due.append("weekly_trend")
    return due


def _job_runners() -> dict[str, Callable[[], object]]:
    return {
        "signals": run_signals_pipeline,
        "curated_balance": run_curated_balance_refresh,
        "news_rss": run_news_rss_refresh,
        "broadcast_periodic": run_broadcast_periodic,
        "stories": run_stories_pipeline,
        "brief": run_brief_pipeline,
        "broadcast_daily": run_broadcast_daily,
        "channel_health": run_channel_health,
        "weekly_trend": _run_weekly_trend_job,
    }


def _ensure_sheets_client(sheets=None):
    if sheets is not None:
        return sheets
    env = load_pipeline_env()
    return build_sheets_client(env)


def _should_skip_duplicate_job(sheets, job_name: str, slot: DispatchSlot) -> bool:
    try:
        return sheets.has_logged_run_in_window(
            run_type=job_name,
            window_start=slot.slot_start_utc,
            window_end=slot.slot_end_utc,
            statuses=_TERMINAL_RUN_STATUSES,
        )
    except StorageError as exc:
        logger.warning(
            "Duplicate guard read failed job=%s slot=%s: %s. Continuing without skip.",
            job_name,
            slot.heartbeat_key,
            exc,
        )
        return False


def _processed_count(outcome: object) -> int | None:
    if not isinstance(outcome, dict):
        return None
    for key in (
        "processed_count",
        "transactions_count",
        "items_new",
        "items_fetched",
        "generated",
        "feeds_ok",
        "member_count",
    ):
        value = outcome.get(key)
        if value in (None, ""):
            continue
        try:
            return int(float(str(value)))
        except (TypeError, ValueError):
            continue
    return None


def _record_job_heartbeat(
    sheets,
    job_name: str,
    slot: DispatchSlot,
    outcome: object,
    *,
    error: str = "",
    duration_ms: int | None = None,
    lag_seconds: int | None = None,
) -> None:
    status = "ok"
    run_status: object = None
    details: object = outcome
    processed_count = None
    observed_at: datetime | str = slot.current_utc
    if isinstance(outcome, dict):
        run_status = outcome.get("status")
        status = pipeline_status_to_health(run_status)
        details = dict(outcome)
        processed_count = _processed_count(outcome)
        observed_at = outcome.get("finished_at") or slot.current_utc
    elif error:
        run_status = "error"
        status = "error"
        details = {"error": error}

    append_service_heartbeat(
        sheets,
        service=f"pipeline.{job_name}",
        component="pipeline",
        status=status,
        run_status=run_status,
        heartbeat_key=build_heartbeat_key(job_name, slot.heartbeat_key),
        details=details,
        error=error,
        observed_at=observed_at,
        job_name=job_name,
        processed_count=processed_count,
        lag_seconds=lag_seconds,
        duration_ms=duration_ms,
        source_name=_JOB_SOURCE_NAMES.get(job_name, ""),
    )


def _publish_run_all_success(job_name: str, outcome: object, slot: DispatchSlot) -> None:
    section = _PUBLISHABLE_RUN_ALL_SECTIONS.get(job_name)
    if section is None or not isinstance(outcome, dict):
        return
    if str(outcome.get("status") or "").strip() != "completed":
        return

    publish_success_event(
        section=section,
        pipeline=job_name,
        result=outcome,
        slot_key=slot.heartbeat_key,
    )


def run_all(*, now: datetime | None = None, sheets=None) -> dict[str, object]:
    current = _normalize_now(now)
    slot = _resolve_dispatch_slot(current)
    run_started_at = time.perf_counter()
    due = due_job_names(current)
    summary: dict[str, object] = {
        "status": "completed",
        "scheduled_at_utc": current.astimezone(timezone.utc).isoformat(),
        "scheduled_at_kst": current.astimezone(_KST).isoformat(),
        "slot_start_kst": slot.slot_start_kst.isoformat(),
        "slot_key": slot.heartbeat_key,
        "due_jobs": due,
        "executed_jobs": [],
        "skipped_jobs": {},
        "failed_jobs": {},
    }
    runners = _job_runners()
    sheets_client = _ensure_sheets_client(sheets)
    executed: list[str] = []
    skipped: dict[str, str] = {}
    failed: dict[str, str] = {}

    for job_name in due:
        if _should_skip_duplicate_job(sheets_client, job_name, slot):
            skipped[job_name] = "duplicate_slot"
            logger.info(
                "Skipping duplicate scheduled job name=%s slot=%s",
                job_name,
                slot.slot_start_kst.isoformat(),
            )
            continue

        runner = runners[job_name]
        started_at = time.perf_counter()
        observed_now = slot.current_utc if now is not None else datetime.now(timezone.utc)
        lag_seconds = max(0, int((observed_now - slot.slot_start_utc).total_seconds()))
        try:
            outcome = runner()
            executed.append(job_name)
            _publish_run_all_success(job_name, outcome, slot)
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            _record_job_heartbeat(
                sheets_client,
                job_name,
                slot,
                outcome,
                duration_ms=duration_ms,
                lag_seconds=lag_seconds,
            )
        except Exception as exc:
            failed[job_name] = str(exc)
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            _record_job_heartbeat(
                sheets_client,
                job_name,
                slot,
                None,
                error=str(exc),
                duration_ms=duration_ms,
                lag_seconds=lag_seconds,
            )
            logger.exception("Scheduled job failed name=%s", job_name)

    summary["executed_jobs"] = executed
    summary["skipped_jobs"] = skipped
    summary["failed_jobs"] = failed
    if failed:
        summary["status"] = "completed_with_errors"
    elif skipped and not executed:
        summary["status"] = "skipped_duplicate"

    total_duration_ms = int((time.perf_counter() - run_started_at) * 1000)
    summary_observed_at = slot.current_utc if now is not None else datetime.now(timezone.utc)
    append_service_heartbeat(
        sheets_client,
        service="pipeline.run_all",
        component="orchestrator",
        status=pipeline_status_to_health(summary["status"]),
        run_status=summary["status"],
        heartbeat_key=build_heartbeat_key("run_all", slot.heartbeat_key),
        details={
            "due_jobs": due,
            "executed_jobs": executed,
            "skipped_jobs": skipped,
            "failed_jobs": list(failed),
        },
        observed_at=summary_observed_at,
        job_name="dispatcher",
        processed_count=len(executed),
        lag_seconds=max(0, int((summary_observed_at - slot.slot_start_utc).total_seconds())),
        duration_ms=total_duration_ms,
    )
    logger.info(
        "run_all finished status=%s due=%s executed=%s skipped=%s failed=%s",
        summary["status"],
        due,
        executed,
        list(skipped),
        list(failed),
    )
    return summary


def main() -> None:
    summary = run_all()
    if summary["failed_jobs"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
