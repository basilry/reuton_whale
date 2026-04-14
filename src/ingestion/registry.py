"""Watched-addresses registry loader."""
from __future__ import annotations


def load_watched(storage) -> dict[str, dict]:
    """Return {address_lower: row_dict} index from storage."""
    rows = storage.list_watched_addresses(enabled_only=True)
    return {row["address"].lower(): row for row in rows}
