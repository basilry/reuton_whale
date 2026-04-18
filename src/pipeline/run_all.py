from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from src.ingestion.curated_balance_refresh import run_curated_balance_refresh
from src.ingestion.news_rss import run_news_rss_refresh
from src.pipeline.brief import run_brief_pipeline
from src.pipeline.broadcast_daily import run_broadcast_daily
from src.pipeline.channel_health import run_channel_health
from src.pipeline.signals import run_signals_pipeline
from src.pipeline.stories import run_stories_pipeline
from src.utils.logger import get_logger

logger = get_logger("pipeline.run_all")
_KST = ZoneInfo("Asia/Seoul")


def _run_weekly_trend_job() -> dict[str, object]:
    from scripts.run_weekly_trend import run_weekly_trend

    return run_weekly_trend()


def _normalize_now(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current


def due_job_names(now: datetime | None = None) -> list[str]:
    current = _normalize_now(now).astimezone(_KST)
    minute = current.minute
    hour = current.hour
    weekday = current.weekday()

    if minute % 15 != 0:
        return []

    due = ["signals", "curated_balance"]
    if minute % 30 == 0:
        due.append("news_rss")
    if minute == 0 and hour in {0, 6, 12, 18}:
        due.append("stories")
    if minute == 0 and hour in {0, 8, 16}:
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
        "stories": run_stories_pipeline,
        "brief": run_brief_pipeline,
        "broadcast_daily": run_broadcast_daily,
        "channel_health": run_channel_health,
        "weekly_trend": _run_weekly_trend_job,
    }


def run_all(*, now: datetime | None = None) -> dict[str, object]:
    current = _normalize_now(now)
    due = due_job_names(current)
    summary: dict[str, object] = {
        "status": "noop" if not due else "completed",
        "scheduled_at_utc": current.astimezone(timezone.utc).isoformat(),
        "scheduled_at_kst": current.astimezone(_KST).isoformat(),
        "due_jobs": due,
        "executed_jobs": [],
        "failed_jobs": {},
    }
    if not due:
        logger.info("No scheduled jobs due at %s", summary["scheduled_at_kst"])
        return summary

    runners = _job_runners()
    executed: list[str] = []
    failed: dict[str, str] = {}

    for job_name in due:
        runner = runners[job_name]
        try:
            runner()
            executed.append(job_name)
        except Exception as exc:
            failed[job_name] = str(exc)
            logger.exception("Scheduled job failed name=%s", job_name)

    summary["executed_jobs"] = executed
    summary["failed_jobs"] = failed
    if failed:
        summary["status"] = "completed_with_errors"
    logger.info(
        "run_all finished status=%s due=%s executed=%s failed=%s",
        summary["status"],
        due,
        executed,
        list(failed),
    )
    return summary


def main() -> None:
    summary = run_all()
    if summary["failed_jobs"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
