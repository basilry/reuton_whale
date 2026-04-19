import json
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from src.storage.queries import dict_to_row, now_iso, row_to_dict
from src.storage.schema import (
    ADDRESS_ACTIVITY_HEADERS,
    ALL_TABS,
    ANALYSIS_LOG_HEADERS,
    BRIEF_COST_LEDGER_HEADERS,
    BROADCAST_LOG_HEADERS,
    SERVICE_HEALTH_HEADERS,
    DAILY_BRIEF_HEADERS,
    SUBSCRIBERS_HEADERS,
    SYSTEM_LOG_HEADERS,
    TAB_HEADERS,
    TAB_SUBSCRIBERS,
    TAB_TRANSACTIONS,
    TRANSACTIONS_HEADERS,
    USER_INTERESTS_HEADERS,
    WATCHED_ADDRESSES_HEADERS,
)


class TestSchema:
    def test_all_tabs_count(self):
        assert len(ALL_TABS) == len(set(ALL_TABS))

    def test_tab_headers_keys_match_all_tabs(self):
        assert set(TAB_HEADERS.keys()) == set(ALL_TABS)

    def test_transactions_has_raw_response_hash(self):
        assert "raw_response_hash" in TRANSACTIONS_HEADERS

    def test_no_duplicate_headers(self):
        for tab, headers in TAB_HEADERS.items():
            assert len(headers) == len(set(headers)), f"Duplicate headers in {tab}"

    def test_subscribers_headers_contain_required_fields(self):
        required = {
            "chat_id",
            "username",
            "status",
            "watchlist_coins",
            "created_at",
            "updated_at",
            "last_brief_at",
            "status_changed_at",
        }
        assert required.issubset(set(SUBSCRIBERS_HEADERS))

    def test_subscribers_tab_registered(self):
        assert TAB_SUBSCRIBERS in ALL_TABS
        assert TAB_HEADERS[TAB_SUBSCRIBERS] == SUBSCRIBERS_HEADERS

    def test_service_health_headers_include_v2_tail_columns(self):
        assert SERVICE_HEALTH_HEADERS[:15] == [
            "ts",
            "service",
            "component",
            "status",
            "heartbeat_key",
            "details",
            "error",
            "instance_id",
            "job_name",
            "last_success_at",
            "last_failure_at",
            "processed_count",
            "lag_seconds",
            "duration_ms",
            "source_name",
        ]
        assert SERVICE_HEALTH_HEADERS[-4:] == [
            "supported_chains",
            "unsupported_chain_count",
            "unsupported_chain_names",
            "per_chain_event_count",
        ]

    def test_service_health_headers_keep_v2_columns_append_only(self):
        assert SERVICE_HEALTH_HEADERS[7:15] == [
            "instance_id",
            "job_name",
            "last_success_at",
            "last_failure_at",
            "processed_count",
            "lag_seconds",
            "duration_ms",
            "source_name",
        ]


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


def _make_sub_row(
    chat_id,
    username="",
    status="active",
    coins="",
    created="",
    updated="",
    last_brief="",
    status_changed="",
):
    row = [""] * len(SUBSCRIBERS_HEADERS)
    row[SUBSCRIBERS_HEADERS.index("chat_id")] = str(chat_id)
    row[SUBSCRIBERS_HEADERS.index("username")] = username
    row[SUBSCRIBERS_HEADERS.index("status")] = status
    row[SUBSCRIBERS_HEADERS.index("watchlist_coins")] = coins
    row[SUBSCRIBERS_HEADERS.index("created_at")] = created
    row[SUBSCRIBERS_HEADERS.index("updated_at")] = updated
    row[SUBSCRIBERS_HEADERS.index("last_brief_at")] = last_brief
    row[SUBSCRIBERS_HEADERS.index("status_changed_at")] = status_changed
    return row


class TestSheetsClient:
    def _make_client(self):
        with patch("src.storage.sheets_client.gspread") as mock_gspread, \
             patch("src.storage.sheets_client.Credentials") as mock_creds:
            mock_creds.from_service_account_info.return_value = MagicMock()
            mock_gc = MagicMock()
            mock_gspread.authorize.return_value = mock_gc
            mock_spreadsheet = MagicMock()
            mock_gc.open_by_key.return_value = mock_spreadsheet

            mock_ws_list = [MagicMock(title=t) for t in ALL_TABS]
            mock_spreadsheet.worksheets.return_value = mock_ws_list

            from src.storage.sheets_client import SheetsClient
            client = SheetsClient("fake_sheet_id", '{"type":"service_account"}')
            return client, mock_spreadsheet

    def test_init_opens_spreadsheet(self):
        client, mock_ss = self._make_client()
        assert client._spreadsheet == mock_ss

    def test_worksheet_cache_reuses_spreadsheet_lookup(self):
        client, mock_ss = self._make_client()

        first = client._worksheet(TAB_TRANSACTIONS)
        second = client._worksheet(TAB_TRANSACTIONS)

        assert first == second
        mock_ss.worksheet.assert_called_once_with(TAB_TRANSACTIONS)

    def test_append_transactions_deduplicates(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        hash_col = TRANSACTIONS_HEADERS.index("raw_response_hash")
        existing_row = [""] * len(TRANSACTIONS_HEADERS)
        existing_row[hash_col] = "abc"
        mock_ws.get_all_values.return_value = [TRANSACTIONS_HEADERS, existing_row]

        txs = [
            {"raw_response_hash": "abc", "hash": "h1"},
            {"raw_response_hash": "def", "hash": "h2"},
        ]
        count = client.append_transactions(txs)
        assert count == 1
        mock_ws.append_rows.assert_called_once()

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

    def test_append_broadcast_log_extends_schema_and_writes_new_metadata(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ws.col_count = 7
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [BROADCAST_LOG_HEADERS[:7]]

        client.append_broadcast_log(
            {
                "kind": "broadcast_periodic",
                "dedup_key": "broadcast_periodic:20260419T1015",
                "chat_id": "@channel",
                "status": "dry_run",
                "message_length": 1500,
                "content_hash": "abc123",
                "signal_count": 2,
                "transaction_count": 4,
                "slot_key": "20260419T1015",
                "delivery_mode": "dry_run",
            }
        )

        mock_ws.update.assert_called_once()
        row = mock_ws.append_row.call_args[0][0]
        assert row[BROADCAST_LOG_HEADERS.index("message_length")] == "1500"
        assert row[BROADCAST_LOG_HEADERS.index("content_hash")] == "abc123"
        assert row[BROADCAST_LOG_HEADERS.index("delivery_mode")] == "dry_run"

    def test_append_service_health_extends_schema_and_writes_v2_metadata(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ws.col_count = 7
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SERVICE_HEALTH_HEADERS[:7]]

        client.append_service_health(
            {
                "ts": "2026-04-19T01:00:00+00:00",
                "service": "pipeline.run_all",
                "component": "orchestrator",
                "status": "ok",
                "heartbeat_key": "run_all:20260419T1000",
                "details": "{}",
                "error": "",
                "instance_id": "i-123",
                "job_name": "dispatcher",
                "last_success_at": "2026-04-19T01:00:00+00:00",
                "processed_count": 4,
                "lag_seconds": 12,
                "duration_ms": 321,
                "source_name": "scheduler",
                "supported_chains": "ARB,BASE,BSC,ETH,POLYGON,SOL",
                "unsupported_chain_count": 2,
                "unsupported_chain_names": "BTC=1,XRP=1",
                "per_chain_event_count": "ETH=3,SOL=2",
            }
        )

        mock_ws.update.assert_called_once()
        row = mock_ws.append_row.call_args[0][0]
        assert row[SERVICE_HEALTH_HEADERS.index("instance_id")] == "i-123"
        assert row[SERVICE_HEALTH_HEADERS.index("job_name")] == "dispatcher"
        assert row[SERVICE_HEALTH_HEADERS.index("processed_count")] == "4"
        assert row[SERVICE_HEALTH_HEADERS.index("duration_ms")] == "321"
        assert row[SERVICE_HEALTH_HEADERS.index("supported_chains")] == "ARB,BASE,BSC,ETH,POLYGON,SOL"
        assert row[SERVICE_HEALTH_HEADERS.index("unsupported_chain_count")] == "2"
        assert row[SERVICE_HEALTH_HEADERS.index("unsupported_chain_names")] == "BTC=1,XRP=1"
        assert row[SERVICE_HEALTH_HEADERS.index("per_chain_event_count")] == "ETH=3,SOL=2"

    def test_append_service_health_keeps_optional_v21_fields_blank_when_missing(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ws.col_count = len(SERVICE_HEALTH_HEADERS)
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SERVICE_HEALTH_HEADERS]

        client.append_service_health(
            {
                "service": "pipeline.signals",
                "component": "collector",
                "status": "ok",
            }
        )

        row = mock_ws.append_row.call_args[0][0]
        assert row[SERVICE_HEALTH_HEADERS.index("supported_chains")] == ""
        assert row[SERVICE_HEALTH_HEADERS.index("unsupported_chain_count")] == ""
        assert row[SERVICE_HEALTH_HEADERS.index("unsupported_chain_names")] == ""
        assert row[SERVICE_HEALTH_HEADERS.index("per_chain_event_count")] == ""

    def test_append_service_health_verifies_schema_only_once_per_client(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ws.col_count = len(SERVICE_HEALTH_HEADERS)
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SERVICE_HEALTH_HEADERS]

        client.append_service_health({"service": "pipeline.signals", "component": "pipeline", "status": "ok"})
        client.append_service_health({"service": "pipeline.signals", "component": "pipeline", "status": "ok"})

        assert mock_ws.get_all_values.call_count == 1

    def test_append_and_list_brief_cost_ledger(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ws.col_count = len(BRIEF_COST_LEDGER_HEADERS)
        mock_ss.worksheet.return_value = mock_ws
        ledger_entry = {
            "ts": "2026-04-19T01:00:00+00:00",
            "slot_key": "20260419T1000KST",
            "decision": "generated",
            "llm_called": "true",
            "model_id": "gemini/gemini-2.5-flash",
            "tokens_in": 120,
            "tokens_out": 80,
            "cost_usd": 0.01,
            "cumulative_cost_usd": 1.25,
            "signal_count": 3,
            "transaction_count": 9,
            "input_fingerprint": "fp-1",
            "reason": "generated",
        }
        mock_ws.get_all_values.side_effect = [
            [BRIEF_COST_LEDGER_HEADERS],
            [BRIEF_COST_LEDGER_HEADERS, dict_to_row(ledger_entry, BRIEF_COST_LEDGER_HEADERS)],
        ]

        client.append_brief_cost_ledger(ledger_entry)
        rows = client.list_brief_cost_ledger(
            since=datetime.fromisoformat("2026-04-19T00:30:00+00:00")
        )

        row = mock_ws.append_row.call_args[0][0]
        assert row[BRIEF_COST_LEDGER_HEADERS.index("decision")] == "generated"
        assert row[BRIEF_COST_LEDGER_HEADERS.index("llm_called")] == "true"
        assert rows[0]["input_fingerprint"] == "fp-1"

    def test_get_active_subscribers_filters_by_status(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(1, "alice", "active", "BTC,ETH"),
            _make_sub_row(2, "bob", "paused", "SOL"),
            _make_sub_row(3, "carol", "active", ""),
        ]

        result = client.get_active_subscribers()
        assert len(result) == 2
        ids = [r["chat_id"] for r in result]
        assert ids == [1, 3]
        # watchlist parsed to list
        assert result[0]["watchlist"] == ["BTC", "ETH"]
        assert result[1]["watchlist"] == []

    def test_list_subscribers_filters_for_churn_statuses(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(1, "alice", "active", status_changed="2026-04-10T00:00:00+00:00"),
            _make_sub_row(2, "bob", "blocked", status_changed="2026-04-11T00:00:00+00:00"),
            _make_sub_row(3, "carol", "deactivated", status_changed="2026-04-12T00:00:00+00:00"),
        ]

        result = client.list_subscribers(statuses=["blocked", "deactivated"])

        assert [row["chat_id"] for row in result] == [2, 3]
        assert result[0]["status"] == "blocked"
        assert result[0]["status_changed_at"] == "2026-04-11T00:00:00+00:00"
        assert result[1]["status"] == "deactivated"

    def test_add_subscriber_new(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SUBSCRIBERS_HEADERS]

        with patch("src.storage.sheets_client.now_iso", return_value="2026-04-19T00:00:00+00:00"):
            client.add_subscriber(chat_id=100, username="alice")
        mock_ws.append_row.assert_called_once()
        row_data = mock_ws.append_row.call_args[0][0]
        assert row_data[SUBSCRIBERS_HEADERS.index("chat_id")] == "100"
        assert row_data[SUBSCRIBERS_HEADERS.index("username")] == "alice"
        assert row_data[SUBSCRIBERS_HEADERS.index("status")] == "active"
        assert row_data[SUBSCRIBERS_HEADERS.index("updated_at")] == "2026-04-19T00:00:00+00:00"
        assert row_data[SUBSCRIBERS_HEADERS.index("status_changed_at")] == "2026-04-19T00:00:00+00:00"

    def test_add_subscriber_reactivates_existing(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(
                100,
                "alice",
                "paused",
                "BTC",
                created="old",
                status_changed="2026-04-01T00:00:00+00:00",
            ),
        ]

        with patch("src.storage.sheets_client.now_iso", return_value="2026-04-19T00:00:00+00:00"):
            client.add_subscriber(chat_id=100, username="alice")
        mock_ws.append_row.assert_not_called()
        mock_ws.update.assert_called_once()
        row_written = mock_ws.update.call_args[0][1][0]
        assert row_written[SUBSCRIBERS_HEADERS.index("status")] == "active"
        # preserved watchlist
        assert row_written[SUBSCRIBERS_HEADERS.index("watchlist_coins")] == "BTC"
        assert row_written[SUBSCRIBERS_HEADERS.index("created_at")] == "old"
        assert row_written[SUBSCRIBERS_HEADERS.index("updated_at")] == "2026-04-19T00:00:00+00:00"
        assert row_written[SUBSCRIBERS_HEADERS.index("status_changed_at")] == "2026-04-19T00:00:00+00:00"

    def test_get_watchlist_returns_list(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(100, "alice", "active", "btc, eth , sol"),
        ]

        assert client.get_watchlist(chat_id=100) == ["BTC", "ETH", "SOL"]

    def test_get_watchlist_missing_subscriber(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SUBSCRIBERS_HEADERS]

        assert client.get_watchlist(chat_id=404) == []

    def test_set_watchlist_updates_existing(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(100, "alice", "active", "BTC"),
        ]

        client.set_watchlist(chat_id=100, coins=["eth", "sol"])
        mock_ws.update.assert_called_once()
        row_written = mock_ws.update.call_args[0][1][0]
        assert row_written[SUBSCRIBERS_HEADERS.index("watchlist_coins")] == "ETH,SOL"

    def test_set_watchlist_preserves_status_changed_at(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(
                100,
                "alice",
                "active",
                "BTC",
                updated="2026-04-10T00:00:00+00:00",
                status_changed="2026-04-01T00:00:00+00:00",
            ),
        ]

        with patch("src.storage.sheets_client.now_iso", return_value="2026-04-19T00:00:00+00:00"):
            client.set_watchlist(chat_id=100, coins=["eth", "sol"])

        row_written = mock_ws.update.call_args[0][1][0]
        assert row_written[SUBSCRIBERS_HEADERS.index("updated_at")] == "2026-04-19T00:00:00+00:00"
        assert row_written[SUBSCRIBERS_HEADERS.index("status_changed_at")] == "2026-04-01T00:00:00+00:00"

    def test_set_watchlist_creates_when_missing(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SUBSCRIBERS_HEADERS]

        client.set_watchlist(chat_id=200, coins=["BTC"])
        mock_ws.append_row.assert_called_once()

    def test_set_status_paused(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(
                100,
                "alice",
                "active",
                "BTC",
                updated="2026-04-10T00:00:00+00:00",
                status_changed="2026-04-01T00:00:00+00:00",
            ),
        ]

        with patch("src.storage.sheets_client.now_iso", return_value="2026-04-19T00:00:00+00:00"):
            client.set_status(chat_id=100, status="paused")
        row_written = mock_ws.update.call_args[0][1][0]
        assert row_written[SUBSCRIBERS_HEADERS.index("status")] == "paused"
        assert row_written[SUBSCRIBERS_HEADERS.index("updated_at")] == "2026-04-19T00:00:00+00:00"
        assert row_written[SUBSCRIBERS_HEADERS.index("status_changed_at")] == "2026-04-19T00:00:00+00:00"

    def test_set_status_same_status_preserves_status_changed_at(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(
                100,
                "alice",
                "paused",
                "BTC",
                updated="2026-04-10T00:00:00+00:00",
                status_changed="2026-04-01T00:00:00+00:00",
            ),
        ]

        with patch("src.storage.sheets_client.now_iso", return_value="2026-04-19T00:00:00+00:00"):
            client.set_status(chat_id=100, status="paused")

        row_written = mock_ws.update.call_args[0][1][0]
        assert row_written[SUBSCRIBERS_HEADERS.index("status")] == "paused"
        assert row_written[SUBSCRIBERS_HEADERS.index("updated_at")] == "2026-04-19T00:00:00+00:00"
        assert row_written[SUBSCRIBERS_HEADERS.index("status_changed_at")] == "2026-04-01T00:00:00+00:00"

    def test_set_status_invalid_raises(self):
        from src.utils.errors import StorageError
        client, mock_ss = self._make_client()

        with pytest.raises(StorageError, match="Invalid status"):
            client.set_status(chat_id=100, status="garbage")

    def test_set_status_missing_subscriber_raises(self):
        from src.utils.errors import StorageError
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SUBSCRIBERS_HEADERS]

        with pytest.raises(StorageError, match="not found"):
            client.set_status(chat_id=404, status="paused")

    def test_get_subscriber_info_hit(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(
                100,
                "alice",
                "active",
                "BTC,ETH",
                last_brief="2026-04-14",
                status_changed="2026-04-10T00:00:00+00:00",
            ),
        ]

        info = client.get_subscriber_info(chat_id=100)
        assert info is not None
        assert info["chat_id"] == 100
        assert info["status"] == "active"
        assert info["watchlist"] == ["BTC", "ETH"]
        assert info["last_brief_at"] == "2026-04-14"
        assert info["status_changed_at"] == "2026-04-10T00:00:00+00:00"

    def test_get_subscriber_info_miss(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SUBSCRIBERS_HEADERS]

        assert client.get_subscriber_info(chat_id=404) is None

    def test_legacy_get_active_watchlists_maps_from_subscribers(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SUBSCRIBERS_HEADERS,
            _make_sub_row(1, "alice", "active", "BTC"),
            _make_sub_row(2, "bob", "paused", "ETH"),
        ]

        result = client.get_active_watchlists()
        assert len(result) == 1
        assert result[0]["user_id"] == 1
        assert result[0]["coins"] == ["BTC"]
        assert result[0]["active"] == "true"

    def test_legacy_upsert_watchlist_uses_subscribers(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        # Simulate row appearing after add_subscriber so that set_watchlist updates it.
        row = _make_sub_row(123, "alice", "active")
        states = iter([
            [SUBSCRIBERS_HEADERS],            # add_subscriber initial read
            [SUBSCRIBERS_HEADERS, row],       # set_watchlist sees the row after insert
        ])
        mock_ws.get_all_values.side_effect = lambda: next(states)

        client.upsert_watchlist(user_id=123, username="alice", coins=["BTC", "ETH"])
        mock_ws.append_row.assert_called_once()
        mock_ws.update.assert_called_once()
        row_written = mock_ws.update.call_args[0][1][0]
        assert row_written[SUBSCRIBERS_HEADERS.index("watchlist_coins")] == "BTC,ETH"

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

    def test_save_analysis_appends_row(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        client.save_analysis({
            "prompt_hash": "h1",
            "prompt": "p",
            "response": "{}",
            "model": "claude",
            "tokens_used": 10,
        })
        mock_ws.append_row.assert_called_once()

    def test_save_analysis_log_preserves_llm_telemetry_fields(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        client.save_analysis_log({
            "task": "daily_brief",
            "model_id": "claude-sonnet-4-20250514",
            "prompt_version": "system-v1+user-v1",
            "tokens_in": 120,
            "tokens_out": 80,
            "cost_usd": 0.0123,
            "latency_ms": 950,
        })

        row = mock_ws.append_row.call_args[0][0]
        assert row[ANALYSIS_LOG_HEADERS.index("task")] == "daily_brief"
        assert row[ANALYSIS_LOG_HEADERS.index("model_id")] == "claude-sonnet-4-20250514"
        assert row[ANALYSIS_LOG_HEADERS.index("prompt_version")] == "system-v1+user-v1"
        assert row[ANALYSIS_LOG_HEADERS.index("tokens_in")] == "120"
        assert row[ANALYSIS_LOG_HEADERS.index("tokens_out")] == "80"
        assert row[ANALYSIS_LOG_HEADERS.index("cost_usd")] == "0.0123"
        assert row[ANALYSIS_LOG_HEADERS.index("latency_ms")] == "950"

    def test_append_system_log_maps_to_system_log_schema(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws

        payload = {"symbol": "DOGE", "count": 3}

        client.append_system_log("warning", "price_service", payload)

        mock_ws.append_row.assert_called_once()
        row_written = mock_ws.append_row.call_args[0][0]
        assert row_written[SYSTEM_LOG_HEADERS.index("status")] == "warning"
        assert row_written[SYSTEM_LOG_HEADERS.index("run_type")] == "price_service"
        details = json.loads(row_written[SYSTEM_LOG_HEADERS.index("details")])
        assert details["category"] == "price_service"
        assert details["payload"] == payload

    def test_has_logged_run_in_window_reuses_system_log_cache(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            SYSTEM_LOG_HEADERS,
            dict_to_row(
                {
                    "run_type": "signals",
                    "status": "completed",
                    "started_at": "2026-04-19T13:30:00+00:00",
                    "finished_at": "2026-04-19T13:32:00+00:00",
                },
                SYSTEM_LOG_HEADERS,
            ),
        ]

        window_start = datetime.fromisoformat("2026-04-19T13:30:00+00:00")
        window_end = datetime.fromisoformat("2026-04-19T13:45:00+00:00")

        assert client.has_logged_run_in_window(
            run_type="signals",
            window_start=window_start,
            window_end=window_end,
            statuses={"completed"},
        )
        assert client.has_logged_run_in_window(
            run_type="signals",
            window_start=window_start,
            window_end=window_end,
            statuses={"completed"},
        )

        assert mock_ws.get_all_values.call_count == 1

    def test_log_run_updates_system_log_cache_without_extra_read(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [SYSTEM_LOG_HEADERS]

        window_start = datetime.fromisoformat("2026-04-19T13:30:00+00:00")
        window_end = datetime.fromisoformat("2026-04-19T13:45:00+00:00")

        assert not client.has_logged_run_in_window(
            run_type="signals",
            window_start=window_start,
            window_end=window_end,
            statuses={"completed"},
        )

        client.log_run(
            {
                "run_type": "signals",
                "status": "completed",
                "started_at": "2026-04-19T13:30:00+00:00",
                "finished_at": "2026-04-19T13:32:00+00:00",
            }
        )

        assert client.has_logged_run_in_window(
            run_type="signals",
            window_start=window_start,
            window_end=window_end,
            statuses={"completed"},
        )
        assert mock_ws.get_all_values.call_count == 1

    def test_ensure_worksheets_creates_missing(self):
        with patch("src.storage.sheets_client.gspread") as mock_gspread, \
             patch("src.storage.sheets_client.Credentials") as mock_creds:
            mock_creds.from_service_account_info.return_value = MagicMock()
            mock_gc = MagicMock()
            mock_gspread.authorize.return_value = mock_gc
            mock_ss = MagicMock()
            mock_gc.open_by_key.return_value = mock_ss
            mock_ss.worksheets.return_value = []
            mock_ss.add_worksheet.return_value = MagicMock()

            from src.storage.sheets_client import SheetsClient
            SheetsClient("id", '{"type":"service_account"}')
            assert mock_ss.add_worksheet.call_count == len(ALL_TABS)

    def test_ensure_worksheets_creates_subscribers_tab(self):
        with patch("src.storage.sheets_client.gspread") as mock_gspread, \
             patch("src.storage.sheets_client.Credentials") as mock_creds:
            mock_creds.from_service_account_info.return_value = MagicMock()
            mock_gc = MagicMock()
            mock_gspread.authorize.return_value = mock_gc
            mock_ss = MagicMock()
            mock_gc.open_by_key.return_value = mock_ss
            mock_ss.worksheets.return_value = []
            mock_ss.add_worksheet.return_value = MagicMock()

            from src.storage.sheets_client import SheetsClient
            SheetsClient("id", '{"type":"service_account"}')
            titles = [c.kwargs.get("title") for c in mock_ss.add_worksheet.call_args_list]
            assert TAB_SUBSCRIBERS in titles


class TestServiceHealthHeartbeat:
    def test_append_service_heartbeat_writes_v21_fields(self):
        from src.observability.service_health import append_service_heartbeat

        sheets = MagicMock()

        entry = append_service_heartbeat(
            sheets,
            service="pipeline.signals",
            component="collector",
            status="degraded",
            run_status="completed_with_errors",
            heartbeat_key="signals:20260419T1015",
            source_name="scheduler,signals",
            supported_chains="ARB,BASE,BSC,ETH,POLYGON,SOL",
            unsupported_chain_count=3,
            unsupported_chain_names="BTC=1,TRX=2",
            per_chain_event_count="ETH=8,SOL=1",
        )

        sheets.append_service_health.assert_called_once_with(entry)
        assert entry["unsupported_chain_count"] == 3
        assert entry["unsupported_chain_names"] == "BTC=1,TRX=2"
        assert entry["per_chain_event_count"] == "ETH=8,SOL=1"
        assert entry["source_name"] == "scheduler,signals"


class TestStorageProtocolNewMethods:
    def _make_client(self):
        with patch("src.storage.sheets_client.gspread") as mock_gspread, \
             patch("src.storage.sheets_client.Credentials") as mock_creds:
            mock_creds.from_service_account_info.return_value = MagicMock()
            mock_gc = MagicMock()
            mock_gspread.authorize.return_value = mock_gc
            mock_spreadsheet = MagicMock()
            mock_gc.open_by_key.return_value = mock_spreadsheet
            mock_ws_list = [MagicMock(title=t) for t in ALL_TABS]
            mock_spreadsheet.worksheets.return_value = mock_ws_list

            from src.storage.sheets_client import SheetsClient
            client = SheetsClient("fake_sheet_id", '{"type":"service_account"}')
            return client, mock_spreadsheet

    def _make_addr_row(self, address, chain, enabled="true"):
        row = [""] * len(WATCHED_ADDRESSES_HEADERS)
        row[WATCHED_ADDRESSES_HEADERS.index("address")] = address
        row[WATCHED_ADDRESSES_HEADERS.index("chain")] = chain
        row[WATCHED_ADDRESSES_HEADERS.index("enabled")] = enabled
        return row

    def _make_interest_row(self, chat_id, dimension="chain", value="ETH"):
        row = [""] * len(USER_INTERESTS_HEADERS)
        row[USER_INTERESTS_HEADERS.index("chat_id")] = str(chat_id)
        row[USER_INTERESTS_HEADERS.index("dimension")] = dimension
        row[USER_INTERESTS_HEADERS.index("value")] = value
        return row

    def _make_activity_row(self, tx_hash, block_time):
        row = [""] * len(ADDRESS_ACTIVITY_HEADERS)
        row[ADDRESS_ACTIVITY_HEADERS.index("tx_hash")] = tx_hash
        row[ADDRESS_ACTIVITY_HEADERS.index("block_time")] = block_time
        return row

    def test_list_watched_addresses_returns_dict_keyed_by_address(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        row = self._make_addr_row("0xABCD1234", "eth")
        mock_ws.get_all_values.return_value = [WATCHED_ADDRESSES_HEADERS, row]

        result = client.list_watched_addresses()

        assert isinstance(result, dict)
        assert "0xabcd1234" in result
        assert result["0xabcd1234"]["address"] == "0xABCD1234"

    def test_list_watched_addresses_mixed_chain_handling(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        evm_row = self._make_addr_row("0xDEADBEEF", "ethereum")
        sol_row = self._make_addr_row("FooBarSolanaAddr1111", "sol")
        disabled_row = self._make_addr_row("0xDisabledAddr", "base", enabled="false")
        mock_ws.get_all_values.return_value = [
            WATCHED_ADDRESSES_HEADERS, evm_row, sol_row, disabled_row
        ]

        result = client.list_watched_addresses()

        assert "0xdeadbeef" in result
        assert "FooBarSolanaAddr1111" in result
        assert "0xdisabledaddr" in result
        assert len(result) == 3

    def test_list_user_interests_all(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            USER_INTERESTS_HEADERS,
            self._make_interest_row(1001),
            self._make_interest_row(2002),
        ]

        result = client.list_user_interests(user_id=None)

        assert len(result) == 2
        chat_ids = [r["chat_id"] for r in result]
        assert "1001" in chat_ids
        assert "2002" in chat_ids

    def test_list_user_interests_filtered(self):
        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            USER_INTERESTS_HEADERS,
            self._make_interest_row(1001, "chain", "ETH"),
            self._make_interest_row(1001, "category", "cex"),
            self._make_interest_row(9999, "chain", "SOL"),
        ]

        result = client.list_user_interests(user_id="1001")

        assert len(result) == 2
        assert all(r["chat_id"] == "1001" for r in result)

    def test_list_address_activity_filters_since(self):
        from datetime import datetime, timezone

        client, mock_ss = self._make_client()
        mock_ws = MagicMock()
        mock_ss.worksheet.return_value = mock_ws
        mock_ws.get_all_values.return_value = [
            ADDRESS_ACTIVITY_HEADERS,
            self._make_activity_row("old", "2026-04-01T00:00:00+00:00"),
            self._make_activity_row("new", "2026-04-14T00:00:00+00:00"),
        ]

        result = client.list_address_activity(
            since=datetime(2026, 4, 10, tzinfo=timezone.utc)
        )

        assert [row["tx_hash"] for row in result] == ["new"]
