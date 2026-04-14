"""Etherscan v2 multi-chain collector. Filled in TRACK 3."""
from __future__ import annotations

from src.signals.models import Event


class EtherscanCollector:
    def __init__(self, api_key: str, rate_limit_per_sec: float = 3.0):
        raise NotImplementedError("TRACK 3")

    def fetch(self, addresses: list[str], chain: str, since_ts: int) -> list[Event]:
        raise NotImplementedError("TRACK 3")
