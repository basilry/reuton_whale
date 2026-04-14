"""Telethon listener for @whale_alert_io. Filled in TRACK 3."""
from __future__ import annotations


class TelethonListener:
    def __init__(self, api_id: int, api_hash: str, session: str, storage, router=None):
        raise NotImplementedError("TRACK 3")

    async def run(self) -> None:
        raise NotImplementedError("TRACK 3")
