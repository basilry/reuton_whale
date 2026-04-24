#!/usr/bin/env python3
"""Validate coarse row counts after a Sheets -> Postgres migration."""
from __future__ import annotations

import argparse
import os

from dotenv import load_dotenv

from scripts.migrate_sheets_to_postgres import DEFAULT_TABLES, _read_sheet_table
from src.storage.postgres_client import PostgresClient
from src.storage.sheets_client import SheetsClient


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare Sheets and Postgres row counts.")
    parser.add_argument("--tables", default=",".join(DEFAULT_TABLES), help="Comma-separated table list.")
    parser.add_argument("--limit", type=int, default=5000, help="Max Sheets rows to count per table.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned checks without connections.")
    return parser.parse_args(argv)


def _postgres_count(postgres: PostgresClient, table: str) -> int:
    if table not in set(DEFAULT_TABLES):
        raise ValueError(f"Unsupported table: {table}")
    with postgres._connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f'SELECT count(*)::int AS count FROM "{table}"')
            row = cur.fetchone()
    if isinstance(row, dict):
        return int(row.get("count", 0))
    return int(row[0])


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    tables = [item.strip() for item in args.tables.split(",") if item.strip()]
    print("WhaleScope Postgres count validation")
    print(f"tables={','.join(tables)}")

    if args.dry_run:
        print("dry_run=true: no external connections opened")
        return 0

    sheets = SheetsClient(
        os.environ["GOOGLE_SHEET_ID"],
        os.environ["GOOGLE_CREDENTIALS_JSON"],
        write_mode=os.getenv("SHEETS_WRITE_MODE", "summary_only"),
    )
    postgres = PostgresClient(os.environ.get("DATABASE_URL"))

    for table in tables:
        source_count = len(_read_sheet_table(sheets, table, since=None, limit=args.limit))
        postgres_count = _postgres_count(postgres, table)
        status = "ok" if postgres_count >= source_count else "attention"
        print(
            f"{table}: sheets_sample_count={source_count} "
            f"postgres_count={postgres_count} status={status}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
