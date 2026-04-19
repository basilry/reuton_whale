from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from src.ingestion.bitcoin import BitcoinCollector, normalize_bitcoin_transaction


class _FakePriceService:
    def __init__(self, prices: dict[str, float]) -> None:
        self._prices = prices

    def get_usd(self, symbol: str) -> float | None:
        return self._prices.get(symbol)


def _tx(
    *,
    txid: str,
    vins: list[dict],
    vouts: list[dict],
    block_time: int = 1_713_528_000,
) -> dict:
    return {
        "txid": txid,
        "vin": vins,
        "vout": vouts,
        "status": {
            "confirmed": True,
            "block_time": block_time,
        },
    }


def _vin(address: str, value: int) -> dict:
    return {
        "prevout": {
            "scriptpubkey_address": address,
            "value": value,
        }
    }


def _vout(address: str, value: int) -> dict:
    return {
        "scriptpubkey_address": address,
        "value": value,
    }


def test_bitcoin_collector_fetch_normalizes_inflow_from_address_txs() -> None:
    watched_address = "bc1-watch"
    source_address = "bc1-source"
    collector = BitcoinCollector()
    collector._fetch_transactions = MagicMock(
        return_value=[
            _tx(
                txid="btc-in-1",
                vins=[_vin(source_address, 250_000_000)],
                vouts=[_vout(watched_address, 250_000_000)],
            )
        ]
    )

    events = collector.fetch(
        [watched_address],
        "BTC",
        since_ts=1_713_527_000,
        watched_index={source_address: {"category": "miner"}},
        price_service=_FakePriceService({"BTC": 60_000.0}),
    )

    assert collector._fetch_transactions.call_args.args == (watched_address, 1_713_527_000)
    assert len(events) == 1
    event = events[0]
    assert event.chain == "BTC"
    assert event.tx_hash == "btc-in-1"
    assert event.direction == "in"
    assert event.from_addr == source_address
    assert event.to_addr == watched_address
    assert event.amount_token == 2.5
    assert event.amount_usd == 150_000.0
    assert event.counterparty_category == "miner"
    assert event.block_time == datetime.fromtimestamp(1_713_528_000, tz=timezone.utc)


def test_normalize_bitcoin_outflow_uses_external_outputs_for_amount() -> None:
    watched_address = "bc1-watch"
    destination_a = "bc1-destination-a"
    destination_b = "bc1-destination-b"

    event = normalize_bitcoin_transaction(
        _tx(
            txid="btc-out-1",
            vins=[_vin(watched_address, 100_000_000)],
            vouts=[
                _vout(destination_a, 60_000_000),
                _vout(destination_b, 39_000_000),
            ],
        ),
        watched_address=watched_address,
        watched_index={destination_a: {"category": "exchange"}},
        price_service=_FakePriceService({"BTC": 50_000.0}),
    )

    assert event is not None
    assert event.direction == "out"
    assert event.from_addr == watched_address
    assert event.to_addr == destination_a
    assert event.amount_token == 0.99
    assert event.amount_usd == 49_500.0
    assert event.counterparty_category == "exchange"


def test_normalize_bitcoin_outflow_excludes_change_back_to_watched_address() -> None:
    watched_address = "bc1-watch"
    destination = "bc1-destination"

    event = normalize_bitcoin_transaction(
        _tx(
            txid="btc-change-1",
            vins=[_vin(watched_address, 100_000_000)],
            vouts=[
                _vout(destination, 70_000_000),
                _vout(watched_address, 29_000_000),
            ],
        ),
        watched_address=watched_address,
        watched_index={destination: {"category": "cex"}},
        price_service=_FakePriceService({"BTC": 80_000.0}),
    )

    assert event is not None
    assert event.direction == "out"
    assert event.from_addr == watched_address
    assert event.to_addr == destination
    assert event.amount_token == 0.7
    assert event.amount_usd == 56_000.0
    assert event.counterparty_category == "cex"
