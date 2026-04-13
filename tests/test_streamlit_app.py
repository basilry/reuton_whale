from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

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
