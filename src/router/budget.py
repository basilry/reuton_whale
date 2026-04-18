from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from src.storage.queries import now_iso


def month_key_for(value: datetime | None = None) -> str:
    target = value.astimezone(timezone.utc) if value else datetime.now(timezone.utc)
    return target.strftime("%Y-%m")


def _safe_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


@dataclass(frozen=True)
class BudgetDecision:
    pipeline: str
    month_key: str
    allowed: bool
    decision: str
    spent_usd: float
    remaining_usd: float
    cap_usd: float


class MonthlyBudgetGuard:
    def __init__(
        self,
        storage,
        *,
        cap_usd: float = 15.0,
        billable_pipelines: tuple[str, ...] = ("brief", "stories"),
    ) -> None:
        self._storage = storage
        self._cap_usd = float(cap_usd)
        self._billable_pipelines = {name.strip() for name in billable_pipelines}

    @property
    def cap_usd(self) -> float:
        return self._cap_usd

    def monthly_spend(self, *, now: datetime | None = None) -> tuple[str, float]:
        key = month_key_for(now)
        rows = self._storage.list_llm_budget_log(month_key=key)
        spent = sum(_safe_float(row.get("cost_usd")) for row in rows)
        return key, spent

    def precheck(self, pipeline: str, *, now: datetime | None = None) -> BudgetDecision:
        key, spent = self.monthly_spend(now=now)
        if pipeline not in self._billable_pipelines:
            return BudgetDecision(
                pipeline=pipeline,
                month_key=key,
                allowed=True,
                decision="not_limited",
                spent_usd=spent,
                remaining_usd=max(self._cap_usd - spent, 0.0),
                cap_usd=self._cap_usd,
            )

        allowed = spent < self._cap_usd
        return BudgetDecision(
            pipeline=pipeline,
            month_key=key,
            allowed=allowed,
            decision="allowed" if allowed else "blocked_cap",
            spent_usd=spent,
            remaining_usd=max(self._cap_usd - spent, 0.0),
            cap_usd=self._cap_usd,
        )

    def log_blocked(
        self,
        *,
        pipeline: str,
        model_id: str = "",
        now: datetime | None = None,
    ) -> BudgetDecision:
        decision = self.precheck(pipeline, now=now)
        self._storage.append_llm_budget_log(
            {
                "ts": now_iso(),
                "month_key": decision.month_key,
                "pipeline": pipeline,
                "model_id": model_id,
                "tokens_in": 0,
                "tokens_out": 0,
                "cost_usd": 0.0,
                "cumulative_cost_usd": decision.spent_usd,
                "decision": "blocked_cap",
            }
        )
        return decision

    def record_usage(
        self,
        *,
        pipeline: str,
        model_id: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        decision: str = "recorded",
        now: datetime | None = None,
    ) -> BudgetDecision:
        key, spent = self.monthly_spend(now=now)
        cumulative = spent + float(cost_usd)
        self._storage.append_llm_budget_log(
            {
                "ts": now_iso(),
                "month_key": key,
                "pipeline": pipeline,
                "model_id": model_id,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "cost_usd": cost_usd,
                "cumulative_cost_usd": cumulative,
                "decision": decision,
            }
        )
        return BudgetDecision(
            pipeline=pipeline,
            month_key=key,
            allowed=cumulative < self._cap_usd,
            decision=decision,
            spent_usd=cumulative,
            remaining_usd=max(self._cap_usd - cumulative, 0.0),
            cap_usd=self._cap_usd,
        )
