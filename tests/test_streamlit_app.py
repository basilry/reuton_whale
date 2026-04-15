import json
import os

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

# Ensure module import doesn't block on auth (empty password = auth disabled).
os.environ.setdefault("STREAMLIT_PASSWORD", "")

from src.storage.schema import DAILY_BRIEF_HEADERS, SIGNALS_HEADERS, TRANSACTIONS_HEADERS


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

    @patch("streamlit_app.get_spreadsheet")
    def test_returns_empty_when_sheets_read_fails(self, mock_ss):
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.side_effect = RuntimeError("network down")
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_transactions
        load_transactions.clear()
        df = load_transactions()
        assert df.empty
        assert list(df.columns) == TRANSACTIONS_HEADERS


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
    def test_returns_empty_when_brief_read_fails(self, mock_ss):
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.side_effect = RuntimeError("network down")
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_daily_briefs
        load_daily_briefs.clear()
        df = load_daily_briefs()
        assert df.empty
        assert list(df.columns) == DAILY_BRIEF_HEADERS

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


class TestLoadSignals:
    @patch("streamlit_app.get_spreadsheet")
    def test_returns_empty_when_no_spreadsheet(self, mock_ss):
        mock_ss.return_value = None
        from streamlit_app import load_signals

        load_signals.clear()
        df = load_signals()

        assert df.empty
        assert list(df.columns) == SIGNALS_HEADERS

    @patch("streamlit_app.get_spreadsheet")
    def test_parses_signal_rows(self, mock_ss):
        mock_ws = MagicMock()
        mock_ws.get_all_values.return_value = [
            SIGNALS_HEADERS,
            [
                "sig-1",
                "2026-04-15T10:00:00",
                "large_tx",
                "high",
                "8.5",
                "0.92",
                "both",
                '["0xabc"]',
                "2026-04-15T09:00:00",
                "2026-04-15T10:00:00",
                "Large transfer detected",
                "{}",
            ],
        ]
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.return_value = mock_ws
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_signals

        load_signals.clear()
        df = load_signals()

        assert len(df) == 1
        assert df.iloc[0]["rule"] == "large_tx"
        assert df.iloc[0]["severity"] == "high"
        assert df.iloc[0]["score"] == 8.5
        assert df.iloc[0]["created_at"].year == 2026

    @patch("streamlit_app.st.warning")
    @patch("streamlit_app.get_spreadsheet")
    def test_returns_empty_and_warns_when_sheet_read_fails(self, mock_ss, mock_warning):
        mock_spreadsheet = MagicMock()
        mock_spreadsheet.worksheet.side_effect = RuntimeError("network down")
        mock_ss.return_value = mock_spreadsheet

        from streamlit_app import load_signals

        load_signals.clear()
        df = load_signals()

        assert df.empty
        assert list(df.columns) == SIGNALS_HEADERS
        mock_warning.assert_called_once()


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


class TestRunDailyPipeline:
    @patch("streamlit_app.subprocess.run")
    def test_run_daily_pipeline_success(self, mock_run):
        from streamlit_app import run_daily_pipeline

        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="ok",
            stderr="",
        )

        result = run_daily_pipeline(timeout_seconds=1)

        assert result["ok"] is True
        assert result["timed_out"] is False
        assert result["returncode"] == 0
        assert result["stdout"] == "ok"
        mock_run.assert_called_once()
        assert mock_run.call_args.args[0][-2:] == ["-m", "src.main"]

    @patch("streamlit_app.subprocess.run")
    def test_run_daily_pipeline_timeout(self, mock_run):
        from streamlit_app import run_daily_pipeline, subprocess

        mock_run.side_effect = subprocess.TimeoutExpired(
            cmd=["python", "-m", "src.main"],
            timeout=1,
            output="partial",
            stderr="slow",
        )

        result = run_daily_pipeline(timeout_seconds=1)

        assert result["ok"] is False
        assert result["timed_out"] is True
        assert result["returncode"] is None
        assert "partial" in result["stdout"]
        assert "slow" in result["stderr"]

    def test_tail_text_decodes_timeout_bytes(self):
        from streamlit_app import _tail_text

        assert _tail_text(b"hello") == "hello"
