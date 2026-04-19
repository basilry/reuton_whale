"""Telegram whale-alert row -> Event normalizer."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml

from src.signals.models import Event
from src.utils.datetime_utils import parse_dt
from src.utils.logger import get_logger
from src.utils.number_utils import safe_float

logger = get_logger("tg_normalizer")
_TG_CHANNELS_CONFIG = Path(__file__).resolve().parents[2] / "config" / "tg_channels.yaml"
ChannelConfidence = Literal["low", "medium", "high"]

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


def normalize_tg_channel_handle(value: object) -> str:
    raw = str(value or "").strip()
    if raw.startswith("@"):
        raw = raw[1:]
    return raw.lower()


@lru_cache(maxsize=1)
def _load_tg_channel_profiles() -> dict[str, dict[str, object]]:
    if not _TG_CHANNELS_CONFIG.exists():
        return {}

    try:
        raw = yaml.safe_load(_TG_CHANNELS_CONFIG.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # pragma: no cover - defensive config path
        logger.warning("Failed to load tg_channels config: %s", exc)
        return {}

    profiles: dict[str, dict[str, object]] = {}
    for item in raw.get("channels", []) if isinstance(raw, dict) else []:
        if not isinstance(item, dict):
            continue
        handle = normalize_tg_channel_handle(item.get("handle"))
        if not handle:
            continue
        confidence = str(item.get("confidence") or "medium").strip().lower()
        if confidence not in {"low", "medium", "high"}:
            confidence = "medium"
        profiles[handle] = {
            "handle": handle,
            "display_name": str(item.get("display_name") or handle).strip() or handle,
            "confidence": confidence,
            "weight": item.get("weight", 1.0),
        }
    return profiles


def get_tg_channel_profile(value: object) -> dict[str, object]:
    handle = normalize_tg_channel_handle(value)
    config = _load_tg_channel_profiles()
    profile = config.get(handle, {})
    confidence = str(profile.get("confidence") or "medium").strip().lower()
    if confidence not in {"low", "medium", "high"}:
        confidence = "medium"
    display_name = str(profile.get("display_name") or handle or "Telegram").strip()
    return {
        "handle": handle,
        "display_name": display_name or "Telegram",
        "confidence": confidence,
        "weight": profile.get("weight", 1.0),
    }


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
    profile = get_tg_channel_profile(row.get("external_channel") or row.get("channel"))
    external_display_name = (
        str(row.get("external_display_name") or profile.get("display_name") or "").strip()
        or None
    )
    external_handle = (
        normalize_tg_channel_handle(row.get("external_channel") or row.get("channel"))
        or str(profile.get("handle") or "").strip()
        or None
    )
    external_confidence = str(
        row.get("external_confidence") or profile.get("confidence") or "medium"
    ).strip().lower()
    if external_confidence not in {"low", "medium", "high"}:
        external_confidence = "medium"

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
        observation_source="tg_mirror",
        external_channel=external_display_name,
        external_channel_handle=external_handle,
        external_confidence=external_confidence,  # type: ignore[arg-type]
    )
