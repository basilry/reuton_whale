"""Tests for EtherscanCollector."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.ingestion.etherscan import EtherscanCollector
from src.signals.models import Event
from src.utils.errors import EtherscanError


def _mock_resp(data: dict, status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = data
    resp.raise_for_status = MagicMock()
    return resp


def _mock_429():
    return _mock_resp({}, status_code=429)


def _etherscan_row(hash_val="0xabc", ts=1700000000, from_addr="0xaaa", to_addr="0xbbb", value="1000000000000000000"):
    return {
        "hash": hash_val,
        "timeStamp": str(ts),
        "from": from_addr,
        "to": to_addr,
        "value": value,
        "blockNumber": "18000000",
    }


class TestEtherscanCollector:
    @patch("src.ingestion.etherscan.requests.get")
    def test_fetch_returns_events(self, mock_get):
        mock_get.return_value = _mock_resp({
            "status": "1",
            "result": [_etherscan_row()],
        })
        collector = EtherscanCollector(api_key="test")
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)
        assert len(events) >= 1
        assert all(isinstance(e, Event) for e in events)
        assert events[0].chain == "ETH"

    @patch("src.ingestion.etherscan.requests.get")
    def test_dedup_across_txlist_and_tokentx(self, mock_get):
        row = _etherscan_row(hash_val="0xdup")
        mock_get.return_value = _mock_resp({"status": "1", "result": [row]})
        collector = EtherscanCollector(api_key="test")
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)
        # Same hash from txlist and tokentx → 2 events (one per action), not deduplicated
        # because they represent different data (native tx vs token tx)
        assert len(events) == 2
        assert all(e.tx_hash == "0xdup" for e in events)

    @patch("src.ingestion.etherscan.requests.get")
    def test_no_transactions_found_returns_empty(self, mock_get):
        mock_get.return_value = _mock_resp({
            "status": "0",
            "message": "No transactions found",
            "result": [],
        })
        collector = EtherscanCollector(api_key="test")
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)
        assert events == []

    @patch("src.ingestion.etherscan.requests.get")
    def test_since_ts_filters_old_txs(self, mock_get):
        old_row = _etherscan_row(hash_val="0xold", ts=1000)
        new_row = _etherscan_row(hash_val="0xnew", ts=2000000000)
        mock_get.return_value = _mock_resp({"status": "1", "result": [old_row, new_row]})
        collector = EtherscanCollector(api_key="test")
        events = collector.fetch(["0xaaa"], "ETH", since_ts=1_999_999_999)
        hashes = [e.tx_hash for e in events]
        assert "0xnew" in hashes
        assert "0xold" not in hashes

    @patch("src.ingestion.etherscan.requests.get")
    def test_api_error_raises_etherscan_error(self, mock_get):
        mock_get.return_value = _mock_resp({
            "status": "0",
            "message": "Invalid API key",
            "result": "Error!",
        })
        collector = EtherscanCollector(api_key="bad")
        # Should not raise; warning is logged, events skipped
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)
        assert events == []

    def test_unknown_chain_raises(self):
        collector = EtherscanCollector(api_key="test")
        with pytest.raises(EtherscanError, match="Unknown chain"):
            collector.fetch(["0xaaa"], "UNKNOWN_CHAIN", since_ts=0)

    @patch("src.ingestion.etherscan.requests.get")
    def test_token_tx_uses_token_symbol(self, mock_get):
        row = _etherscan_row()
        row["tokenSymbol"] = "USDT"
        row["tokenDecimal"] = "6"
        row["value"] = "1000000000"  # 1000 USDT
        mock_get.return_value = _mock_resp({"status": "1", "result": [row]})
        collector = EtherscanCollector(api_key="test")
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)
        usdt_events = [e for e in events if e.token == "USDT"]
        assert usdt_events
        assert abs(usdt_events[0].amount_token - 1000.0) < 0.01

    @patch("src.ingestion.etherscan.requests.get")
    def test_counterparty_category_from_watched_index(self, mock_get):
        row = _etherscan_row(from_addr="0xwatch", to_addr="0xcex")
        mock_get.return_value = _mock_resp({"status": "1", "result": [row]})
        watched_index = {"0xcex": {"address": "0xcex", "category": "cex", "chain": "ETH"}}
        collector = EtherscanCollector(api_key="test")
        events = collector.fetch(["0xwatch"], "ETH", since_ts=0, watched_index=watched_index)
        assert events
        assert events[0].counterparty_category == "cex"

    @patch("src.ingestion.etherscan.requests.get")
    def test_all_evm_chains_accepted(self, mock_get):
        mock_get.return_value = _mock_resp({"status": "1", "result": []})
        collector = EtherscanCollector(api_key="test")
        for chain in ("ETH", "ARB", "BASE", "BSC", "POLYGON"):
            events = collector.fetch([], chain, since_ts=0)
            assert events == []


class TestEtherscanBackoff:
    @patch("src.utils.http_backoff.time.sleep")
    @patch("src.ingestion.etherscan.requests.get")
    def test_429_then_success(self, mock_get, mock_sleep):
        row = _etherscan_row()
        success = _mock_resp({"status": "1", "result": [row]})
        # txlist: 429 x2, then success; tokentx: success immediately
        mock_get.side_effect = [_mock_429(), _mock_429(), success, success]

        # rate_limit_per_sec=inf → _rate_limit never sleeps, so all sleep calls are backoff
        collector = EtherscanCollector(api_key="test", rate_limit_per_sec=float("inf"))
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)

        assert len(events) >= 1
        assert mock_sleep.call_count == 2

    @patch("src.utils.http_backoff.time.sleep")
    @patch("src.ingestion.etherscan.requests.get")
    def test_rate_limit_json_status_then_success(self, mock_get, mock_sleep):
        row = _etherscan_row()
        rate_limited = _mock_resp({"status": "0", "message": "Max rate limit reached", "result": []})
        success = _mock_resp({"status": "1", "result": [row]})
        # txlist: JSON rate-limit, then success; tokentx: success immediately
        mock_get.side_effect = [rate_limited, success, success]

        collector = EtherscanCollector(api_key="test", rate_limit_per_sec=float("inf"))
        events = collector.fetch(["0xaaa"], "ETH", since_ts=0)

        assert len(events) >= 1
        assert mock_sleep.call_count == 1

    @patch("src.utils.http_backoff.time.sleep")
    @patch("src.ingestion.etherscan.requests.get")
    def test_5_failures_raise_ingestion_error(self, mock_get, mock_sleep):
        mock_get.return_value = _mock_429()

        collector = EtherscanCollector(api_key="test", rate_limit_per_sec=float("inf"))
        with pytest.raises(EtherscanError):
            collector._fetch_page("0xaaa", "txlist", 1, 0)

        assert mock_get.call_count == 5
        assert mock_sleep.call_count == 5
