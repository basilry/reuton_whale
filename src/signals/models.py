"""Event and Signal dataclasses. Filled in TRACK 4, pre-declared here for TRACK 3 consumers."""
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
