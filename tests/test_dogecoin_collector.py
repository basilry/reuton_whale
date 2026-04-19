from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.ingestion.dogecoin import DogecoinCollector, DogecoinError, normalize_dogecoin_utxo


class _FakePriceService:
    def __init__(self, prices: dict[str, float]) -> None:
        self._prices = prices

    def get_usd(self, symbol: str) -> float | None:
        return self._prices.get(symbol)


def _mock_resp(data: dict, status_code: int = 200):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = data
    return response


def test_normalize_dogecoin_utxo_builds_inbound_event() -> None:
    watched_address = "DWatchAddress111111111111111111111"
    counterparty = "DSenderAddress11111111111111111111"

    event = normalize_dogecoin_utxo(
        {
            "transaction_hash": "doge-in-1",
            "index": 0,
            "time": "2026-04-19T09:15:00Z",
            "value": "2500000000",
            "recipient": watched_address,
            "sender": counterparty,
        },
        watched_address=watched_address,
        watched_index={counterparty: {"category": "exchange"}},
        price_service=_FakePriceService({"DOGE": 0.2}),
    )

    assert event is not None
    assert event.chain == "DOGE"
    assert event.token == "DOGE"
    assert event.direction == "in"
    assert event.from_addr == counterparty
    assert event.to_addr == watched_address
    assert event.amount_token == pytest.approx(25.0)
    assert event.amount_usd == pytest.approx(5.0)
    assert event.counterparty_category == "exchange"
    assert event.block_time == datetime(2026, 4, 19, 9, 15, tzinfo=timezone.utc)


def test_normalize_dogecoin_utxo_uses_input_output_lists_for_outbound() -> None:
    watched_address = "DWatchAddress111111111111111111111"
    counterparty = "DRecipientAddress111111111111111111"

    event = normalize_dogecoin_utxo(
        {
            "hash": "doge-out-1",
            "vout": 2,
            "block_time": 1_776_596_100,
            "value_doge": "12.5",
            "inputs": [{"address": watched_address}],
            "outputs": [{"address": watched_address}, {"address": counterparty}],
        },
        watched_address=watched_address,
        watched_index={counterparty.lower(): {"category": "miner"}},
        price_service=_FakePriceService({"DOGE": 0.18}),
    )

    assert event is not None
    assert event.direction == "out"
    assert event.from_addr == watched_address
    assert event.to_addr == counterparty
    assert event.amount_token == pytest.approx(12.5)
    assert event.amount_usd == pytest.approx(2.25)
    assert event.counterparty_category == "miner"


@patch("src.ingestion.dogecoin.requests.get")
def test_dogecoin_collector_fetches_blockchair_dashboard_and_filters_since_ts(mock_get) -> None:
    watched_address = "DWatchAddress111111111111111111111"
    since_ts = int(datetime(2026, 4, 19, 10, 0, tzinfo=timezone.utc).timestamp())
    payload = {
        "data": {
            watched_address: {
                "utxo": [
                    {"transaction_hash": "tx-shared", "index": 0, "value": "150000000"},
                    {"transaction_hash": "tx-shared", "index": 0, "value": "150000000"},
                    {"transaction_hash": "tx-shared", "index": 1, "value": "50000000"},
                    {"transaction_hash": "tx-old", "index": 0, "value": "100000000"},
                ],
                "transactions": [
                    {
                        "hash": "tx-shared",
                        "time": "2026-04-19T10:00:01Z",
                        "inputs": [{"address": "DFromShared11111111111111111111"}],
                        "outputs": [{"address": watched_address}, {"address": watched_address}],
                    },
                    {
                        "hash": "tx-old",
                        "time": "2026-04-19T09:59:59Z",
                        "inputs": [{"address": "DOldSender111111111111111111111"}],
                        "outputs": [{"address": watched_address}],
                    },
                ],
            }
        }
    }
    mock_get.return_value = _mock_resp(payload)

    collector = DogecoinCollector(limit=25)
    events = collector.fetch(
        [watched_address],
        "DOGE",
        since_ts,
        watched_index={},
        price_service=_FakePriceService({"DOGE": 0.2}),
    )

    assert mock_get.call_count == 1
    assert mock_get.call_args.args[0].endswith(f"/dashboards/address/{watched_address}")
    assert mock_get.call_args.kwargs["params"] == {"limit": 25}
    assert [event.tx_hash for event in events] == ["tx-shared", "tx-shared"]
    assert [event.amount_token for event in events] == pytest.approx([1.5, 0.5])
    assert [event.amount_usd for event in events] == pytest.approx([0.3, 0.1])
    assert all(event.block_time >= datetime(2026, 4, 19, 10, 0, tzinfo=timezone.utc) for event in events)


def test_dogecoin_collector_rejects_unknown_chain() -> None:
    collector = DogecoinCollector()

    with pytest.raises(DogecoinError, match="Unknown chain"):
        collector.fetch(["DWatchAddress111111111111111111111"], "BTC", since_ts=0)
