"""Tests for TRACK 2 storage methods: watched_addresses, address_activity,
tg_whale_events, signals, weekly_trend, user_interests."""
import json
from unittest.mock import MagicMock, patch

import pytest

from src.storage.schema import (
    ADDRESS_ACTIVITY_HEADERS,
    ALL_TABS,
    SIGNALS_HEADERS,
    TAB_USER_INTERESTS,
    TAB_WATCHED_ADDRESSES,
    TG_WHALE_EVENTS_HEADERS,
    USER_INTERESTS_HEADERS,
    WATCHED_ADDRESSES_HEADERS,
    WEEKLY_TREND_HEADERS,
)


def _make_client():
    with patch("src.storage.sheets_client.gspread") as mock_gspread, \
         patch("src.storage.sheets_client.Credentials") as mock_creds:
        mock_creds.from_service_account_info.return_value = MagicMock()
        mock_gc = MagicMock()
        mock_gspread.authorize.return_value = mock_gc
        mock_ss = MagicMock()
        mock_gc.open_by_key.return_value = mock_ss
        mock_ss.worksheets.return_value = [MagicMock(title=t) for t in ALL_TABS]

        from src.storage.sheets_client import SheetsClient
        client = SheetsClient("fake_id", '{"type":"service_account"}')
        return client, mock_ss


# ---------------------------------------------------------------------------
# watched_addresses
# ---------------------------------------------------------------------------

class TestWatchedAddresses:
    def test_upsert_new_address_appends(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [WATCHED_ADDRESSES_HEADERS]

        client.upsert_watched_address({
            "address": "0xABC",
            "chain": "ETH",
            "category": "cex",
            "label": "Binance",
            "source": "manual",
            "confidence": "0.9",
            "enabled": "true",
        })
        mock_ws.append_row.assert_called_once()

    def test_upsert_existing_address_updates(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        row = [""] * len(WATCHED_ADDRESSES_HEADERS)
        row[WATCHED_ADDRESSES_HEADERS.index("address")] = "0xABC"
        row[WATCHED_ADDRESSES_HEADERS.index("label")] = "old_label"
        row[WATCHED_ADDRESSES_HEADERS.index("enabled")] = "true"
        mock_ws.get_all_values.return_value = [WATCHED_ADDRESSES_HEADERS, row]

        client.upsert_watched_address({"address": "0xABC", "label": "new_label"})
        mock_ws.append_row.assert_not_called()
        mock_ws.update.assert_called_once()
        written = mock_ws.update.call_args[0][1][0]
        assert written[WATCHED_ADDRESSES_HEADERS.index("label")] == "new_label"

    def test_list_watched_addresses_returns_all_as_dict(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        row_on = [""] * len(WATCHED_ADDRESSES_HEADERS)
        row_on[WATCHED_ADDRESSES_HEADERS.index("address")] = "0xON"
        row_on[WATCHED_ADDRESSES_HEADERS.index("enabled")] = "true"
        row_off = [""] * len(WATCHED_ADDRESSES_HEADERS)
        row_off[WATCHED_ADDRESSES_HEADERS.index("address")] = "0xOFF"
        row_off[WATCHED_ADDRESSES_HEADERS.index("enabled")] = "false"
        mock_ws.get_all_values.return_value = [WATCHED_ADDRESSES_HEADERS, row_on, row_off]

        result = client.list_watched_addresses()
        assert isinstance(result, dict)
        assert len(result) == 2
        assert "0xON" in result
        assert "0xOFF" in result

    def test_list_watched_addresses_evm_key_lowercased(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        row = [""] * len(WATCHED_ADDRESSES_HEADERS)
        row[WATCHED_ADDRESSES_HEADERS.index("address")] = "0xABCDEF"
        row[WATCHED_ADDRESSES_HEADERS.index("chain")] = "eth"
        mock_ws.get_all_values.return_value = [WATCHED_ADDRESSES_HEADERS, row]

        result = client.list_watched_addresses()
        assert "0xabcdef" in result
        assert "0xABCDEF" not in result


# ---------------------------------------------------------------------------
# address_activity
# ---------------------------------------------------------------------------

class TestAddressActivity:
    def test_append_deduplicates_by_tx_hash_watched_direction(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        existing = [""] * len(ADDRESS_ACTIVITY_HEADERS)
        existing[ADDRESS_ACTIVITY_HEADERS.index("tx_hash")] = "0xTX1"
        existing[ADDRESS_ACTIVITY_HEADERS.index("watched_address")] = "0xABC"
        existing[ADDRESS_ACTIVITY_HEADERS.index("direction")] = "in"
        mock_ws.get_all_values.return_value = [ADDRESS_ACTIVITY_HEADERS, existing]

        events = [
            {"tx_hash": "0xTX1", "watched_address": "0xABC", "direction": "in"},
            {"tx_hash": "0xTX2", "watched_address": "0xABC", "direction": "out"},
        ]
        count = client.append_address_activity(events)
        assert count == 1
        mock_ws.append_rows.assert_called_once()

    def test_append_all_new_events(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [ADDRESS_ACTIVITY_HEADERS]

        count = client.append_address_activity([
            {"tx_hash": "0xA", "watched_address": "0xABC", "direction": "in"},
            {"tx_hash": "0xB", "watched_address": "0xABC", "direction": "out"},
        ])
        assert count == 2


# ---------------------------------------------------------------------------
# tg_whale_events
# ---------------------------------------------------------------------------

class TestTgWhaleEvents:
    def test_append_new_event(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [TG_WHALE_EVENTS_HEADERS]

        client.append_tg_whale_event({"tg_msg_id": "42", "symbol": "BTC"})
        mock_ws.append_row.assert_called_once()

    def test_append_duplicate_event_noop(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        existing = [""] * len(TG_WHALE_EVENTS_HEADERS)
        existing[TG_WHALE_EVENTS_HEADERS.index("tg_msg_id")] = "42"
        mock_ws.get_all_values.return_value = [TG_WHALE_EVENTS_HEADERS, existing]

        client.append_tg_whale_event({"tg_msg_id": "42", "symbol": "BTC"})
        mock_ws.append_row.assert_not_called()


# ---------------------------------------------------------------------------
# signals
# ---------------------------------------------------------------------------

class TestSignals:
    def test_append_new_signal(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SIGNALS_HEADERS]

        client.append_signal({"signal_id": "sig-1", "rule": "large_tx", "severity": "high"})
        mock_ws.append_row.assert_called_once()

    def test_append_duplicate_signal_noop(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        existing = [""] * len(SIGNALS_HEADERS)
        existing[SIGNALS_HEADERS.index("signal_id")] = "sig-1"
        mock_ws.get_all_values.return_value = [SIGNALS_HEADERS, existing]

        client.append_signal({"signal_id": "sig-1", "rule": "large_tx"})
        mock_ws.append_row.assert_not_called()

    def test_append_signal_converts_extra_to_json(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SIGNALS_HEADERS]

        client.append_signal({"signal_id": "sig-2", "extra": {"k": "v"}})
        row_written = mock_ws.append_row.call_args[0][0]
        extra_json_col = SIGNALS_HEADERS.index("extra_json")
        assert json.loads(row_written[extra_json_col]) == {"k": "v"}


# ---------------------------------------------------------------------------
# weekly_trend
# ---------------------------------------------------------------------------

class TestWeeklyTrend:
    def test_save_weekly_trend_replaces_same_week(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        old_row = [""] * len(WEEKLY_TREND_HEADERS)
        old_row[WEEKLY_TREND_HEADERS.index("week_start")] = "2026-04-07"
        old_row[WEEKLY_TREND_HEADERS.index("category")] = "cex"
        mock_ws.get_all_values.return_value = [WEEKLY_TREND_HEADERS, old_row]

        new_rows = [{"week_start": "2026-04-07", "category": "dex", "chain": "ETH"}]
        client.save_weekly_trend(new_rows)

        mock_ws.clear.assert_called_once()
        mock_ws.update.assert_called_once()
        written = mock_ws.update.call_args[0][1]
        # header row + 1 new row; old row for same week_start removed
        assert len(written) == 2
        assert written[1][WEEKLY_TREND_HEADERS.index("category")] == "dex"

    def test_save_weekly_trend_noop_on_empty(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        client.save_weekly_trend([])
        mock_ws.clear.assert_not_called()


# ---------------------------------------------------------------------------
# user_interests
# ---------------------------------------------------------------------------

class TestUserInterests:
    def test_upsert_new_interest_appends(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [USER_INTERESTS_HEADERS]

        client.upsert_user_interest(1001, "chain", "ETH", 0.9, "manual")
        mock_ws.append_row.assert_called_once()

    def test_upsert_existing_interest_updates_weight(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        row = [""] * len(USER_INTERESTS_HEADERS)
        row[USER_INTERESTS_HEADERS.index("chat_id")] = "1001"
        row[USER_INTERESTS_HEADERS.index("dimension")] = "chain"
        row[USER_INTERESTS_HEADERS.index("value")] = "ETH"
        row[USER_INTERESTS_HEADERS.index("weight")] = "0.5"
        mock_ws.get_all_values.return_value = [USER_INTERESTS_HEADERS, row]

        client.upsert_user_interest(1001, "chain", "ETH", 0.95, "auto")
        mock_ws.append_row.assert_not_called()
        mock_ws.update.assert_called_once()
        written = mock_ws.update.call_args[0][1][0]
        assert written[USER_INTERESTS_HEADERS.index("weight")] == "0.95"

    def test_list_user_interests_filters_by_user_id(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        row1 = [""] * len(USER_INTERESTS_HEADERS)
        row1[USER_INTERESTS_HEADERS.index("chat_id")] = "1001"
        row2 = [""] * len(USER_INTERESTS_HEADERS)
        row2[USER_INTERESTS_HEADERS.index("chat_id")] = "9999"
        mock_ws.get_all_values.return_value = [USER_INTERESTS_HEADERS, row1, row2]

        result = client.list_user_interests(user_id="1001")
        assert len(result) == 1
        assert result[0]["chat_id"] == "1001"

    def test_list_user_interests_empty_sheet(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [USER_INTERESTS_HEADERS]

        assert client.list_user_interests(user_id="1001") == []


# ---------------------------------------------------------------------------
# save_analysis_log (protocol alias)
# ---------------------------------------------------------------------------

class TestSaveAnalysisLog:
    def test_save_analysis_log_delegates_to_save_analysis(self):
        client, mock_ss = _make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        client.save_analysis_log({"prompt_hash": "h1", "prompt": "p", "response": "{}", "model": "x", "tokens_used": 1})
        mock_ws.append_row.assert_called_once()


# ---------------------------------------------------------------------------
# schema: new tabs registered
# ---------------------------------------------------------------------------

class TestNewTabsRegistered:
    def test_new_tabs_in_all_tabs(self):
        from src.storage.schema import TAB_HEADERS
        for tab in [
            TAB_WATCHED_ADDRESSES, "address_activity", "tg_whale_events",
            "signals", "weekly_trend", TAB_USER_INTERESTS,
        ]:
            assert tab in ALL_TABS
            assert tab in TAB_HEADERS

    def test_new_tab_headers_no_duplicates(self):
        from src.storage.schema import TAB_HEADERS
        new_tabs = [
            TAB_WATCHED_ADDRESSES, "address_activity", "tg_whale_events",
            "signals", "weekly_trend", TAB_USER_INTERESTS,
        ]
        for tab in new_tabs:
            headers = TAB_HEADERS[tab]
            assert len(headers) == len(set(headers)), f"Duplicate headers in {tab}"
