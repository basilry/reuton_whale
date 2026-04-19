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

from src.utils.logger import get_logger

logger = get_logger("import_watched")

_DEFAULT_CSV = Path(__file__).resolve().parent.parent / "config" / "watched_addresses.csv"


def load_csv(path: Path) -> list[dict[str, str]]:
    filtered_lines: list[str] = []
    with open(path, newline="", encoding="utf-8") as f:
        for line in f:
            stripped = line.lstrip()
            if not stripped.strip() or stripped.startswith("#"):
                continue
            filtered_lines.append(line)

    if not filtered_lines:
        return []

    return list(csv.DictReader(filtered_lines))


def main():
    from src.config import load_config
    from src.storage.sheets_client import SheetsClient

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

    try:
        result = sheets.append_missing_watched_addresses(rows)
    except Exception as e:
        logger.error("Failed to import watched addresses: %s", e)
        sys.exit(1)

    print(
        "Imported {inserted} new addresses, skipped {skipped} existing, "
        "{invalid} invalid".format(**result)
    )


if __name__ == "__main__":
    main()
