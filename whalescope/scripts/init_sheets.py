"""Initialize Google Sheets with required tabs and headers.

Usage: python -m scripts.init_sheets
"""

import json
import os

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

from src.storage.schema import ALL_TABS, TAB_HEADERS
from src.utils.logger import get_logger

logger = get_logger("init_sheets")

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]


def main() -> None:
    load_dotenv()

    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not sheet_id or not creds_json:
        raise ValueError("GOOGLE_SHEET_ID and GOOGLE_CREDENTIALS_JSON must be set")

    creds = Credentials.from_service_account_info(json.loads(creds_json), scopes=SCOPES)
    gc = gspread.authorize(creds)
    spreadsheet = gc.open_by_key(sheet_id)

    existing = {ws.title for ws in spreadsheet.worksheets()}
    created = 0

    for tab_name in ALL_TABS:
        if tab_name in existing:
            logger.info("Tab already exists: %s", tab_name)
            continue
        headers = TAB_HEADERS[tab_name]
        ws = spreadsheet.add_worksheet(title=tab_name, rows=1000, cols=len(headers))
        ws.append_row(headers)
        logger.info("Created tab: %s (%d columns)", tab_name, len(headers))
        created += 1

    logger.info("Done. Created %d / %d tabs.", created, len(ALL_TABS))


if __name__ == "__main__":
    main()
