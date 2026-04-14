"""SignalEngine. Filled in TRACK 4."""
from __future__ import annotations

from datetime import datetime

from src.signals.models import Event, Signal


class SignalEngine:
    def __init__(self, rules_config: dict, storage=None):
        raise NotImplementedError("TRACK 4")

    def run(self, events: list[Event], now: datetime) -> list[Signal]:
        raise NotImplementedError("TRACK 4")

    def personalize(self, signals: list[Signal], interests: list[dict]) -> list[Signal]:
        raise NotImplementedError("TRACK 4")
