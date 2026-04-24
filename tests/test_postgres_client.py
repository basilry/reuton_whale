from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from scripts import init_postgres
from src.storage.postgres_client import PostgresClient, initialize_schema
from src.storage.postgres_schema import (
    CREATE_INDEX_STATEMENTS,
    CREATE_TABLE_STATEMENTS,
    TABLE_NAMES,
    iter_schema_statements,
)
from src.utils.errors import StorageError


class RecordingCursor:
    def __init__(self, fetchone_result: dict | None = {"id": 1}) -> None:
        self.calls: list[tuple[str, tuple | None]] = []
        self.fetchone_result = fetchone_result

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, sql: str, params: tuple | None = None) -> None:
        self.calls.append((sql, params))

    def fetchone(self):
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
    assert all("CREATE INDEX IF NOT EXISTS" in sql for sql in CREATE_INDEX_STATEMENTS)
    assert len(iter_schema_statements()) == (
        len(CREATE_TABLE_STATEMENTS) + len(CREATE_INDEX_STATEMENTS)
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
