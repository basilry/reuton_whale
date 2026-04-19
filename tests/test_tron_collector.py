from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from src.ingestion.tron import TronCollector, _tron_hex_to_base58, normalize_tron_transaction


class _FakePriceService:
    def __init__(self, prices: dict[str, float]) -> None:
        self._prices = prices

    def get_usd(self, symbol: str) -> float | None:
        return self._prices.get(symbol)


def test_normalize_tron_trc20_transaction_preserves_usdt_symbol() -> None:
    watched_address = "TFromAddress1111111111111111111111111"
    counterparty = "TToAddress111111111111111111111111111"
    event = normalize_tron_transaction(
        {
            "_is_trc20": True,
            "transaction_id": "trc20-1",
            "block_timestamp": 1_713_528_000_000,
            "from": watched_address,
            "to": counterparty,
            "value": "2500000000",
            "token_info": {"symbol": "USDT", "decimals": "6"},
        },
        watched_address=watched_address,
        watched_index={counterparty: {"category": "cex"}},
        price_service=_FakePriceService({"USDT": 1.0}),
    )

    assert event is not None
    assert event.chain == "TRX"
    assert event.token == "USDT"
    assert event.direction == "out"
    assert event.amount_token == 2500.0
    assert event.amount_usd == 2500.0
    assert event.counterparty_category == "cex"


def test_normalize_tron_native_transaction_converts_hex_addresses() -> None:
    from_hex = "41" + ("11" * 20)
    watched_hex = "41" + ("22" * 20)
    from_addr = _tron_hex_to_base58(from_hex)
    watched_address = _tron_hex_to_base58(watched_hex)

    event = normalize_tron_transaction(
        {
            "txID": "trx-native-1",
            "block_timestamp": 1_713_528_000_000,
            "raw_data": {
                "timestamp": 1_713_528_000_000,
                "contract": [
                    {
                        "parameter": {
                            "value": {
                                "owner_address": from_hex,
                                "to_address": watched_hex,
                                "amount": "2000000",
                            }
                        }
                    }
                ],
            },
        },
        watched_address=watched_address,
        watched_index={from_addr: {"category": "whale"}},
        price_service=_FakePriceService({"TRX": 0.12}),
    )

    assert event is not None
    assert event.chain == "TRX"
    assert event.token == "TRX"
    assert event.direction == "in"
    assert event.from_addr == from_addr
    assert event.to_addr == watched_address
    assert event.amount_token == 2.0
    assert event.amount_usd == 0.24
    assert event.counterparty_category == "whale"
    assert event.block_time == datetime.fromtimestamp(1_713_528_000, tz=timezone.utc)


def test_tron_collector_fetches_native_and_trc20_paths() -> None:
    watched_address = "TFromAddress1111111111111111111111111"
    collector = TronCollector()
    collector._fetch_endpoint = MagicMock(
        side_effect=lambda address, path, since_ms: (
            [
                {
                    "txID": "native-1",
                    "block_timestamp": since_ms + 1000,
                    "raw_data": {
                        "timestamp": since_ms + 1000,
                        "contract": [
                            {
                                "parameter": {
                                    "value": {
                                        "owner_address": watched_address,
                                        "to_address": "TNativeCounterparty1111111111111111111",
                                        "amount": "1000000",
                                    }
                                }
                            }
                        ],
                    },
                }
            ]
            if path == "transactions"
            else [
                {
                    "transaction_id": "trc20-1",
                    "block_timestamp": since_ms + 2000,
                    "from": watched_address,
                    "to": "TTrc20Counterparty11111111111111111111",
                    "value": "5000000",
                    "token_info": {"symbol": "USDT", "decimals": "6"},
                }
            ]
        )
    )

    events = collector.fetch(
        [watched_address],
        "TRX",
        1_713_528_000,
        watched_index={},
        price_service=_FakePriceService({"TRX": 0.12, "USDT": 1.0}),
    )

    assert collector._fetch_endpoint.call_count == 2
    assert {event.token for event in events} == {"TRX", "USDT"}
