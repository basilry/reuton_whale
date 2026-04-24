from __future__ import annotations

import json

from scripts.diagnose_sheets_cells import (
    SHEETS_CELL_LIMIT,
    build_workbook_inventory,
    build_worksheet_inventory,
    format_text_report,
    inventory_to_dict,
)


def test_build_worksheet_inventory_counts_grid_data_and_empty_rows() -> None:
    inventory = build_worksheet_inventory(
        tab="transactions",
        row_count=10,
        col_count=4,
        values=[
            ["created_at", "chain", "hash", "amount"],
            ["2026-04-24", "ETH", "0x1", "10"],
            ["", "", "", ""],
            ["2026-04-24", "BTC", "abc", "2"],
        ],
    )

    assert inventory.tab == "transactions"
    assert inventory.row_count == 10
    assert inventory.col_count == 4
    assert inventory.grid_cells == 40
    assert inventory.data_rows == 2
    assert inventory.empty_rows == 7


def test_build_workbook_inventory_sorts_by_grid_cells_and_summarizes_limit() -> None:
    small = build_worksheet_inventory(
        tab="signals",
        row_count=10,
        col_count=3,
        values=[["ts", "type", "score"]],
    )
    large = build_worksheet_inventory(
        tab="service_health",
        row_count=100,
        col_count=8,
        values=[["ts", "service"], ["2026-04-24", "pipeline"]],
    )

    summary = build_workbook_inventory(
        [small, large],
        generated_at="2026-04-24T00:00:00+00:00",
        limit=1_000,
    )

    assert [item.tab for item in summary.worksheets] == ["service_health", "signals"]
    assert summary.total == 830
    assert summary.limit == 1_000
    assert summary.headroom == 170


def test_inventory_to_dict_is_json_serializable_with_required_keys() -> None:
    worksheet = build_worksheet_inventory(
        tab="broadcast_log",
        row_count=5,
        col_count=6,
        values=[["ts", "status"], ["2026-04-24", "skipped"]],
    )
    summary = build_workbook_inventory([worksheet], generated_at="2026-04-24T00:00:00+00:00")

    payload = inventory_to_dict(summary)

    assert payload["limit"] == SHEETS_CELL_LIMIT
    assert payload["total_grid_cells"] == 30
    assert payload["total"] == 30
    assert payload["headroom"] == SHEETS_CELL_LIMIT - 30
    assert payload["tabs"] == payload["worksheets"]
    assert payload["worksheets"] == [
        {
            "tab": "broadcast_log",
            "row_count": 5,
            "col_count": 6,
            "grid_cells": 30,
            "data_rows": 1,
            "empty_rows": 3,
        }
    ]
    json.dumps(payload)


def test_format_text_report_includes_totals_and_sorted_rows() -> None:
    summary = build_workbook_inventory(
        [
            build_worksheet_inventory(
                tab="signals",
                row_count=10,
                col_count=3,
                values=[["ts"], ["2026-04-24"]],
            ),
            build_worksheet_inventory(
                tab="transactions",
                row_count=20,
                col_count=5,
                values=[["created_at"]],
            ),
        ],
        generated_at="2026-04-24T00:00:00+00:00",
        limit=200,
    )

    report = format_text_report(summary)

    assert "Total grid cells: 130 / 200 (65.0%)" in report
    assert "Headroom: 70" in report
    assert report.index("transactions") < report.index("signals")
