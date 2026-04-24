"""One-time Google Sheets retention purge for the 10M-cell recovery.

Usage:
    python -m scripts.purge_sheets_once --backup-manifest backups/sheets/<stamp>/manifest.json
    python -m scripts.purge_sheets_once --backup-manifest backups/sheets/<stamp>/manifest.json --apply

Dry-run is the default. Destructive mode requires --apply and the exact
interactive token: I UNDERSTAND THIS DELETES ROWS.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
DELETE_BATCH_MAX = 5_000
RESIZE_BUFFER_ROWS = 200
APPLY_CONFIRMATION = "I UNDERSTAND THIS DELETES ROWS"
DEFAULT_SUMMARY_DIR = Path("docs/obsidian/attachments")


@dataclass(frozen=True)
class RetentionRule:
    tab: str
    timestamp_columns: tuple[str, ...]
    cutoff_days: int


RETENTION_RULES: tuple[RetentionRule, ...] = (
    RetentionRule("service_health", ("ts",), 14),
    RetentionRule("system_log", ("started_at",), 14),
    RetentionRule("tg_whale_events", ("collected_at",), 30),
    RetentionRule("broadcast_log", ("ts",), 30),
    RetentionRule("market_snapshots", ("ts",), 14),
    RetentionRule("address_activity", ("collected_at",), 60),
    RetentionRule("analysis_log", ("created_at",), 60),
    RetentionRule("transactions", ("created_at", "timestamp"), 90),
)


def parse_timestamp(raw: str | None) -> datetime | None:
    value = (raw or "").strip()
    if not value:
        return None

    try:
        if value.isdigit():
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (OverflowError, TypeError, ValueError):
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def collapse_runs(sorted_indices: list[int]) -> list[tuple[int, int]]:
    if not sorted_indices:
        return []

    runs: list[tuple[int, int]] = []
    start = prev = sorted_indices[0]
    for index in sorted_indices[1:]:
        if index == prev + 1:
            prev = index
            continue
        runs.append((start, prev))
        start = prev = index
    runs.append((start, prev))
    return runs


def split_delete_range(start: int, end: int) -> list[tuple[int, int]]:
    batches: list[tuple[int, int]] = []
    current_end = end
    while current_end >= start:
        current_start = max(start, current_end - DELETE_BATCH_MAX + 1)
        batches.append((current_start, current_end))
        current_end = current_start - 1
    return batches


def _column_indices(header: list[str], columns: tuple[str, ...]) -> list[int]:
    return [header.index(column) for column in columns if column in header]


def _first_parseable_timestamp(row: list[str], column_indices: list[int]) -> datetime | None:
    for index in column_indices:
        raw = row[index] if index < len(row) else ""
        parsed = parse_timestamp(raw)
        if parsed is not None:
            return parsed
    return None


def plan_purge_rows(
    values: list[list[str]],
    rule: RetentionRule,
    cutoff: datetime,
) -> dict[str, Any]:
    if not values:
        return {
            "tab": rule.tab,
            "total_rows": 0,
            "to_delete": 0,
            "delete_rows": [],
            "kept": 0,
            "unparseable_kept": 0,
            "cutoff": cutoff.isoformat(),
            "timestamp_columns_used": [],
            "error": "empty worksheet",
        }

    header = values[0]
    column_indices = _column_indices(header, rule.timestamp_columns)
    if not column_indices:
        return {
            "tab": rule.tab,
            "total_rows": max(0, len(values) - 1),
            "to_delete": 0,
            "delete_rows": [],
            "kept": max(0, len(values) - 1),
            "unparseable_kept": 0,
            "cutoff": cutoff.isoformat(),
            "timestamp_columns_used": [],
            "error": (
                "timestamp columns not found: "
                + ", ".join(rule.timestamp_columns)
            ),
        }

    delete_rows: list[int] = []
    unparseable = 0
    kept = 0
    kept_oldest: datetime | None = None

    for row_index, row in enumerate(values[1:], start=2):
        parsed = _first_parseable_timestamp(row, column_indices)
        if parsed is None:
            unparseable += 1
            continue
        if parsed < cutoff:
            delete_rows.append(row_index)
            continue
        kept += 1
        if kept_oldest is None or parsed < kept_oldest:
            kept_oldest = parsed

    used_columns = [header[index] for index in column_indices]
    return {
        "tab": rule.tab,
        "total_rows": max(0, len(values) - 1),
        "to_delete": len(delete_rows),
        "delete_rows": delete_rows,
        "kept": kept,
        "unparseable_kept": unparseable,
        "cutoff": cutoff.isoformat(),
        "timestamp_columns_used": used_columns,
        "kept_oldest": kept_oldest.isoformat() if kept_oldest else None,
    }


def _delete_rows_bottom_up(worksheet: Any, delete_rows: list[int], *, sleep_seconds: float) -> None:
    runs = list(reversed(collapse_runs(sorted(delete_rows))))
    for start, end in runs:
        for batch_start, batch_end in split_delete_range(start, end):
            worksheet.delete_rows(batch_start, batch_end)
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)


def purge_tab(
    worksheet: Any,
    rule: RetentionRule,
    *,
    now: datetime,
    apply: bool,
    sleep_seconds: float = 1.0,
) -> dict[str, Any]:
    cutoff = now - timedelta(days=rule.cutoff_days)
    values = worksheet.get_all_values()
    plan = plan_purge_rows(values, rule, cutoff)
    delete_rows = plan.pop("delete_rows")
    report: dict[str, Any] = {
        **plan,
        "cutoff_days": rule.cutoff_days,
        "applied": False,
        "delete_batches": sum(
            len(split_delete_range(start, end))
            for start, end in collapse_runs(sorted(delete_rows))
        ),
    }

    if report.get("error") or not apply:
        return report

    if delete_rows:
        _delete_rows_bottom_up(worksheet, delete_rows, sleep_seconds=sleep_seconds)
    final_values = worksheet.get_all_values()
    final_rows = len(final_values)
    resized_rows = final_rows + RESIZE_BUFFER_ROWS
    worksheet.resize(rows=resized_rows, cols=worksheet.col_count)

    report.update(
        {
            "applied": True,
            "final_rows": final_rows,
            "resized_to_rows": resized_rows,
        }
    )
    return report


def load_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest.get("tabs"), list):
        raise ValueError("Backup manifest must contain a tabs list")
    return manifest


def _manifest_tab_rows(manifest: dict[str, Any]) -> dict[str, int]:
    rows_by_tab: dict[str, int] = {}
    for tab in manifest.get("tabs", []):
        title = str(tab.get("tab", ""))
        if not title:
            continue
        rows_by_tab[title] = int(tab.get("rows", -1))
    return rows_by_tab


def validate_backup_manifest(
    spreadsheet: Any,
    manifest: dict[str, Any],
    *,
    target_tabs: set[str],
    sheet_id: str | None = None,
) -> list[str]:
    errors: list[str] = []
    manifest_sheet_id = manifest.get("sheet_id")
    if sheet_id and manifest_sheet_id and manifest_sheet_id != sheet_id:
        errors.append(
            f"manifest sheet_id mismatch: manifest={manifest_sheet_id} current={sheet_id}"
        )

    manifest_rows = _manifest_tab_rows(manifest)
    for tab in sorted(target_tabs):
        try:
            worksheet = spreadsheet.worksheet(tab)
        except gspread.exceptions.WorksheetNotFound:
            continue

        if tab not in manifest_rows:
            errors.append(f"{tab}: missing from backup manifest")
            continue
        current_rows = len(worksheet.get_all_values())
        expected_rows = manifest_rows[tab]
        if current_rows != expected_rows:
            errors.append(
                f"{tab}: row mismatch after backup "
                f"(manifest={expected_rows}, current={current_rows})"
            )
    return errors


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


def _selected_rules(tab: str | None) -> tuple[RetentionRule, ...]:
    if tab is None:
        return RETENTION_RULES
    rules = tuple(rule for rule in RETENTION_RULES if rule.tab == tab)
    if not rules:
        valid = ", ".join(rule.tab for rule in RETENTION_RULES)
        raise ValueError(f"Unknown purge tab {tab!r}. Valid tabs: {valid}")
    return rules


def _require_apply_confirmation() -> bool:
    token = input(f"Type '{APPLY_CONFIRMATION}' to continue: ").strip()
    return token == APPLY_CONFIRMATION


def run(args: argparse.Namespace) -> int:
    manifest_path = Path(args.backup_manifest)
    manifest = load_manifest(manifest_path)
    spreadsheet, sheet_id = open_spreadsheet()
    rules = _selected_rules(args.tab)
    target_tabs = {rule.tab for rule in rules}

    if args.apply:
        errors = validate_backup_manifest(
            spreadsheet,
            manifest,
            target_tabs=target_tabs,
            sheet_id=sheet_id,
        )
        if errors:
            print("Backup manifest validation failed:", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 3
        if not _require_apply_confirmation():
            print("Aborted.")
            return 2

    now = datetime.now(timezone.utc)
    results: list[dict[str, Any]] = []
    for rule in rules:
        try:
            worksheet = spreadsheet.worksheet(rule.tab)
        except gspread.exceptions.WorksheetNotFound:
            report = {
                "tab": rule.tab,
                "skipped": "worksheet_not_found",
                "applied": False,
            }
            results.append(report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            continue

        report = purge_tab(worksheet, rule, now=now, apply=args.apply)
        results.append(report)
        print(json.dumps(report, ensure_ascii=False, indent=2))

    summary = {
        "generated_at": now.isoformat(),
        "apply": bool(args.apply),
        "backup_manifest": str(manifest_path),
        "retention_tabs": [rule.tab for rule in rules],
        "results": results,
    }
    summary_path = Path(args.output) if args.output else DEFAULT_SUMMARY_DIR / (
        f"2026-04-24-sheets-purge-{'apply' if args.apply else 'dryrun'}.json"
    )
    summary["summary_path"] = str(summary_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="One-time Sheets retention purge")
    parser.add_argument(
        "--backup-manifest",
        required=True,
        help="Path to backups/sheets/<stamp>/manifest.json from backup_sheets_snapshot",
    )
    parser.add_argument("--apply", action="store_true", help="Actually delete rows")
    parser.add_argument("--tab", help="Only process one of the 8 retention tabs")
    parser.add_argument(
        "--output",
        help=(
            "Optional JSON summary output path. Defaults to "
            "docs/obsidian/attachments/2026-04-24-sheets-purge-{dryrun|apply}.json"
        ),
    )
    return parser


def main() -> int:
    parser = build_parser()
    return run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
