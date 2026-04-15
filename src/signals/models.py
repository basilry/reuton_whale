"""Event and Signal dataclasses."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional


@dataclass(frozen=True)
class Event:
    source: Literal["tg", "chain", "both"]
    chain: str
    tx_hash: Optional[str]
    watched_address: Optional[str]
    from_addr: str
    to_addr: str
    direction: Literal["in", "out"]
    token: str
    amount_token: float
    amount_usd: float
    counterparty_category: Optional[str]
    block_time: datetime
    collected_at: datetime


@dataclass(frozen=True)
class Signal:
    signal_id: str
    rule: str
    severity: Literal["low", "medium", "high", "critical"]
    score: float
    confidence: Literal["low", "medium", "high"]
    source: Literal["tg", "chain", "both"]
    evidence_tx_hashes: list[str]
    window_start: datetime
    window_end: datetime
    summary: str
    extra: dict = field(default_factory=dict)


@dataclass
class RuleContext:
    now: datetime
    # Per-chain baseline stats for anomaly detection; "default" is the aggregate used by current rules.
    # {"eth": {"out_mean_usd": float, "out_std_usd": float, "in_mean_usd": float, "in_std_usd": float}}
    chain_baselines: dict = field(default_factory=dict)
    # Set of watched address strings
    watched_index: set = field(default_factory=set)
    # token -> list[float] price history
    price_history: dict = field(default_factory=dict)
    # chain -> list[float] weekly net USD flow (positive = net accumulation)
    weekly_net_history: dict = field(default_factory=dict)
    # "chain:token" -> list[float] top-N whale % concentration per week
    concentration_history: dict = field(default_factory=dict)
