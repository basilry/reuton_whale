from unittest.mock import MagicMock, patch

import pytest

from src.ingestion.xrpl import XRPLCollector, XRPLError


def _mock_resp(data: dict, status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = data
    return resp


def _account_tx_entry(
    *,
    tx_hash: str = "ABC123",
    watched: str = "rWatch",
    counterparty: str = "rCounterparty",
    iso_time: str = "2026-04-19T09:15:00Z",
    drops: str = "2500000",
) -> dict:
    return {
        "validated": True,
        "close_time_iso": iso_time,
        "hash": tx_hash,
        "tx": {
            "hash": tx_hash,
            "TransactionType": "Payment",
            "Account": watched,
            "Destination": counterparty,
            "Amount": drops,
        },
        "meta": {
            "TransactionResult": "tesSUCCESS",
            "delivered_amount": drops,
        },
    }


@patch("src.utils.http_backoff.time.sleep")
@patch("src.ingestion.xrpl.requests.get")
def test_fetch_deduplicates_same_hash_across_pages(mock_get, _mock_sleep) -> None:
    duplicate = _account_tx_entry(tx_hash="TX_DUP")
    unique = _account_tx_entry(tx_hash="TX_NEW", iso_time="2026-04-19T09:16:00Z")
    mock_get.side_effect = [
        _mock_resp({"transactions": [duplicate], "marker": "next"}),
        _mock_resp({"transactions": [duplicate, unique]}),
    ]

    collector = XRPLCollector(page_size=2, max_pages=2)
    events = collector.fetch(["rWatch"], "XRP", since_ts=1_750_000_000)

    assert [event.tx_hash for event in events] == ["TX_DUP", "TX_NEW"]


@patch("src.utils.http_backoff.time.sleep")
@patch("src.ingestion.xrpl.requests.get")
def test_fetch_filters_rows_older_than_since_ts_using_iso_timestamp(mock_get, _mock_sleep) -> None:
    old_entry = _account_tx_entry(tx_hash="OLD", iso_time="2026-04-19T08:59:59Z")
    new_entry = _account_tx_entry(tx_hash="NEW", iso_time="2026-04-19T09:00:01Z")
    mock_get.return_value = _mock_resp({"transactions": [old_entry, new_entry]})

    collector = XRPLCollector(page_size=5, max_pages=1)
    events = collector.fetch(["rWatch"], "XRP", since_ts=1_776_589_200)

    assert [event.tx_hash for event in events] == ["NEW"]


@patch("src.utils.http_backoff.time.sleep")
@patch("src.ingestion.xrpl.requests.get")
def test_fetch_surfaces_http_500_after_backoff_exhaustion(mock_get, mock_sleep) -> None:
    mock_get.return_value = _mock_resp({}, status_code=500)

    collector = XRPLCollector()
    with pytest.raises(XRPLError, match="max retries exceeded"):
        collector.fetch(["rWatch"], "XRP", since_ts=0)

    assert mock_get.call_count == 5
    assert mock_sleep.call_count == 5
