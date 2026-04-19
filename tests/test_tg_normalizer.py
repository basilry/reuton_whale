"""Tests for TG row -> Event normalizer (W1-A refactor target)."""
from __future__ import annotations

from datetime import datetime, timezone

from src.ingestion.tg_normalizer import (
    TG_CHAIN_MAP,
    get_tg_channel_profile,
    normalize_tg_chain,
    normalize_tg_channel_handle,
    tg_direction,
    tg_owner_label,
    tg_row_to_event,
)


def test_normalize_tg_chain_maps_known_aliases():
    assert normalize_tg_chain("bitcoin") == "BTC"
    assert normalize_tg_chain("ETH") == "ETH"
    assert normalize_tg_chain("Binance Smart Chain") == "BSC"
    assert normalize_tg_chain("matic") == "POLYGON"
    # Sanity check mapping keys are lowercase so the lookup is case-insensitive.
    assert all(key == key.lower() for key in TG_CHAIN_MAP)


def test_normalize_tg_chain_handles_unknown_and_empty():
    assert normalize_tg_chain(None) == "unknown"
    assert normalize_tg_chain("") == "unknown"
    assert normalize_tg_chain("unknown") == "unknown"
    # Novel chain names fall through to upper-casing so they stay readable.
    assert normalize_tg_chain("avalanche") == "AVALANCHE"


def test_tg_owner_label_strips_hash_prefix():
    assert tg_owner_label("#Binance") == "Binance"
    assert tg_owner_label(" #Kraken ") == "Kraken"
    assert tg_owner_label("Coinbase") == "Coinbase"


def test_tg_owner_label_uses_fallback_on_empty():
    assert tg_owner_label("", fallback="exchange") == "exchange"
    assert tg_owner_label(None) == "unknown"
    assert tg_owner_label("   ", fallback="whale") == "whale"


def test_normalize_tg_channel_handle_strips_at_prefix():
    assert normalize_tg_channel_handle("@whale_alert_io") == "whale_alert_io"
    assert normalize_tg_channel_handle("LookOnChain") == "lookonchain"


def test_get_tg_channel_profile_uses_config_display_name():
    profile = get_tg_channel_profile("@whale_alert_io")
    assert profile["handle"] == "whale_alert_io"
    assert profile["display_name"] == "Whale Alert"
    assert profile["confidence"] == "high"


def test_tg_direction_covers_all_branches():
    # Exchange-to-exchange -> out + cex_to_cex category (venue rebalance noise).
    assert tg_direction("exchange", "exchange") == ("out", "cex_to_cex")
    # Wallet -> exchange = deposit (in + cex).
    assert tg_direction("wallet", "exchange") == ("in", "cex")
    # Exchange -> wallet = withdrawal (out, no category).
    assert tg_direction("exchange", "wallet") == ("out", None)
    # Wallet-to-wallet fallback (convention keeps out + None).
    assert tg_direction("wallet", "unknown") == ("out", None)


def test_tg_row_to_event_happy_path():
    row = {
        "tg_date": "2026-04-17T12:00:00+00:00",
        "collected_at": "2026-04-17T12:01:00+00:00",
        "from_owner": "#Binance",
        "to_owner": "whale_wallet",
        "from_owner_type": "exchange",
        "to_owner_type": "wallet",
        "blockchain": "ethereum",
        "symbol": "usdt",
        "amount": "1,000,000",
        "amount_usd": "1,000,500",
        "external_channel": "whale_alert_io",
        "external_display_name": "Whale Alert",
        "external_confidence": "high",
    }
    event = tg_row_to_event(row)
    assert event.source == "tg"
    assert event.chain == "ETH"
    assert event.tx_hash is None
    assert event.from_addr == "Binance"
    assert event.to_addr == "whale_wallet"
    assert event.direction == "out"
    assert event.counterparty_category is None
    assert event.token == "USDT"
    assert event.amount_token == 1_000_000.0
    assert event.amount_usd == 1_000_500.0
    assert event.block_time == datetime(2026, 4, 17, 12, 0, tzinfo=timezone.utc)
    assert event.observation_source == "tg_mirror"
    assert event.external_channel == "Whale Alert"
    assert event.external_channel_handle == "whale_alert_io"
    assert event.external_confidence == "high"


def test_tg_row_to_event_defaults_on_missing_fields():
    event = tg_row_to_event({})
    assert event.source == "tg"
    assert event.chain == "unknown"
    assert event.token == "UNKNOWN"
    assert event.amount_token == 0.0
    assert event.amount_usd == 0.0
    assert event.direction == "out"
    assert event.counterparty_category is None
    assert event.observation_source == "tg_mirror"
    # Missing tg_date falls back to now(utc); just confirm timezone is set.
    assert event.block_time.tzinfo is not None
