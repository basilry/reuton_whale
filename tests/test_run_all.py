from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch

import src.pipeline.run_all as run_all_module

_KST = ZoneInfo("Asia/Seoul")


def _kst_datetime(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=_KST)


def test_due_job_names_midnight_window():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 20, 0, 0))

    assert due == ["signals", "curated_balance", "news_rss", "stories", "brief"]


def test_due_job_names_tuesday_weekly_trend_window():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 21, 8, 0))

    assert due == ["signals", "curated_balance", "news_rss", "brief", "weekly_trend"]


def test_due_job_names_channel_health_window():
    due = run_all_module.due_job_names(_kst_datetime(2026, 4, 20, 9, 15))

    assert due == ["signals", "curated_balance", "channel_health"]


def test_run_all_returns_noop_for_non_dispatch_window():
    with patch.object(run_all_module, "run_signals_pipeline") as signals:
        summary = run_all_module.run_all(now=_kst_datetime(2026, 4, 20, 9, 5))

    assert summary["status"] == "noop"
    assert summary["due_jobs"] == []
    assert summary["executed_jobs"] == []
    assert summary["failed_jobs"] == {}
    signals.assert_not_called()


def test_run_all_continues_after_individual_job_failure():
    calls: list[str] = []

    def _record(name: str):
        def _runner():
            calls.append(name)
            return {"job": name}

        return _runner

    def _failing_signals():
        calls.append("signals")
        raise RuntimeError("signals boom")

    with patch.object(run_all_module, "run_signals_pipeline", side_effect=_failing_signals), patch.object(
        run_all_module, "run_curated_balance_refresh", side_effect=_record("curated_balance")
    ), patch.object(
        run_all_module, "run_news_rss_refresh", side_effect=_record("news_rss")
    ), patch.object(
        run_all_module, "run_brief_pipeline", side_effect=_record("brief")
    ), patch.object(
        run_all_module, "_run_weekly_trend_job", side_effect=_record("weekly_trend")
    ):
        summary = run_all_module.run_all(now=_kst_datetime(2026, 4, 21, 8, 0))

    assert calls == ["signals", "curated_balance", "news_rss", "brief", "weekly_trend"]
    assert summary["status"] == "completed_with_errors"
    assert summary["executed_jobs"] == ["curated_balance", "news_rss", "brief", "weekly_trend"]
    assert summary["failed_jobs"] == {"signals": "signals boom"}
