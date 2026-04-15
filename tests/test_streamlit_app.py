import json
import os

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

# Ensure module import doesn't block on auth (empty password = auth disabled).
os.environ.setdefault("STREAMLIT_PASSWORD", "")

from src.storage.schema import DAILY_BRIEF_HEADERS, TRANSACTIONS_HEADERS


class TestLoadTransactions:
    @patch("streamlit_app.get_spreadsheet")
    def test_returns_empty_when_no_spreadsheet(self, mock_ss):
        mock_ss.return_value = None
        from streamlit_app import load_transactions
        load_transactions.clear()
        df = load_transactions()
        assert df.empty
        assert list(df.columns) == TRANSACTIONS_HEADERS

    @patch("streamlit_app.get_spreadsheet")
    def test_parses_numeric_columns(self, mock_ss):
        mock_ws = MagicMock()
        mock_ws.get_all_values.return_value = [
            TRANSACTIONS_HEADERS,
            [
                "hash1", "txhash", "1700000000", "bitcoin", "BTC",
                "1.5", "50000", "addr1", "unknown", "", "addr2", "exchange", "Binance",
                "2026-01-01T00:00:00",
            ],
        ]
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.return_value = mock_ws
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_transactions
        load_transactions.clear()
        df = load_transactions()
        assert len(df) == 1
        assert df.iloc[0]["amount"] == 1.5
        assert df.iloc[0]["amount_usd"] == 50000.0


class TestLoadDailyBriefs:
    @patch("streamlit_app.get_spreadsheet")
    def test_returns_empty_when_no_spreadsheet(self, mock_ss):
        mock_ss.return_value = None
        from streamlit_app import load_daily_briefs
        load_daily_briefs.clear()
        df = load_daily_briefs()
        assert df.empty
        assert list(df.columns) == DAILY_BRIEF_HEADERS

    @patch("streamlit_app.get_spreadsheet")
    def test_parses_briefs(self, mock_ss):
        mock_ws = MagicMock()
        mock_ws.get_all_values.return_value = [
            DAILY_BRIEF_HEADERS,
            ["2026-04-14", "test summary", "[]", "100000", "5", "2026-04-14T00:00:00"],
        ]
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.return_value = mock_ws
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_daily_briefs
        load_daily_briefs.clear()
        df = load_daily_briefs()
        assert len(df) == 1
        assert df.iloc[0]["total_volume_usd"] == 100000.0
        assert df.iloc[0]["alert_count"] == 5

    @patch("streamlit_app.get_spreadsheet")
    def test_top_transactions_dict_list_roundtrip(self, mock_ss):
        # Main.py now stores top_transactions as a JSON-encoded dict list.
        # Streamlit reads that column and parses it inline; verify the round-trip
        # against the format main.py emits.
        top_txs = [
            {
                "hash": "h1",
                "symbol": "BTC",
                "amount_usd": 50_000_000,
                "importance_score": 8,
                "interpretation": "Big move",
                "type": "distribution",
            }
        ]
        payload = json.dumps(top_txs, ensure_ascii=False)
        mock_ws = MagicMock()
        mock_ws.get_all_values.return_value = [
            DAILY_BRIEF_HEADERS,
            ["2026-04-14", "summary", payload, "100000", "1", "2026-04-14T00:00:00"],
        ]
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.return_value = mock_ws
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_daily_briefs
        load_daily_briefs.clear()
        df = load_daily_briefs()
        parsed = json.loads(df.iloc[0]["top_transactions"])
        assert isinstance(parsed, list)
        assert parsed[0]["symbol"] == "BTC"
        assert parsed[0]["importance_score"] == 8
        assert set(parsed[0].keys()) >= {
            "hash", "symbol", "amount_usd", "importance_score", "interpretation", "type"
        }


class TestFormatTopTransactionUsd:
    def test_formats_known_amount(self):
        from streamlit_app import format_top_transaction_usd

        assert format_top_transaction_usd({"amount_usd": 1234567.8}) == "$1,234,568"

    def test_handles_unknown_amount(self):
        from streamlit_app import format_top_transaction_usd

        assert format_top_transaction_usd({
            "amount_usd": None,
            "amount_usd_known": False,
        }) == "USD unknown"

    def test_handles_invalid_amount(self):
        from streamlit_app import format_top_transaction_usd

        assert format_top_transaction_usd({"amount_usd": "n/a"}) == "USD unknown"
