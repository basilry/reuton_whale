from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal, Mapping

from src.channel.policy import DEFAULT_MARKET_PULSE_MIN_INTERVAL, evaluate_market_pulse_cadence

ChannelDecision = Literal["event_alert", "market_pulse", "quiet_skip"]


def _has_text(row: Mapping[str, object] | None, keys: tuple[str, ...]) -> bool:
    if not row:
        return False
    return any(str(row.get(key) or "").strip() for key in keys)


@dataclass(frozen=True)
class FallbackSnapshot:
    daily_brief: Mapping[str, object] | None = None
    news_rows: tuple[Mapping[str, object], ...] = ()
    market_snapshot: Mapping[str, object] | None = None

    @classmethod
    def from_parts(
        cls,
        *,
        daily_brief: Mapping[str, object] | None = None,
        news_rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...] | None = None,
        market_snapshot: Mapping[str, object] | None = None,
    ) -> "FallbackSnapshot":
        return cls(
            daily_brief=dict(daily_brief) if daily_brief else None,
            news_rows=tuple(dict(row) for row in (news_rows or [])),
            market_snapshot=dict(market_snapshot) if market_snapshot else None,
        )

    @property
    def sources(self) -> tuple[str, ...]:
        sources: list[str] = []
        if _has_text(self.daily_brief, ("summary", "highlights", "note")):
            sources.append("daily_brief")
        if any(_has_text(row, ("title", "summary")) for row in self.news_rows):
            sources.append("news")
        if _has_text(
            self.market_snapshot,
            (
                "symbol",
                "binance_usd",
                "upbit_krw",
                "krw_premium_pct",
                "jpy_premium_pct",
                "eur_premium_pct",
            ),
        ):
            sources.append("market_snapshot")
        return tuple(sources)

    @property
    def source_label(self) -> str:
        return "+".join(self.sources)

    @property
    def has_content(self) -> bool:
        return bool(self.sources)


@dataclass(frozen=True)
class ChannelMessagePlan:
    decision: ChannelDecision
    reason: str
    signal_rows: tuple[Mapping[str, object], ...] = ()
    transaction_rows: tuple[Mapping[str, object], ...] = ()
    fallback: FallbackSnapshot = field(default_factory=FallbackSnapshot)
    last_delivery_at: datetime | None = None
    next_expected_at: datetime | None = None

    @property
    def candidate_signal_count(self) -> int:
        return len(self.signal_rows)

    @property
    def candidate_transaction_count(self) -> int:
        return len(self.transaction_rows)

    @property
    def fallback_source(self) -> str:
        return self.fallback.source_label

    @property
    def should_broadcast(self) -> bool:
        return self.decision in {"event_alert", "market_pulse"}

    def to_broadcast_log_metadata(self) -> dict[str, object]:
        return {
            "decision": self.decision,
            "reason": self.reason,
            "fallback_source": self.fallback_source,
            "candidate_signal_count": self.candidate_signal_count,
            "candidate_transaction_count": self.candidate_transaction_count,
            "last_channel_delivery_at": self.last_delivery_at.isoformat() if self.last_delivery_at else "",
            "next_expected_at": self.next_expected_at.isoformat() if self.next_expected_at else "",
        }


def plan_periodic_channel_message(
    *,
    now: datetime,
    signal_rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...],
    transaction_rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...],
    fallback_snapshot: FallbackSnapshot | None = None,
    recent_broadcast_rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...] = (),
    market_pulse_min_interval: timedelta = DEFAULT_MARKET_PULSE_MIN_INTERVAL,
) -> ChannelMessagePlan:
    signals = tuple(dict(row) for row in signal_rows)
    transactions = tuple(dict(row) for row in transaction_rows)
    fallback = fallback_snapshot or FallbackSnapshot()

    if signals or transactions:
        return ChannelMessagePlan(
            decision="event_alert",
            reason="signals_or_transactions_available",
            signal_rows=signals,
            transaction_rows=transactions,
            fallback=fallback,
        )

    if not fallback.has_content:
        return ChannelMessagePlan(
            decision="quiet_skip",
            reason="no_event_alert_candidates_or_fallback",
            fallback=fallback,
        )

    cadence = evaluate_market_pulse_cadence(
        now=now,
        broadcast_rows=list(recent_broadcast_rows),
        min_interval=market_pulse_min_interval,
    )
    if cadence.eligible:
        return ChannelMessagePlan(
            decision="market_pulse",
            reason=cadence.reason,
            fallback=fallback,
            last_delivery_at=cadence.last_delivery_at,
            next_expected_at=cadence.next_expected_at,
        )

    return ChannelMessagePlan(
        decision="quiet_skip",
        reason=cadence.reason,
        fallback=fallback,
        last_delivery_at=cadence.last_delivery_at,
        next_expected_at=cadence.next_expected_at,
    )

