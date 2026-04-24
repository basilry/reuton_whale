import csv
import json
from argparse import Namespace
from datetime import datetime, timezone

import pytest

from scripts.backup_sheets_snapshot import write_workbook_backup
from scripts.purge_sheets_once import (
    APPLY_CONFIRMATION,
    RetentionRule,
    collapse_runs,
    parse_timestamp,
    plan_purge_rows,
    purge_tab,
    run,
    split_delete_range,
    validate_backup_manifest,
)


class FakeWorksheet:
    def __init__(self, title, rows, *, row_count=None, col_count=None):
        self.title = title
        self.rows = [list(row) for row in rows]
        self.row_count = row_count or len(rows)
        self.col_count = col_count or max((len(row) for row in rows), default=1)
        self.delete_calls = []
        self.resize_calls = []

    def get_all_values(self):
        return [list(row) for row in self.rows]

    def delete_rows(self, start, end):
        self.delete_calls.append((start, end))
        del self.rows[start - 1:end]

    def resize(self, *, rows, cols):
        self.resize_calls.append({"rows": rows, "cols": cols})
        self.row_count = rows
        self.col_count = cols


class FakeSpreadsheet:
    def __init__(self, worksheets):
        self._worksheets = {worksheet.title: worksheet for worksheet in worksheets}

    def worksheets(self):
        return list(self._worksheets.values())

    def worksheet(self, title):
        return self._worksheets[title]


def test_backup_writes_all_tabs_and_manifest(tmp_path):
    spreadsheet = FakeSpreadsheet(
        [
            FakeWorksheet("transactions", [["hash", "created_at"], ["0x1", "2026-04-24T00:00:00Z"]]),
            FakeWorksheet("system/log", [["run_id"], ["r1"]]),
        ]
    )

    manifest = write_workbook_backup(
        spreadsheet,
        sheet_id="sheet-123",
        backup_dir=tmp_path / "backup",
        generated_at="20260424T000000Z",
    )

    manifest_path = tmp_path / "backup" / "manifest.json"
    assert manifest_path.exists()
    assert manifest["sheet_id"] == "sheet-123"
    assert {tab["tab"] for tab in manifest["tabs"]} == {"transactions", "system/log"}

    csv_paths = [tmp_path / "backup" / tab["csv_path"].split("/")[-1] for tab in manifest["tabs"]]
    for path in csv_paths:
        assert path.exists()
        assert path.stat().st_size > 0

    with csv_paths[0].open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    assert rows[0]

    loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert len(loaded["tabs"]) == 2


def test_parse_timestamp_accepts_iso_z_epoch_and_naive():
    assert parse_timestamp("2026-04-24T01:02:03Z") == datetime(
        2026, 4, 24, 1, 2, 3, tzinfo=timezone.utc
    )
    assert parse_timestamp("0") == datetime(1970, 1, 1, tzinfo=timezone.utc)
    assert parse_timestamp("2026-04-24T01:02:03").tzinfo is not None
    assert parse_timestamp("not-a-date") is None


def test_transactions_created_at_falls_back_to_timestamp_per_row():
    values = [
        ["created_at", "timestamp"],
        ["", "2026-01-01T00:00:00Z"],
        ["not-a-date", "2026-04-20T00:00:00Z"],
        ["not-a-date", ""],
    ]
    rule = RetentionRule("transactions", ("created_at", "timestamp"), 90)
    cutoff = datetime(2026, 4, 1, tzinfo=timezone.utc)

    result = plan_purge_rows(values, rule, cutoff)

    assert result["delete_rows"] == [2]
    assert result["to_delete"] == 1
    assert result["kept"] == 1
    assert result["unparseable_kept"] == 1
    assert result["timestamp_columns_used"] == ["created_at", "timestamp"]


def test_dry_run_does_not_delete_or_resize_rows():
    worksheet = FakeWorksheet(
        "service_health",
        [["ts"], ["2026-01-01T00:00:00Z"], ["2026-04-24T00:00:00Z"]],
    )
    rule = RetentionRule("service_health", ("ts",), 14)

    report = purge_tab(
        worksheet,
        rule,
        now=datetime(2026, 4, 24, tzinfo=timezone.utc),
        apply=False,
        sleep_seconds=0,
    )

    assert report["to_delete"] == 1
    assert report["applied"] is False
    assert worksheet.delete_calls == []
    assert worksheet.resize_calls == []


def test_apply_deletes_bottom_up_in_batches_of_5000_and_resizes():
    old_rows = [["2026-01-01T00:00:00Z"] for _ in range(6002)]
    worksheet = FakeWorksheet("service_health", [["ts"], *old_rows], col_count=3)
    rule = RetentionRule("service_health", ("ts",), 14)

    report = purge_tab(
        worksheet,
        rule,
        now=datetime(2026, 4, 24, tzinfo=timezone.utc),
        apply=True,
        sleep_seconds=0,
    )

    assert worksheet.delete_calls == [(1004, 6003), (2, 1003)]
    assert all(end - start + 1 <= 5000 for start, end in worksheet.delete_calls)
    assert worksheet.rows == [["ts"]]
    assert worksheet.resize_calls == [{"rows": 201, "cols": 3}]
    assert report["applied"] is True
    assert report["final_rows"] == 1


def test_apply_resizes_even_when_no_rows_are_deleted():
    worksheet = FakeWorksheet(
        "service_health",
        [["ts"], ["2026-04-24T00:00:00Z"]],
        row_count=10_000,
        col_count=2,
    )
    rule = RetentionRule("service_health", ("ts",), 14)

    report = purge_tab(
        worksheet,
        rule,
        now=datetime(2026, 4, 24, tzinfo=timezone.utc),
        apply=True,
        sleep_seconds=0,
    )

    assert report["to_delete"] == 0
    assert worksheet.delete_calls == []
    assert worksheet.resize_calls == [{"rows": 202, "cols": 2}]
    assert report["applied"] is True


def test_manifest_validation_reports_current_row_mismatch():
    spreadsheet = FakeSpreadsheet(
        [FakeWorksheet("service_health", [["ts"], ["2026-04-24T00:00:00Z"]])]
    )
    manifest = {
        "sheet_id": "sheet-123",
        "tabs": [{"tab": "service_health", "rows": 1}],
    }

    errors = validate_backup_manifest(
        spreadsheet,
        manifest,
        target_tabs={"service_health"},
        sheet_id="sheet-123",
    )

    assert errors == [
        "service_health: row mismatch after backup (manifest=1, current=2)"
    ]


def test_manifest_validation_reports_sheet_id_mismatch():
    spreadsheet = FakeSpreadsheet([FakeWorksheet("service_health", [["ts"]])])
    manifest = {
        "sheet_id": "old-sheet",
        "tabs": [{"tab": "service_health", "rows": 1}],
    }

    errors = validate_backup_manifest(
        spreadsheet,
        manifest,
        target_tabs={"service_health"},
        sheet_id="new-sheet",
    )

    assert errors[0] == "manifest sheet_id mismatch: manifest=old-sheet current=new-sheet"


def test_delete_range_helpers_are_contiguous_and_descending_batch_safe():
    assert collapse_runs([2, 3, 4, 8, 9]) == [(2, 4), (8, 9)]
    assert split_delete_range(2, 6003) == [(1004, 6003), (2, 1003)]
    assert APPLY_CONFIRMATION == "I UNDERSTAND THIS DELETES ROWS"


def test_run_writes_dryrun_summary_to_output_path(tmp_path, monkeypatch):
    worksheet = FakeWorksheet(
        "service_health",
        [["ts"], ["2026-01-01T00:00:00Z"], ["2026-04-24T00:00:00Z"]],
    )
    spreadsheet = FakeSpreadsheet([worksheet])
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps({"sheet_id": "sheet-123", "tabs": [{"tab": "service_health", "rows": 3}]}),
        encoding="utf-8",
    )
    output_path = tmp_path / "purge-dryrun.json"

    monkeypatch.setattr(
        "scripts.purge_sheets_once.open_spreadsheet",
        lambda: (spreadsheet, "sheet-123"),
    )

    exit_code = run(
        Namespace(
            backup_manifest=str(manifest_path),
            apply=False,
            tab="service_health",
            output=str(output_path),
        )
    )

    assert exit_code == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["apply"] is False
    assert payload["retention_tabs"] == ["service_health"]
    assert payload["results"][0]["to_delete"] == 1
