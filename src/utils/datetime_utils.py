"""Shared datetime parsing utility."""
from __future__ import annotations

from datetime import datetime


def parse_dt(value: object) -> datetime | None:
    """Parse ISO 8601 string to datetime, returning None on failure."""
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def parse_dt_strict(s: str) -> datetime:
    """Parse ISO 8601 string to datetime, raising on failure."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
