from __future__ import annotations

from datetime import datetime, timezone

from src.router.budget import MonthlyBudgetGuard, month_key_for


class _MemoryBudgetStorage:
    def __init__(self, rows: list[dict] | None = None) -> None:
        self.rows = list(rows or [])

    def list_llm_budget_log(self, month_key: str | None = None, limit: int | None = None) -> list[dict]:
        rows = self.rows
        if month_key:
            rows = [row for row in rows if row.get("month_key") == month_key]
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def append_llm_budget_log(self, entry: dict) -> None:
        self.rows.append(dict(entry))


def test_budget_blocks_only_brief_and_stories_after_cap():
    april = datetime(2026, 4, 18, tzinfo=timezone.utc)
    storage = _MemoryBudgetStorage(
        [
            {
                "month_key": month_key_for(april),
                "pipeline": "brief",
                "cost_usd": 15.0,
            }
        ]
    )
    guard = MonthlyBudgetGuard(storage, cap_usd=15.0)

    blocked = guard.precheck("brief", now=april)
    assert blocked.allowed is False
    assert blocked.decision == "blocked_cap"

    not_limited = guard.precheck("signals", now=april)
    assert not_limited.allowed is True
    assert not_limited.decision == "not_limited"


def test_budget_resets_by_month_key():
    april = datetime(2026, 4, 30, 23, 0, tzinfo=timezone.utc)
    may = datetime(2026, 5, 1, 0, 5, tzinfo=timezone.utc)
    storage = _MemoryBudgetStorage(
        [
            {
                "month_key": month_key_for(april),
                "pipeline": "brief",
                "cost_usd": 14.9,
            }
        ]
    )
    guard = MonthlyBudgetGuard(storage, cap_usd=15.0)

    may_decision = guard.precheck("brief", now=may)
    assert may_decision.allowed is True
    assert may_decision.spent_usd == 0.0
    assert may_decision.month_key == "2026-05"


def test_record_usage_appends_cumulative_cost():
    now = datetime(2026, 4, 18, tzinfo=timezone.utc)
    storage = _MemoryBudgetStorage(
        [
            {
                "month_key": month_key_for(now),
                "pipeline": "brief",
                "cost_usd": 1.25,
            }
        ]
    )
    guard = MonthlyBudgetGuard(storage, cap_usd=15.0)

    decision = guard.record_usage(
        pipeline="brief",
        model_id="claude-3-5-sonnet-latest",
        tokens_in=100,
        tokens_out=50,
        cost_usd=0.75,
        now=now,
    )

    assert decision.spent_usd == 2.0
    assert storage.rows[-1]["cumulative_cost_usd"] == 2.0
    assert storage.rows[-1]["decision"] == "recorded"
