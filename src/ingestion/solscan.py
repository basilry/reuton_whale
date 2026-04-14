"""Solscan Public API v2 collector. Filled in TRACK 3."""
from __future__ import annotations

from src.signals.models import Event


class SolscanCollector:
    def __init__(self, api_key: str | None = None):
        raise NotImplementedError("TRACK 3")

    def fetch(self, addresses: list[str], since_ts: int) -> list[Event]:
        raise NotImplementedError("TRACK 3")
