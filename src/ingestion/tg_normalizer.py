"""Telegram whale-alert row -> Event normalizer."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from src.signals.models import Event
from src.utils.datetime_utils import parse_dt
from src.utils.logger import get_logger
from src.utils.number_utils import safe_float

logger = get_logger("tg_normalizer")

TG_CHAIN_MAP = {
    "bitcoin": "BTC",
    "btc": "BTC",
    "ethereum": "ETH",
    "eth": "ETH",
    "bsc": "BSC",
    "bnb": "BSC",
    "binance smart chain": "BSC",
    "polygon": "POLYGON",
    "matic": "POLYGON",
    "solana": "SOL",
    "sol": "SOL",
    "tron": "TRX",
    "trx": "TRX",
}


def normalize_tg_chain(value: object) -> str:
    raw = str(value or "unknown").strip().lower()
    if not raw:
        return "unknown"
    if raw == "unknown":
        return "unknown"
    return TG_CHAIN_MAP.get(raw, raw.upper())


def tg_owner_label(value: object, fallback: str = "unknown") -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    return text.lstrip("#")


def tg_direction(from_owner_type: str, to_owner_type: str) -> tuple[str, str | None]:
    from_type = from_owner_type.lower()
    to_type = to_owner_type.lower()
    if from_type == "exchange" and to_type == "exchange":
        # Exchange-to-exchange moves are distinct from regular CEX outflows;
        # surface the "cex_to_cex" category so downstream rules can treat them
        # as venue-rebalance noise rather than genuine whale positioning.
        return "out", "cex_to_cex"
    if to_type == "exchange" and from_type != "exchange":
        return "in", "cex"
    if from_type == "exchange":
        return "out", None
    # Wallet-to-wallet / unknown fallback: TG events have no watched_address,
    # so in/out is a convention. We default to "out" to keep the Event
    # direction typing (Literal["in","out"]) consistent; counterparty_category
    # stays None so signal rules can filter these as uncategorized transfers.
    return "out", None


def tg_row_to_event(row: dict) -> Event:
    block_time = (
        parse_dt(row.get("tg_date"))
        or parse_dt(row.get("collected_at"))
        or datetime.now(timezone.utc)
    )
    collected_at = parse_dt(row.get("collected_at")) or block_time
    from_owner = tg_owner_label(row.get("from_owner"))
    to_owner = tg_owner_label(row.get("to_owner"))
    from_owner_type = str(row.get("from_owner_type") or "unknown").strip().lower() or "unknown"
    to_owner_type = str(row.get("to_owner_type") or "unknown").strip().lower() or "unknown"
    direction, counterparty_category = tg_direction(from_owner_type, to_owner_type)

    return Event(
        source="tg",
        chain=normalize_tg_chain(row.get("blockchain")),
        tx_hash=None,
        watched_address=None,
        from_addr=from_owner or from_owner_type or "unknown",
        to_addr=to_owner or to_owner_type or "unknown",
        direction=direction,
        token=str(row.get("symbol") or "UNKNOWN").upper(),
        amount_token=safe_float(
            row.get("amount"),
            strip_commas=True,
            field_name="amount",
            log_level=logging.WARNING,
            logger=logger,
        ),
        amount_usd=safe_float(
            row.get("amount_usd"),
            strip_commas=True,
            field_name="amount_usd",
            log_level=logging.WARNING,
            logger=logger,
        ),
        counterparty_category=counterparty_category,
        block_time=block_time,
        collected_at=collected_at,
    )
