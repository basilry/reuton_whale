#!/usr/bin/env python3
"""Migrate recent WhaleScope Google Sheets rows into Postgres.

Default dry-run is connection-free so it remains safe while the Sheets workbook
is over the 10M cell limit. Pass ``--read-source`` to count source rows.
"""
from __future__ import annotations

import argparse
import os
from datetime import datetime, timedelta, timezone
from typing import Callable

from dotenv import load_dotenv

from src.storage import postgres_client as pg
from src.storage.postgres_client import PostgresClient
from src.storage.queries import row_to_dict
from src.storage.schema import TAB_HEADERS
from src.storage.sheets_client import SheetsClient

DEFAULT_TABLES = [
    "transactions",
    "address_activity",
    "tg_whale_events",
    "signals",
    "daily_brief",
    "system_log",
    "service_health",
    "news_feed",
    "broadcast_log",
    "brief_cost_ledger",
    "llm_budget_log",
    "channel_health",
]

TIME_KEYS = {
    "transactions": ("created_at", "timestamp"),
    "address_activity": ("collected_at", "block_time"),
    "tg_whale_events": ("collected_at", "tg_date"),
    "signals": ("created_at", "window_end"),
    "daily_brief": ("created_at", "date"),
    "system_log": ("finished_at", "started_at"),
    "service_health": ("ts",),
    "news_feed": ("last_seen_at", "fetched_at", "published_at"),
    "broadcast_log": ("ts",),
    "brief_cost_ledger": ("ts",),
    "llm_budget_log": ("ts",),
    "channel_health": ("ts",),
}


def _parse_dt(value: object) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _row_time(table: str, row: dict) -> datetime | None:
    for key in TIME_KEYS.get(table, ()):
        parsed = _parse_dt(row.get(key))
        if parsed is not None:
            return parsed
    return None


def _read_sheet_table(sheets: SheetsClient, table: str, *, since: datetime | None, limit: int) -> list[dict]:
    headers = list(TAB_HEADERS[table])
    ws = sheets._worksheet(table)  # migration script intentionally uses the low-level sheet API.
    values = ws.get_all_values()
    if len(values) <= 1:
        return []
    rows = [row_to_dict(row, headers) for row in values[1:]]
    if since is not None:
        rows = [row for row in rows if (_row_time(table, row) or datetime.min.replace(tzinfo=timezone.utc)) >= since]
    return rows[-limit:] if limit > 0 else rows


def _without_returning(sql: str) -> str:
    marker = sql.upper().rfind("RETURNING")
    if marker < 0:
        return sql
    return sql[:marker].rstrip()


def _transaction_params(row: dict) -> tuple[object, ...]:
    return (
        pg._none_if_blank(row.get("raw_response_hash")),
        pg._text(row.get("hash")),
        pg._timestamp(row.get("timestamp")),
        pg._text(row.get("blockchain")),
        pg._text(row.get("symbol")),
        pg._numeric(row.get("amount")),
        pg._numeric(row.get("amount_usd")),
        pg._text(row.get("from_address")),
        pg._text(row.get("from_owner_type")),
        pg._text(row.get("from_owner")),
        pg._text(row.get("to_address")),
        pg._text(row.get("to_owner_type")),
        pg._text(row.get("to_owner")),
        pg._timestamp(row.get("created_at")),
        pg._timestamp(row.get("last_seen_at")),
        pg._int(row.get("seen_count")),
    )


def _address_activity_params(row: dict) -> tuple[object, ...]:
    return (
        pg._text(row.get("tx_hash")),
        pg._text(row.get("chain")),
        pg._timestamp(row.get("block_time")),
        pg._text(row.get("watched_address")),
        pg._text(row.get("direction")),
        pg._text(row.get("counterparty")),
        pg._text(row.get("counterparty_category")),
        pg._text(row.get("token")),
        pg._numeric(row.get("amount_token")),
        pg._numeric(row.get("amount_usd")),
        pg._timestamp(row.get("collected_at")),
    )


def _service_health_params(row: dict) -> tuple[object, ...]:
    return (
        pg._timestamp(row.get("ts")),
        pg._text(row.get("service")),
        pg._text(row.get("component")),
        pg._text(row.get("status")),
        pg._text(row.get("heartbeat_key")),
        pg._json_param(row.get("details")),
        pg._text(row.get("error"), max_length=1000),
        pg._text(row.get("instance_id")),
        pg._text(row.get("job_name")),
        pg._timestamp(row.get("last_success_at")),
        pg._timestamp(row.get("last_failure_at")),
        pg._int(row.get("processed_count")),
        pg._int(row.get("lag_seconds")),
        pg._int(row.get("duration_ms")),
        pg._text(row.get("source_name")),
        pg._text(row.get("supported_chains"), max_length=1000),
        pg._int(row.get("unsupported_chain_count")),
        pg._text(row.get("unsupported_chain_names"), max_length=2000),
        pg._text(row.get("per_chain_event_count"), max_length=2000),
    )


def _tg_whale_event_params(row: dict) -> tuple[object, ...]:
    return (
        pg._none_if_blank(row.get("tg_msg_id")),
        pg._timestamp(row.get("tg_date")),
        pg._text(row.get("blockchain")),
        pg._text(row.get("symbol")),
        pg._numeric(row.get("amount")),
        pg._numeric(row.get("amount_usd")),
        pg._text(row.get("from_owner_type")),
        pg._text(row.get("from_owner")),
        pg._text(row.get("to_owner_type")),
        pg._text(row.get("to_owner")),
        pg._text(row.get("raw_text")),
        pg._numeric(row.get("parsed_confidence")),
        pg._text(row.get("external_channel")),
        pg._text(row.get("external_display_name")),
        pg._numeric(row.get("external_confidence")),
        pg._timestamp(row.get("collected_at")),
    )


def _signal_params(row: dict) -> tuple[object, ...]:
    normalized = dict(row)
    if "extra_json" not in normalized and "extra" in normalized:
        normalized["extra_json"] = normalized.pop("extra")
    return (
        pg._none_if_blank(normalized.get("signal_id")),
        pg._timestamp(normalized.get("created_at")),
        pg._text(normalized.get("rule")),
        pg._text(normalized.get("severity")),
        pg._numeric(normalized.get("score")),
        pg._text(normalized.get("confidence")),
        pg._text(normalized.get("source")),
        pg._json_param(normalized.get("evidence_tx_hashes")),
        pg._timestamp(normalized.get("window_start")),
        pg._timestamp(normalized.get("window_end")),
        pg._text(normalized.get("summary")),
        pg._json_param(normalized.get("extra_json")),
    )


def _daily_brief_params(row: dict) -> tuple[object, ...]:
    normalized = dict(row)
    if "signal_themes" not in normalized and "signalThemes" in normalized:
        normalized["signal_themes"] = normalized.pop("signalThemes")
    if "input_fingerprint" not in normalized and "inputFingerprint" in normalized:
        normalized["input_fingerprint"] = normalized.pop("inputFingerprint")
    return (
        pg._text(normalized.get("date")),
        pg._text(normalized.get("summary")),
        pg._json_param(normalized.get("top_transactions")),
        pg._numeric(normalized.get("total_volume_usd")),
        pg._int(normalized.get("alert_count")),
        pg._timestamp(normalized.get("created_at")),
        pg._text(normalized.get("highlights")),
        pg._json_param(normalized.get("signal_themes")),
        pg._text(normalized.get("note")),
        pg._text(normalized.get("input_fingerprint")),
    )


def _broadcast_log_params(row: dict) -> tuple[object, ...]:
    return (
        pg._timestamp(row.get("ts")),
        pg._text(row.get("kind")),
        pg._text(row.get("dedup_key")),
        pg._text(row.get("chat_id")),
        pg._text(row.get("message_id")),
        pg._text(row.get("status")),
        pg._text(row.get("error"), max_length=1000),
        pg._int(row.get("message_length")),
        pg._text(row.get("content_hash")),
        pg._int(row.get("signal_count")),
        pg._int(row.get("transaction_count")),
        pg._text(row.get("slot_key")),
        pg._text(row.get("delivery_mode")),
        pg._text(row.get("decision")),
        pg._text(row.get("reason"), max_length=1000),
        pg._text(row.get("fallback_source")),
        pg._int(row.get("candidate_signal_count")),
        pg._int(row.get("candidate_transaction_count")),
        pg._timestamp(row.get("last_channel_delivery_at")),
        pg._timestamp(row.get("next_expected_at")),
    )


def _brief_cost_ledger_params(row: dict) -> tuple[object, ...]:
    return (
        pg._timestamp(row.get("ts")),
        pg._text(row.get("slot_key")),
        pg._text(row.get("decision")),
        pg._bool(row.get("llm_called")),
        pg._text(row.get("model_id")),
        pg._int(row.get("tokens_in")),
        pg._int(row.get("tokens_out")),
        pg._numeric(row.get("cost_usd")),
        pg._numeric(row.get("cumulative_cost_usd")),
        pg._int(row.get("signal_count")),
        pg._int(row.get("transaction_count")),
        pg._text(row.get("input_fingerprint")),
        pg._text(row.get("reason"), max_length=2000),
    )


def _llm_budget_log_params(row: dict) -> tuple[object, ...]:
    return (
        pg._timestamp(row.get("ts")),
        pg._text(row.get("month_key")),
        pg._text(row.get("pipeline")),
        pg._text(row.get("model_id")),
        pg._int(row.get("tokens_in")),
        pg._int(row.get("tokens_out")),
        pg._numeric(row.get("cost_usd")),
        pg._numeric(row.get("cumulative_cost_usd")),
        pg._text(row.get("decision")),
    )


def _channel_health_params(row: dict) -> tuple[object, ...]:
    return (
        pg._timestamp(row.get("ts")),
        pg._text(row.get("chat_id")),
        pg._text(row.get("title")),
        pg._text(row.get("username")),
        pg._int(row.get("member_count")),
        pg._text(row.get("status")),
        pg._text(row.get("error"), max_length=1000),
    )


def _news_feed_params(row: dict) -> tuple[object, ...] | None:
    digest = str(row.get("hash", "")).strip()
    if not digest:
        return None
    return (
        str(row.get("id") or digest[:16]),
        pg._text(row.get("source")),
        pg._text(row.get("title")),
        pg._text(row.get("summary")),
        pg._text(row.get("url")),
        pg._timestamp(row.get("published_at")),
        pg._text(row.get("language")),
        pg._text(row.get("tags")),
        pg._timestamp(row.get("fetched_at")),
        digest,
        pg._timestamp(row.get("last_seen_at")),
    )


def _write_postgres_rows(postgres: PostgresClient, table: str, rows: list[dict]) -> int:
    bulk_writers: dict[str, tuple[str, Callable[[dict], tuple[object, ...] | None]]] = {
        "transactions": (_without_returning(pg.INSERT_TRANSACTION_SQL), _transaction_params),
        "address_activity": (_without_returning(pg.INSERT_ADDRESS_ACTIVITY_SQL), _address_activity_params),
        "tg_whale_events": (pg.INSERT_TG_WHALE_EVENT_SQL, _tg_whale_event_params),
        "signals": (pg.INSERT_SIGNAL_SQL, _signal_params),
        "daily_brief": (pg.INSERT_DAILY_BRIEF_SQL, _daily_brief_params),
        "system_log": (pg.INSERT_SYSTEM_LOG_SQL, postgres._system_log_params),
        "service_health": (pg.INSERT_SERVICE_HEALTH_SQL, _service_health_params),
        "broadcast_log": (pg.INSERT_BROADCAST_LOG_SQL, _broadcast_log_params),
        "brief_cost_ledger": (pg.INSERT_BRIEF_COST_LEDGER_SQL, _brief_cost_ledger_params),
        "llm_budget_log": (pg.INSERT_LLM_BUDGET_LOG_SQL, _llm_budget_log_params),
        "channel_health": (pg.INSERT_CHANNEL_HEALTH_SQL, _channel_health_params),
        "news_feed": (_without_returning(pg.INSERT_NEWS_FEED_SQL), _news_feed_params),
    }

    if table not in bulk_writers:
        raise SystemExit(f"Unsupported table: {table}")

    sql, param_builder = bulk_writers[table]
    params = [item for item in (param_builder(row) for row in rows) if item is not None]
    if not params:
        return 0

    with postgres._connect() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params)
    return len(params)


def _truncate_postgres_tables(postgres: PostgresClient, tables: list[str]) -> None:
    invalid_tables = [table for table in tables if table not in DEFAULT_TABLES]
    if invalid_tables:
        raise SystemExit(f"Unsupported truncate table: {','.join(invalid_tables)}")

    if not tables:
        return

    quoted_tables = ", ".join(f'"{table}"' for table in tables)
    with postgres._connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"TRUNCATE TABLE {quoted_tables} RESTART IDENTITY")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate Sheets rows to Postgres.")
    parser.add_argument("--tables", default=",".join(DEFAULT_TABLES), help="Comma-separated table list.")
    parser.add_argument("--since-days", type=int, default=90, help="Only migrate rows newer than this many days.")
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("STORAGE_MIGRATION_BATCH_SIZE", "1000")))
    parser.add_argument("--dry-run", action="store_true", help="Print plan; no writes.")
    parser.add_argument("--read-source", action="store_true", help="During dry-run, read Sheets to count rows.")
    parser.add_argument(
        "--truncate-before",
        action="store_true",
        help="Truncate selected Postgres tables before writing. Use only for controlled re-runs.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    tables = [item.strip() for item in args.tables.split(",") if item.strip()]
    since = datetime.now(timezone.utc) - timedelta(days=args.since_days)

    print("WhaleScope Sheets -> Postgres migration", flush=True)
    print(
        f"tables={','.join(tables)} since_days={args.since_days} "
        f"batch_size={args.batch_size} truncate_before={args.truncate_before}",
        flush=True,
    )

    if args.dry_run and not args.read_source:
        print("dry_run=true read_source=false: no external connections opened", flush=True)
        return 0

    sheets = SheetsClient(
        os.environ["GOOGLE_SHEET_ID"],
        os.environ["GOOGLE_CREDENTIALS_JSON"],
        write_mode=os.getenv("SHEETS_WRITE_MODE", "summary_only"),
    )
    postgres = None if args.dry_run else PostgresClient(os.environ.get("DATABASE_URL"))

    if args.truncate_before:
        if args.dry_run:
            print(f"truncate_before=true dry_run=true: would truncate {','.join(tables)}", flush=True)
        else:
            assert postgres is not None
            print(f"truncate_before=true: truncating {','.join(tables)}", flush=True)
            _truncate_postgres_tables(postgres, tables)
            print("truncate completed", flush=True)

    for table in tables:
        if table not in TAB_HEADERS:
            raise SystemExit(f"Unsupported table: {table}")
        print(f"{table}: reading source rows", flush=True)
        rows = _read_sheet_table(sheets, table, since=since, limit=args.batch_size)
        if args.dry_run:
            print(f"{table}: source_rows={len(rows)} would_write=0", flush=True)
            continue
        assert postgres is not None
        print(f"{table}: writing {len(rows)} rows", flush=True)
        written = _write_postgres_rows(postgres, table, rows)
        print(f"{table}: source_rows={len(rows)} written={written}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
