#!/usr/bin/env python3
"""Import watched_addresses.csv into Google Sheets watched_addresses tab.

Usage:
    python scripts/import_watched_addresses.py
    python scripts/import_watched_addresses.py --csv config/watched_addresses.csv
    python scripts/import_watched_addresses.py --dry-run
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import load_config
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

logger = get_logger("import_watched")

_DEFAULT_CSV = Path(__file__).resolve().parent.parent / "config" / "watched_addresses.csv"


def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    parser = argparse.ArgumentParser(description="Import watched addresses from CSV into Sheets")
    parser.add_argument("--csv", default=str(_DEFAULT_CSV), help="Path to CSV file")
    parser.add_argument("--dry-run", action="store_true", help="Print rows without writing")
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    rows = load_csv(csv_path)
    print(f"Loaded {len(rows)} addresses from {csv_path}")

    if args.dry_run:
        for r in rows:
            print(f"  {r['chain']:10s} {r['category']:15s} {r['label']:30s} {r['address']}")
        print(f"dry-run: {len(rows)} rows would be imported")
        return

    config = load_config()
    sheets = SheetsClient(config.sheet_id, config.google_credentials)

    imported = 0
    errors = 0
    for row in rows:
        try:
            sheets.upsert_watched_address(row)
            imported += 1
        except Exception as e:
            logger.error("Failed to upsert %s: %s", row.get("address"), e)
            errors += 1

    print(f"Imported {imported} addresses, {errors} errors")


if __name__ == "__main__":
    main()
