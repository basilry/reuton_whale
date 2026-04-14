"""Raw tx → Event normalizer with price lookup. Filled in TRACK 3."""
from __future__ import annotations

from src.signals.models import Event


def normalize_chain_tx(raw: dict, chain: str, watched_index: dict, price_service) -> Event:
    raise NotImplementedError("TRACK 3")
