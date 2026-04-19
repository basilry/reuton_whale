from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
from unittest.mock import call

import src.pipeline.run_all as run_all_module

_KST = ZoneInfo("Asia/Seoul")


class FakeSheets:
    def __init__(self, *, duplicates: set[str] | None = None) -> None:
        self.duplicates = duplicates or set()
        self.service_health_entries: list[dict] = []
        self.checked_jobs: list[str] = []

    def has_logged_run_in_window(
        self,
        *,
        run_type: str,
        window_start,
        window_end,
        statuses,
    ) -> bool:
        self.checked_jobs.append(run_type)
        return run_type in self.duplicates

    def append_service_health(self, entry: dict) -> None:
        self.service_health_entries.append(entry)


def _kst_datetime(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=_KST)


def test_due_job_names_midnight_window():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 20, 0, 0))

    assert due == ["signals", "curated_balance", "news_rss", "broadcast_periodic", "stories", "brief"]


def test_due_job_names_jitter_snaps_to_previous_slot():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 20, 0, 1))

    assert due == ["signals", "curated_balance", "news_rss", "broadcast_periodic", "stories", "brief"]


def test_due_job_names_brief_runs_every_hour_boundary():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 20, 13, 1))

    assert due == ["signals", "curated_balance", "news_rss", "broadcast_periodic", "brief"]


def test_due_job_names_tuesday_weekly_trend_window():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 21, 8, 1))

    assert due == ["signals", "curated_balance", "news_rss", "broadcast_periodic", "brief", "weekly_trend"]


def test_due_job_names_channel_health_window():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 20, 9, 16))

    assert due == ["signals", "curated_balance", "news_rss", "broadcast_periodic", "channel_health"]


def test_run_all_executes_snapped_slot_for_non_boundary_minute():
    calls: list[str] = []
    sheets = FakeSheets()

    def _record(name: str):
        def _runner():
            calls.append(name)
            return {"status": "completed", "details": f"runner={name}"}

        return _runner

    with patch.object(run_all_module, "run_signals_pipeline", side_effect=_record("signals")), patch.object(
        run_all_module, "run_curated_balance_refresh", side_effect=_record("curated_balance")
    ), patch.object(
        run_all_module, "run_news_rss_refresh", side_effect=_record("news_rss")
    ), patch.object(
        run_all_module, "run_broadcast_periodic", side_effect=_record("broadcast_periodic")
    ), patch.object(
        run_all_module, "run_brief_pipeline", side_effect=_record("brief")
    ), patch.object(
        run_all_module, "run_broadcast_daily", side_effect=_record("broadcast_daily")
    ):
        summary = run_all_module.run_all(
            now=_kst_datetime(2026, 4, 20, 9, 5),
            sheets=sheets,
        )

    assert summary["status"] == "completed"
    assert summary["due_jobs"] == [
        "signals",
        "curated_balance",
        "news_rss",
        "broadcast_periodic",
        "brief",
        "broadcast_daily",
    ]
    assert summary["executed_jobs"] == [
        "signals",
        "curated_balance",
        "news_rss",
        "broadcast_periodic",
        "brief",
        "broadcast_daily",
    ]
    assert summary["skipped_jobs"] == {}
    assert summary["failed_jobs"] == {}
    assert calls == [
        "signals",
        "curated_balance",
        "news_rss",
        "broadcast_periodic",
        "brief",
        "broadcast_daily",
    ]
    summary_entry = sheets.service_health_entries[-1]
    assert summary_entry["service"] == "pipeline.run_all"
    assert summary_entry["job_name"] == "dispatcher"
    assert summary_entry["processed_count"] == 6
    assert summary_entry["lag_seconds"] == 300
    assert summary_entry["duration_ms"] >= 0
    assert summary_entry["last_success_at"]
    assert summary_entry["last_failure_at"] == ""


def test_run_all_continues_after_individual_job_failure():
    calls: list[str] = []
    sheets = FakeSheets()

    def _record(name: str):
        def _runner():
            calls.append(name)
            return {"status": "completed", "details": f"runner={name}"}

        return _runner

    def _failing_signals():
        calls.append("signals")
        raise RuntimeError("signals boom")

    with patch.object(run_all_module, "run_signals_pipeline", side_effect=_failing_signals), patch.object(
        run_all_module, "run_curated_balance_refresh", side_effect=_record("curated_balance")
    ), patch.object(
        run_all_module, "run_news_rss_refresh", side_effect=_record("news_rss")
    ), patch.object(
        run_all_module, "run_broadcast_periodic", side_effect=_record("broadcast_periodic")
    ), patch.object(
        run_all_module, "run_brief_pipeline", side_effect=_record("brief")
    ), patch.object(
        run_all_module, "_run_weekly_trend_job", side_effect=_record("weekly_trend")
    ):
        summary = run_all_module.run_all(now=_kst_datetime(2026, 4, 21, 8, 1), sheets=sheets)

    assert calls == ["signals", "curated_balance", "news_rss", "broadcast_periodic", "brief", "weekly_trend"]
    assert summary["status"] == "completed_with_errors"
    assert summary["executed_jobs"] == [
        "curated_balance",
        "news_rss",
        "broadcast_periodic",
        "brief",
        "weekly_trend",
    ]
    assert summary["failed_jobs"] == {"signals": "signals boom"}
    signal_entry = next(
        entry for entry in sheets.service_health_entries
        if entry["service"] == "pipeline.signals"
    )
    assert signal_entry["job_name"] == "signals"
    assert signal_entry["last_success_at"] == ""
    assert signal_entry["last_failure_at"]
    assert signal_entry["source_name"] == "etherscan+solscan+tg_whale_events"


def test_run_all_skips_duplicate_jobs_for_same_slot():
    sheets = FakeSheets(
        duplicates={"signals", "curated_balance", "news_rss", "broadcast_periodic", "brief", "weekly_trend"}
    )

    with patch.object(run_all_module, "run_signals_pipeline") as signals, patch.object(
        run_all_module, "run_curated_balance_refresh"
    ) as curated, patch.object(
        run_all_module, "run_news_rss_refresh"
    ) as news, patch.object(
        run_all_module, "run_broadcast_periodic"
    ) as periodic, patch.object(
        run_all_module, "run_brief_pipeline"
    ) as brief, patch.object(
        run_all_module, "_run_weekly_trend_job"
    ) as weekly:
        summary = run_all_module.run_all(now=_kst_datetime(2026, 4, 21, 8, 1), sheets=sheets)

    assert summary["status"] == "skipped_duplicate"
    assert summary["executed_jobs"] == []
    assert summary["skipped_jobs"] == {
        "signals": "duplicate_slot",
        "curated_balance": "duplicate_slot",
        "news_rss": "duplicate_slot",
        "broadcast_periodic": "duplicate_slot",
        "brief": "duplicate_slot",
        "weekly_trend": "duplicate_slot",
    }
    assert summary["failed_jobs"] == {}
    signals.assert_not_called()
    curated.assert_not_called()
    news.assert_not_called()
    periodic.assert_not_called()
    brief.assert_not_called()
    weekly.assert_not_called()
    assert sheets.service_health_entries[-1]["status"] == "degraded"


def test_run_all_publishes_success_for_news_and_watchlist_only():
    calls: list[str] = []
    sheets = FakeSheets()

    def _record(name: str, *, status: str = "completed"):
        def _runner():
            calls.append(name)
            return {
                "status": status,
                "details": f"runner={name}",
                "run_id": f"{name}_20260420_000000",
                "finished_at": "2026-04-20T00:00:05+00:00",
            }

        return _runner

    with patch.object(run_all_module, "run_signals_pipeline", side_effect=_record("signals")), patch.object(
        run_all_module, "run_curated_balance_refresh", side_effect=_record("curated_balance")
    ), patch.object(
        run_all_module, "run_news_rss_refresh", side_effect=_record("news_rss")
    ), patch.object(
        run_all_module, "run_broadcast_periodic", side_effect=_record("broadcast_periodic")
    ), patch.object(
        run_all_module, "run_brief_pipeline", side_effect=_record("brief")
    ), patch.object(
        run_all_module, "run_broadcast_daily", side_effect=_record("broadcast_daily")
    ), patch.object(run_all_module, "publish_success_event") as publish_success_event:
        summary = run_all_module.run_all(
            now=_kst_datetime(2026, 4, 20, 9, 5),
            sheets=sheets,
        )

    assert summary["status"] == "completed"
    assert calls == [
        "signals",
        "curated_balance",
        "news_rss",
        "broadcast_periodic",
        "brief",
        "broadcast_daily",
    ]
    assert publish_success_event.call_args_list == [
        call(
            section="watchlist",
            pipeline="curated_balance",
            result={
                "status": "completed",
                "details": "runner=curated_balance",
                "run_id": "curated_balance_20260420_000000",
                "finished_at": "2026-04-20T00:00:05+00:00",
            },
            slot_key="20260420T0900",
        ),
        call(
            section="news",
            pipeline="news_rss",
            result={
                "status": "completed",
                "details": "runner=news_rss",
                "run_id": "news_rss_20260420_000000",
                "finished_at": "2026-04-20T00:00:05+00:00",
            },
            slot_key="20260420T0900",
        )
    ]


def test_run_all_skips_publish_for_non_completed_results():
    sheets = FakeSheets()

    def _record(name: str, *, status: str = "completed"):
        return {
            "status": status,
            "details": f"runner={name}",
            "run_id": f"{name}_20260420_000000",
            "finished_at": "2026-04-20T00:00:05+00:00",
        }

    with patch.object(run_all_module, "run_signals_pipeline", return_value=_record("signals")), patch.object(
        run_all_module, "run_curated_balance_refresh", return_value=_record("curated_balance")
    ), patch.object(
        run_all_module, "run_news_rss_refresh", return_value=_record("news_rss", status="completed_with_errors")
    ), patch.object(
        run_all_module, "run_broadcast_periodic", return_value=_record("broadcast_periodic")
    ), patch.object(
        run_all_module, "run_brief_pipeline", return_value=_record("brief")
    ), patch.object(
        run_all_module, "run_broadcast_daily", return_value=_record("broadcast_daily")
    ), patch.object(run_all_module, "publish_success_event") as publish_success_event:
        run_all_module.run_all(
            now=_kst_datetime(2026, 4, 20, 9, 5),
            sheets=sheets,
        )

    assert publish_success_event.call_args_list == [
        call(
            section="watchlist",
            pipeline="curated_balance",
            result={
                "status": "completed",
                "details": "runner=curated_balance",
                "run_id": "curated_balance_20260420_000000",
                "finished_at": "2026-04-20T00:00:05+00:00",
            },
            slot_key="20260420T0900",
        )
    ]
