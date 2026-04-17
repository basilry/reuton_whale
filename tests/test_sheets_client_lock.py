"""Static guard: every SheetsClient write/upsert method must hold _write_lock."""
from __future__ import annotations

import inspect
import re

from src.storage.sheets_client import SheetsClient


WRITE_METHODS = [
    "append_transactions",
    "upsert_watchlist",
    "append_system_log",
    "upsert_watched_address",
    "append_missing_watched_addresses",
    "append_address_activity",
    "append_tg_whale_event",
    "append_signal",
    "upsert_user_interest",
]


def test_write_methods_acquire_write_lock():
    for name in WRITE_METHODS:
        fn = getattr(SheetsClient, name, None)
        assert fn is not None, f"missing method: {name}"
        src = inspect.getsource(fn)
        assert re.search(r"with\s+self\._write_lock", src), (
            f"{name} must wrap its body in `with self._write_lock:`"
        )


def test_init_declares_write_lock():
    src = inspect.getsource(SheetsClient.__init__)
    assert re.search(r"self\._write_lock\s*=\s*threading\.(R)?Lock\(\)", src), (
        "SheetsClient.__init__ must instantiate self._write_lock"
    )
