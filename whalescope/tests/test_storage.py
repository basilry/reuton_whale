import json
from unittest.mock import MagicMock, patch

import pytest

from src.storage.queries import dict_to_row, now_iso, row_to_dict
from src.storage.schema import (
    ALL_TABS,
    ANALYSIS_LOG_HEADERS,
    DAILY_BRIEF_HEADERS,
    SYSTEM_LOG_HEADERS,
    TAB_HEADERS,
    TAB_TRANSACTIONS,
    TRANSACTIONS_HEADERS,
    WATCHLIST_HEADERS,
)


class TestSchema:
    def test_all_tabs_count(self):
        assert len(ALL_TABS) == 5

    def test_tab_headers_keys_match_all_tabs(self):
        assert set(TAB_HEADERS.keys()) == set(ALL_TABS)

    def test_transactions_has_raw_response_hash(self):
        assert "raw_response_hash" in TRANSACTIONS_HEADERS

    def test_no_duplicate_headers(self):
        for tab, headers in TAB_HEADERS.items():
            assert len(headers) == len(set(headers)), f"Duplicate headers in {tab}"


class TestQueries:
    def test_dict_to_row_ordered(self):
        headers = ["a", "b", "c"]
        data = {"c": "3", "a": "1", "b": "2"}
        assert dict_to_row(data, headers) == ["1", "2", "3"]

    def test_dict_to_row_missing_key(self):
        headers = ["a", "b", "c"]
        data = {"a": "1"}
        assert dict_to_row(data, headers) == ["1", "", ""]

    def test_dict_to_row_list_value(self):
        headers = ["coins"]
        data = {"coins": ["BTC", "ETH"]}
        row = dict_to_row(data, headers)
        assert json.loads(row[0]) == ["BTC", "ETH"]

    def test_dict_to_row_none_value(self):
        headers = ["x"]
        data = {"x": None}
        assert dict_to_row(data, headers) == [""]

    def test_row_to_dict(self):
        headers = ["a", "b", "c"]
        row = ["1", "2", "3"]
        assert row_to_dict(row, headers) == {"a": "1", "b": "2", "c": "3"}

    def test_row_to_dict_short_row(self):
        headers = ["a", "b", "c"]
        row = ["1"]
        result = row_to_dict(row, headers)
        assert result == {"a": "1", "b": "", "c": ""}

    def test_now_iso_format(self):
        ts = now_iso()
        assert "T" in ts
        assert "+" in ts or "Z" in ts


class TestSheetsClient:
    def _make_client(self):
        with patch("src.storage.sheets_client.gspread") as mock_gspread, \
             patch("src.storage.sheets_client.Credentials") as mock_creds:
            mock_creds.from_service_account_info.return_value = MagicMock()
            mock_gc = MagicMock()
            mock_gspread.authorize.return_value = mock_gc
            mock_spreadsheet = MagicMock()
            mock_gc.open_by_key.return_value = mock_spreadsheet

            # All worksheets exist
            mock_ws_list = [MagicMock(title=t) for t in ALL_TABS]
            mock_spreadsheet.worksheets.return_value = mock_ws_list

            from src.storage.sheets_client import SheetsClient
            client = SheetsClient("fake_sheet_id", '{"type":"service_account"}')
            return client, mock_spreadsheet

    def test_init_opens_spreadsheet(self):
        client, mock_ss = self._make_client()
        assert client._spreadsheet == mock_ss

    def test_append_transactions_deduplicates(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        # Existing row with hash "abc"
        hash_col = TRANSACTIONS_HEADERS.index("raw_response_hash")
        existing_row = [""] * len(TRANSACTIONS_HEADERS)
        existing_row[hash_col] = "abc"
        mock_ws.get_all_values.return_value = [TRANSACTIONS_HEADERS, existing_row]

        txs = [
            {"raw_response_hash": "abc", "hash": "h1"},  # duplicate
            {"raw_response_hash": "def", "hash": "h2"},  # new
        ]
        count = client.append_transactions(txs)
        assert count == 1
        mock_ws.append_rows.assert_called_once()
        appended = mock_ws.append_rows.call_args[0][0]
        assert len(appended) == 1

    def test_append_transactions_empty_sheet(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [TRANSACTIONS_HEADERS]

        count = client.append_transactions([{"raw_response_hash": "x", "hash": "h"}])
        assert count == 1

    def test_get_daily_brief_filters_by_date(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        date_col = DAILY_BRIEF_HEADERS.index("date")
        row1 = [""] * len(DAILY_BRIEF_HEADERS)
        row1[date_col] = "2026-04-14"
        row2 = [""] * len(DAILY_BRIEF_HEADERS)
        row2[date_col] = "2026-04-13"
        mock_ws.get_all_values.return_value = [DAILY_BRIEF_HEADERS, row1, row2]

        result = client.get_daily_brief("2026-04-14")
        assert len(result) == 1
        assert result[0]["date"] == "2026-04-14"

    def test_get_active_watchlists(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        active_col = WATCHLIST_HEADERS.index("active")
        uid_col = WATCHLIST_HEADERS.index("user_id")
        row1 = [""] * len(WATCHLIST_HEADERS)
        row1[active_col] = "true"
        row1[uid_col] = "1"
        row2 = [""] * len(WATCHLIST_HEADERS)
        row2[active_col] = "false"
        row2[uid_col] = "2"
        mock_ws.get_all_values.return_value = [WATCHLIST_HEADERS, row1, row2]

        result = client.get_active_watchlists()
        assert len(result) == 1
        assert result[0]["user_id"] == "1"

    def test_upsert_watchlist_insert(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [WATCHLIST_HEADERS]

        client.upsert_watchlist(123, "alice", ["BTC", "ETH"])
        mock_ws.append_row.assert_called_once()

    def test_upsert_watchlist_update(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        uid_col = WATCHLIST_HEADERS.index("user_id")
        existing = [""] * len(WATCHLIST_HEADERS)
        existing[uid_col] = "123"
        mock_ws.get_all_values.return_value = [WATCHLIST_HEADERS, existing]

        client.upsert_watchlist(123, "alice", ["BTC"])
        mock_ws.update.assert_called_once()

    def test_get_cached_analysis_found(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        hash_col = ANALYSIS_LOG_HEADERS.index("prompt_hash")
        row = [""] * len(ANALYSIS_LOG_HEADERS)
        row[hash_col] = "hash123"
        mock_ws.get_all_values.return_value = [ANALYSIS_LOG_HEADERS, row]

        result = client.get_cached_analysis("hash123")
        assert result is not None
        assert result["prompt_hash"] == "hash123"

    def test_get_cached_analysis_not_found(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [ANALYSIS_LOG_HEADERS]

        assert client.get_cached_analysis("missing") is None

    def test_ensure_worksheets_creates_missing(self):
        with patch("src.storage.sheets_client.gspread") as mock_gspread, \
             patch("src.storage.sheets_client.Credentials") as mock_creds:
            mock_creds.from_service_account_info.return_value = MagicMock()
            mock_gc = MagicMock()
            mock_gspread.authorize.return_value = mock_gc
            mock_ss = MagicMock()
            mock_gc.open_by_key.return_value = mock_ss
            # No existing worksheets
            mock_ss.worksheets.return_value = []
            mock_ss.add_worksheet.return_value = MagicMock()

            from src.storage.sheets_client import SheetsClient
            SheetsClient("id", '{"type":"service_account"}')
            assert mock_ss.add_worksheet.call_count == 5
