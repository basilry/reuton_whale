"""Back up the full Google Sheets workbook as CSV files.

Usage:
    python -m scripts.backup_sheets_snapshot

The output directory is backups/sheets/<UTC stamp>/ and includes one CSV per
worksheet plus manifest.json. The manifest is later used by
scripts.purge_sheets_once to verify that destructive row deletes are based on a
fresh backup.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
REPO_ROOT = Path(__file__).resolve().parents[1]
BACKUP_ROOT = REPO_ROOT / "backups" / "sheets"


def _utc_stamp(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _safe_csv_name(title: str, used: set[str]) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", title.strip()).strip("._")
    if not safe:
        safe = "worksheet"
    name = f"{safe}.csv"
    if name not in used:
        used.add(name)
        return name

    suffix = 2
    while True:
        candidate = f"{safe}_{suffix}.csv"
        if candidate not in used:
            used.add(candidate)
            return candidate
        suffix += 1


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_csv(path: Path, rows: Iterable[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, quoting=csv.QUOTE_MINIMAL)
        writer.writerows(rows)


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def open_spreadsheet() -> tuple[Any, str]:
    load_dotenv()
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "").strip()
    credentials_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "").strip()
    if not sheet_id or not credentials_json:
        raise ValueError("GOOGLE_SHEET_ID and GOOGLE_CREDENTIALS_JSON must be set")

    creds = Credentials.from_service_account_info(
        json.loads(credentials_json),
        scopes=SCOPES,
    )
    client = gspread.authorize(creds)
    return client.open_by_key(sheet_id), sheet_id


def write_workbook_backup(
    spreadsheet: Any,
    *,
    sheet_id: str,
    backup_dir: Path,
    generated_at: str,
) -> dict[str, Any]:
    backup_dir.mkdir(parents=True, exist_ok=False)

    manifest: dict[str, Any] = {
        "version": 1,
        "generated_at": generated_at,
        "generated_at_iso": datetime.now(timezone.utc).isoformat(),
        "sheet_id": sheet_id,
        "tabs": [],
    }
    used_names: set[str] = set()

    for worksheet in spreadsheet.worksheets():
        rows = worksheet.get_all_values()
        csv_name = _safe_csv_name(worksheet.title, used_names)
        csv_path = backup_dir / csv_name
        _write_csv(csv_path, rows)

        size = csv_path.stat().st_size
        if rows and size == 0:
            raise RuntimeError(
                f"Backup for {worksheet.title!r} is empty despite {len(rows)} rows"
            )

        tab_manifest = {
            "tab": worksheet.title,
            "rows": len(rows),
            "grid_rows": getattr(worksheet, "row_count", None),
            "col_count": getattr(worksheet, "col_count", None),
            "bytes": size,
            "sha256": _sha256_file(csv_path),
            "csv_path": _display_path(csv_path),
        }
        manifest["tabs"].append(tab_manifest)
        print(f"[backup] {worksheet.title}: {len(rows)} rows, {size:,} bytes")

    manifest_path = backup_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[backup] manifest: {manifest_path}")
    return manifest


def main() -> int:
    spreadsheet, sheet_id = open_spreadsheet()
    stamp = _utc_stamp()
    backup_dir = BACKUP_ROOT / stamp
    manifest = write_workbook_backup(
        spreadsheet,
        sheet_id=sheet_id,
        backup_dir=backup_dir,
        generated_at=stamp,
    )

    print()
    print(f"Backup complete: {backup_dir}")
    print(f"Total tabs: {len(manifest['tabs'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
