"""Migrate Google Sheets: create new tabs introduced in TRACK 2.

Usage:
    python scripts/migrate_sheets.py [--dry-run]

--dry-run: print plan without making any changes.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import gspread
from google.oauth2.service_account import Credentials

from src.storage.schema import (
    TAB_ADDRESS_ACTIVITY,
    TAB_HEADERS,
    TAB_SIGNALS,
    TAB_TG_WHALE_EVENTS,
    TAB_USER_INTERESTS,
    TAB_WATCHED_ADDRESSES,
    TAB_WEEKLY_TREND,
)

NEW_TABS = [
    TAB_WATCHED_ADDRESSES,
    TAB_ADDRESS_ACTIVITY,
    TAB_TG_WHALE_EVENTS,
    TAB_SIGNALS,
    TAB_WEEKLY_TREND,
    TAB_USER_INTERESTS,
]

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]


def run(dry_run: bool) -> None:
    sheet_id = os.environ.get("SHEET_ID", "")
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")

    if dry_run:
        print(f"[dry-run] Would create tabs: {', '.join(NEW_TABS)}")
        for tab in NEW_TABS:
            headers = TAB_HEADERS[tab]
            print(f"  - {tab}: {len(headers)} columns -> {headers}")
        return

    if not sheet_id or not credentials_json:
        print(
            "Error: SHEET_ID and GOOGLE_CREDENTIALS_JSON environment variables must be set.",
            file=sys.stderr,
        )
        sys.exit(1)

    creds_dict = json.loads(credentials_json)
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    gc = gspread.authorize(creds)
    spreadsheet = gc.open_by_key(sheet_id)

    existing = {ws.title for ws in spreadsheet.worksheets()}
    created = []
    skipped = []

    for tab in NEW_TABS:
        if tab in existing:
            skipped.append(tab)
            print(f"[skip] {tab} already exists")
            continue
        headers = TAB_HEADERS[tab]
        ws = spreadsheet.add_worksheet(title=tab, rows=1000, cols=len(headers))
        ws.append_row(headers)
        created.append(tab)
        print(f"[created] {tab} ({len(headers)} columns)")

    print(f"\nDone. Created: {created or 'none'}. Skipped: {skipped or 'none'}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate Sheets: create new tabs.")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without changes.")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
