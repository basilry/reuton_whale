"""Initialize the WhaleScope Postgres schema.

Usage:
    python -m scripts.init_postgres
    python -m scripts.init_postgres --dry-run
"""
from __future__ import annotations

import argparse
import os
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv

from src.storage.postgres_client import initialize_schema
from src.storage.postgres_schema import schema_summary
from src.utils.errors import StorageError


def _display_database_url(database_url: str) -> str:
    if not database_url:
        return "<DATABASE_URL unset>"
    parsed = urlsplit(database_url)
    if not parsed.scheme or not parsed.netloc:
        return "<DATABASE_URL set>"
    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    username = parsed.username or ""
    userinfo = f"{username}:***@" if username else ""
    netloc = f"{userinfo}{hostname}{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Initialize WhaleScope Postgres schema.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection URL. Defaults to DATABASE_URL.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print target and SQL summary without opening a database connection.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    database_url = (args.database_url or os.getenv("DATABASE_URL", "")).strip()
    summary = schema_summary()

    if args.dry_run:
        print("WhaleScope Postgres schema init dry run")
        print(f"Target: {_display_database_url(database_url)}")
        print("Database connection: skipped")
        print(
            "SQL summary: "
            f"{summary['table_count']} CREATE TABLE statements, "
            f"{summary['migration_count']} migration statements, "
            f"{summary['index_count']} CREATE INDEX statements"
        )
        print("Tables: " + ", ".join(summary["tables"]))
        return 0

    if not database_url:
        raise SystemExit("DATABASE_URL must be set")

    try:
        statement_count = initialize_schema(database_url)
    except StorageError as exc:
        raise SystemExit(str(exc)) from exc

    print(
        "Initialized WhaleScope Postgres schema: "
        f"{statement_count} statements applied to {_display_database_url(database_url)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
