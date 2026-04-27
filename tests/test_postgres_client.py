from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from scripts import init_postgres
from src.storage.postgres_client import PostgresClient, initialize_schema
from src.storage.postgres_schema import (
    CREATE_INDEX_STATEMENTS,
    CREATE_TABLE_STATEMENTS,
    MIGRATION_STATEMENTS,
    TABLE_NAMES,
    iter_schema_statements,
)
from src.utils.errors import StorageError


class RecordingCursor:
    def __init__(
        self,
        fetchone_result: dict | None | list[dict | None] = {"id": 1},
    ) -> None:
        self.calls: list[tuple[str, tuple | None]] = []
        self.fetchone_result = fetchone_result

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, sql: str, params: tuple | None = None) -> None:
        self.calls.append((sql, params))

    def fetchone(self):
        if isinstance(self.fetchone_result, list):
            if not self.fetchone_result:
                return None
            return self.fetchone_result.pop(0)
        return self.fetchone_result

    def fetchall(self):
        return []


class RecordingConnection:
    def __init__(self, cursor: RecordingCursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> RecordingCursor:
        return self._cursor


def _connect_with_cursor(cursor: RecordingCursor):
    connection = RecordingConnection(cursor)

    def connect_func(*args, **kwargs):
        return connection

    return connect_func


def test_schema_contains_required_tables_and_idempotent_ddl() -> None:
    assert set(TABLE_NAMES) == {
        "transactions",
        "address_activity",
        "system_log",
        "service_health",
        "signals",
        "daily_brief",
        "tg_whale_events",
        "broadcast_log",
        "brief_cost_ledger",
        "llm_budget_log",
        "channel_health",
        "news_feed",
        "curated_wallets",
        "curated_wallet_balances",
        "whale_stories",
        "analysis_log",
        "watched_addresses",
        "user_interests",
        "subscribers",
        "wallet_aliases",
        "watchlist_overrides",
    }
    assert all("CREATE TABLE IF NOT EXISTS" in sql for sql in CREATE_TABLE_STATEMENTS)
    transaction_sql = next(sql for sql in CREATE_TABLE_STATEMENTS if "transactions" in sql)
    assert "last_seen_at timestamptz" in transaction_sql
    assert "seen_count integer" in transaction_sql
    broadcast_sql = next(sql for sql in CREATE_TABLE_STATEMENTS if "broadcast_log" in sql)
    assert "decision text" in broadcast_sql
    assert "fallback_source text" in broadcast_sql
    assert "candidate_signal_count integer" in broadcast_sql
    assert any("ADD COLUMN IF NOT EXISTS last_seen_at" in sql for sql in MIGRATION_STATEMENTS)
    assert any("ADD COLUMN IF NOT EXISTS seen_count" in sql for sql in MIGRATION_STATEMENTS)
    assert any("ADD COLUMN IF NOT EXISTS decision" in sql for sql in MIGRATION_STATEMENTS)
    assert any("ADD COLUMN IF NOT EXISTS fallback_source" in sql for sql in MIGRATION_STATEMENTS)
    assert all("CREATE INDEX IF NOT EXISTS" in sql for sql in CREATE_INDEX_STATEMENTS)
    assert any("idx_transactions_last_seen_at" in sql for sql in CREATE_INDEX_STATEMENTS)
    assert len(iter_schema_statements()) == (
        len(CREATE_TABLE_STATEMENTS)
        + len(MIGRATION_STATEMENTS)
        + len(CREATE_INDEX_STATEMENTS)
    )


def test_initialize_schema_executes_idempotent_statements() -> None:
    cursor = RecordingCursor(fetchone_result=None)

    count = initialize_schema(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    assert count == len(iter_schema_statements())
    assert len(cursor.calls) == len(iter_schema_statements())
    assert all(params is None for _, params in cursor.calls)


def test_missing_database_url_raises_storage_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(StorageError, match="DATABASE_URL"):
        PostgresClient()


def test_connection_failure_is_wrapped() -> None:
    def fail_connect(*args, **kwargs):
        raise RuntimeError("network unavailable")

    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=fail_connect,
    )

    with pytest.raises(StorageError, match="Failed to connect to Postgres"):
        client.list_transactions()


def test_append_signal_uses_parameter_binding_for_user_data() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )
    attack = "sig-1'); DROP TABLE signals; --"

    client.append_signal(
        {
            "signal_id": attack,
            "rule": "large_transfer",
            "severity": "high",
            "extra_json": {"asset": "BTC"},
        }
    )

    sql, params = cursor.calls[-1]
    assert "%s" in sql
    assert attack not in sql
    assert attack in params


def test_append_transactions_converts_epoch_timestamp_strings() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    client.append_transactions(
        [
            {
                "raw_response_hash": "hash-1",
                "hash": "tx-1",
                "timestamp": "1776915011",
                "created_at": "1776915011000",
            }
        ]
    )

    _, params = cursor.calls[-1]
    assert params is not None
    assert params[2] == datetime.fromtimestamp(1776915011, tz=timezone.utc)
    assert params[13] == datetime.fromtimestamp(1776915011, tz=timezone.utc)


def test_append_transactions_refreshes_duplicate_observation_without_counting_insert() -> None:
    cursor = RecordingCursor(fetchone_result={"id": 1, "inserted": False})
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    count = client.append_transactions(
        [
            {
                "raw_response_hash": "hash-1",
                "hash": "tx-1",
                "last_seen_at": "2026-04-24T01:02:03+00:00",
                "seen_count": "4",
            }
        ]
    )

    sql, params = cursor.calls[-1]
    assert count == 0
    assert "ON CONFLICT (raw_response_hash) DO UPDATE SET" in sql
    assert "last_seen_at" in sql
    assert "seen_count" in sql
    assert params is not None
    assert params[14] == datetime(2026, 4, 24, 1, 2, 3, tzinfo=timezone.utc)
    assert params[15] == 4


def test_list_recent_observed_transactions_filters_by_last_seen_at() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )
    since = datetime(2026, 4, 24, tzinfo=timezone.utc)

    assert client.list_recent_observed_transactions(since=since, limit=5) == []

    sql, params = cursor.calls[-1]
    assert "COALESCE(last_seen_at, created_at, timestamp) >= %s" in sql
    assert "ORDER BY COALESCE(last_seen_at, created_at, timestamp) DESC" in sql
    assert params == (since, 5)


def test_list_watched_addresses_orders_by_address_not_id() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    assert client.list_watched_addresses() == {}

    sql, params = cursor.calls[-1]
    assert "FROM watched_addresses" in sql
    assert "ORDER BY COALESCE(added_at, now()) ASC, address ASC" in sql
    assert " id " not in f" {sql} "
    assert params == ()


def test_append_missing_watched_addresses_uses_postgres_upsert_contract() -> None:
    cursor = RecordingCursor(fetchone_result=[{"address": "0xabc"}, None])
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    result = client.append_missing_watched_addresses(
        [
            {
                "address": "0xabc",
                "chain": "ETH",
                "category": "cex",
                "label": "Binance",
                "source": "arkham",
                "confidence": "high",
                "enabled": "true",
                "added_at": "2026-04-20",
                "notes": "seed",
            },
            {
                "address": "0xdef",
                "chain": "ETH",
                "confidence": "medium",
                "enabled": "true",
            },
            {"address": ""},
        ]
    )

    assert result == {"inserted": 1, "skipped": 1, "invalid": 1}
    insert_sql, params = cursor.calls[0]
    assert "INSERT INTO watched_addresses" in insert_sql
    assert "ON CONFLICT (address) DO NOTHING" in insert_sql
    assert params is not None
    assert params[0] == "0xabc"
    assert params[5] == "0.9"


def test_upsert_watched_address_updates_existing_natural_key() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    client.upsert_watched_address(
        {
            "address": "0xabc",
            "chain": "ETH",
            "label": "Updated",
            "confidence": "low",
        }
    )

    sql, params = cursor.calls[-1]
    assert "ON CONFLICT (address) DO UPDATE SET" in sql
    assert params is not None
    assert params[0] == "0xabc"
    assert params[5] == "0.3"


def test_list_subscribers_orders_by_chat_id_not_id() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    assert client.list_subscribers(statuses=["active"]) == []

    sql, params = cursor.calls[-1]
    assert "FROM subscribers" in sql
    assert "WHERE status = ANY(%s)" in sql
    assert "ORDER BY COALESCE(updated_at, created_at) ASC, chat_id ASC" in sql
    assert " id " not in f" {sql} "
    assert params == (["active"],)


def test_select_rows_defaults_to_id_tie_breaker_for_id_tables() -> None:
    cursor = RecordingCursor(fetchone_result=None)
    client = PostgresClient(
        "postgresql://user:pass@example.com/db",
        connect_func=_connect_with_cursor(cursor),
    )

    assert client.list_transactions(limit=5) == []

    sql, params = cursor.calls[-1]
    assert "FROM transactions" in sql
    assert "ORDER BY COALESCE(created_at, timestamp) DESC, id DESC LIMIT %s" in sql
    assert params == (5,)


def test_init_postgres_dry_run_skips_connection(monkeypatch, capsys) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(
        init_postgres,
        "initialize_schema",
        lambda *args, **kwargs: pytest.fail("dry-run must not connect"),
    )

    assert init_postgres.main(["--dry-run"]) == 0

    output = capsys.readouterr().out
    assert "dry run" in output
    assert "Database connection: skipped" in output
    assert "migration statements" in output
    assert "transactions" in output


@pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is not set; skipping real Postgres integration test",
)
def test_postgres_integration_schema_and_basic_crud() -> None:
    client = PostgresClient()
    client.init_schema()

    signal_id = "test-postgres-client-signal"
    client.append_signal(
        {
            "signal_id": signal_id,
            "rule": "integration",
            "severity": "low",
            "extra_json": {"asset": "BTC"},
        }
    )

    rows = client.list_signals(limit=10)
    assert any(row.get("signal_id") == signal_id for row in rows)
