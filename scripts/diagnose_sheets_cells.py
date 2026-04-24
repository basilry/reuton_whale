"""Read-only Google Sheets cell inventory.

Usage:
    python -m scripts.diagnose_sheets_cells
    python -m scripts.diagnose_sheets_cells --json
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Sequence

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SHEETS_CELL_LIMIT = 10_000_000


@dataclass(frozen=True)
class WorksheetInventory:
    tab: str
    row_count: int
    col_count: int
    grid_cells: int
    data_rows: int
    empty_rows: int


@dataclass(frozen=True)
class WorkbookInventory:
    generated_at: str
    total: int
    limit: int
    headroom: int
    worksheets: list[WorksheetInventory]


def _has_value(row: Sequence[Any]) -> bool:
    return any(str(cell).strip() for cell in row)


def build_worksheet_inventory(
    *,
    tab: str,
    row_count: int,
    col_count: int,
    values: Sequence[Sequence[Any]],
) -> WorksheetInventory:
    """Build one tab inventory entry from read-only worksheet metadata."""
    non_empty_rows = sum(1 for row in values if _has_value(row))
    data_rows = max(0, non_empty_rows - 1)
    return WorksheetInventory(
        tab=tab,
        row_count=row_count,
        col_count=col_count,
        grid_cells=row_count * col_count,
        data_rows=data_rows,
        empty_rows=max(0, row_count - non_empty_rows),
    )


def build_workbook_inventory(
    worksheets: Sequence[WorksheetInventory],
    *,
    generated_at: str | None = None,
    limit: int = SHEETS_CELL_LIMIT,
) -> WorkbookInventory:
    sorted_worksheets = sorted(worksheets, key=lambda item: item.grid_cells, reverse=True)
    total = sum(item.grid_cells for item in sorted_worksheets)
    return WorkbookInventory(
        generated_at=generated_at or datetime.now(timezone.utc).isoformat(),
        total=total,
        limit=limit,
        headroom=limit - total,
        worksheets=list(sorted_worksheets),
    )


def inventory_to_dict(inventory: WorkbookInventory) -> dict[str, Any]:
    tabs = [asdict(item) for item in inventory.worksheets]
    return {
        "generated_at": inventory.generated_at,
        "total_grid_cells": inventory.total,
        "limit": inventory.limit,
        "headroom": inventory.headroom,
        "tabs": tabs,
        # Backward-compatible aliases for tests or ad-hoc local parsers.
        "total": inventory.total,
        "worksheets": tabs,
    }


def format_text_report(inventory: WorkbookInventory) -> str:
    usage = inventory.total / inventory.limit if inventory.limit else 0
    lines = [
        f"Generated at: {inventory.generated_at}",
        f"Total grid cells: {inventory.total:,} / {inventory.limit:,} ({usage:.1%})",
        f"Headroom: {inventory.headroom:,}",
        "",
        f"{'TAB':<30} {'ROWS':>10} {'COLS':>5} {'GRID':>12} {'DATA':>10} {'EMPTY':>10}",
    ]
    for item in inventory.worksheets:
        lines.append(
            f"{item.tab:<30} {item.row_count:>10,} {item.col_count:>5,} "
            f"{item.grid_cells:>12,} {item.data_rows:>10,} {item.empty_rows:>10,}"
        )
    return "\n".join(lines)


def collect_inventory(spreadsheet: Any) -> WorkbookInventory:
    worksheets: list[WorksheetInventory] = []
    for worksheet in spreadsheet.worksheets():
        worksheets.append(
            build_worksheet_inventory(
                tab=worksheet.title,
                row_count=worksheet.row_count,
                col_count=worksheet.col_count,
                values=worksheet.get_all_values(),
            )
        )
    return build_workbook_inventory(worksheets)


def open_spreadsheet_from_env() -> Any:
    load_dotenv()
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "").strip()
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "").strip()
    if not sheet_id:
        raise RuntimeError("Missing required environment variable: GOOGLE_SHEET_ID")
    if not credentials_json:
        raise RuntimeError("Missing required environment variable: GOOGLE_CREDENTIALS_JSON")

    try:
        credentials_info = json.loads(credentials_json)
    except json.JSONDecodeError as exc:
        raise RuntimeError("GOOGLE_CREDENTIALS_JSON must be a JSON string") from exc

    credentials = Credentials.from_service_account_info(credentials_info, scopes=SCOPES)
    client = gspread.authorize(credentials)
    return client.open_by_key(sheet_id)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only Google Sheets workbook cell inventory."
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    inventory = collect_inventory(open_spreadsheet_from_env())
    if args.json:
        print(json.dumps(inventory_to_dict(inventory), ensure_ascii=False, indent=2))
    else:
        print(format_text_report(inventory))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
