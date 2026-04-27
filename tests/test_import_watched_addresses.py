from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import sys

import scripts.import_watched_addresses as import_script
from scripts.import_watched_addresses import load_csv, main, validate_rows


def test_load_csv_ignores_leading_comment_lines(tmp_path: Path) -> None:
    csv_path = tmp_path / "watched_addresses.csv"
    csv_path.write_text(
        "\n".join(
            [
                "# chain enum: ETH, XRP, TRX, BTC, DOGE",
                "# feature flags: ENABLE_CHAIN_XRP, ENABLE_CHAIN_TRX, ENABLE_CHAIN_BTC, ENABLE_CHAIN_DOGE",
                "# partial view: BTC and DOGE may render a partial-view badge",
                "address,chain,category,label,source,confidence,enabled,added_at,notes",
                "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo,BTC,cex,Binance BTC Cold 1,public,high,true,2026-04-19,test row",
            ]
        ),
        encoding="utf-8",
    )

    rows = load_csv(csv_path)

    assert rows == [
        {
            "address": "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
            "chain": "BTC",
            "category": "cex",
            "label": "Binance BTC Cold 1",
            "source": "public",
            "confidence": "high",
            "enabled": "true",
            "added_at": "2026-04-19",
            "notes": "test row",
        }
    ]


def test_validate_rows_rejects_missing_columns_and_invalid_values() -> None:
    fieldnames = [
        "address",
        "chain",
        "category",
        "label",
        "source",
        "confidence",
        "enabled",
        "added_at",
    ]
    rows = [
        {
            "address": "0xABC",
            "chain": "eth",
            "category": "cex",
            "label": "Binance",
            "source": "manual",
            "confidence": "sure",
            "enabled": "maybe",
            "added_at": "2026-04-20",
        }
    ]

    report = validate_rows(fieldnames, rows)

    assert report.has_errors
    assert report.normalized_rows == []
    assert [message.message for message in report.errors] == [
        "missing required columns: notes"
    ]


def test_validate_rows_detects_duplicate_by_canonical_chain_and_normalized_address() -> None:
    fieldnames = [
        "address",
        "chain",
        "category",
        "label",
        "source",
        "confidence",
        "enabled",
        "added_at",
        "notes",
    ]
    rows = [
        {
            "address": "0xABCDEF",
            "chain": "ethereum",
            "category": "cex",
            "label": "A",
            "source": "manual",
            "confidence": "HIGH",
            "enabled": "YES",
            "added_at": "2026-04-20",
            "notes": "",
        },
        {
            "address": "0xabcdef",
            "chain": "ETH",
            "category": "cex",
            "label": "B",
            "source": "manual",
            "confidence": "0.9",
            "enabled": "true",
            "added_at": "2026-04-20",
            "notes": "",
        },
    ]

    report = validate_rows(fieldnames, rows)

    assert report.chain_counts == {"ETH": 2}
    assert len(report.normalized_rows) == 1
    assert report.normalized_rows[0]["chain"] == "ETH"
    assert report.normalized_rows[0]["address"] == "0xabcdef"
    assert report.normalized_rows[0]["confidence"] == "high"
    assert report.normalized_rows[0]["enabled"] == "true"
    assert len(report.errors) == 1
    assert "duplicate address for canonical chain ETH: 0xabcdef" in report.errors[0].message


def test_main_dry_run_prints_chain_summary_and_validation_messages(
    tmp_path: Path,
    capsys,
) -> None:
    csv_path = tmp_path / "watched_addresses.csv"
    csv_path.write_text(
        "\n".join(
            [
                "# comment line should be ignored",
                "address,chain,category,label,source,confidence,enabled,added_at,notes",
                "0xABCDEF,eth,cex,Good Row,manual,high,true,2026-04-20,ok",
                "0xabcdef,ETH,cex,Duplicate Row,manual,medium,true,2026-04-20,dup",
                "DTestDogeAddress,DOGE,cex,Doge Row,manual,,true,2026-04-20,blank confidence warning",
                "bad-xrp,XRP,cex,Bad Enabled,manual,high,maybe,2026-04-20,bad enabled",
            ]
        ),
        encoding="utf-8",
    )

    exit_code = main(["--csv", str(csv_path), "--dry-run"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Rows by chain:" in captured.out
    assert "DOGE       1" in captured.out
    assert "ETH        2" in captured.out
    assert "XRP        1" in captured.out
    assert "Validation warnings: 1" in captured.out
    assert "confidence is blank; expected low/medium/high or 0..1" in captured.out
    assert "Validation errors: 2" in captured.out
    assert "duplicate address for canonical chain ETH: 0xabcdef" in captured.out
    assert "enabled must be one of true/false/1/0/yes/no" in captured.out
    assert "dry-run: validation failed;" in captured.out


def test_main_import_mode_aborts_on_validation_errors(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    csv_path = tmp_path / "watched_addresses.csv"
    csv_path.write_text(
        "\n".join(
            [
                "address,chain,category,label,source,confidence,enabled,added_at,notes",
                "0xABC,UNKNOWN,cex,Bad Chain,manual,high,true,2026-04-20,invalid chain",
            ]
        ),
        encoding="utf-8",
    )

    class _ExplodingSheetsClient:
        def __init__(self, *_args, **_kwargs) -> None:
            raise AssertionError("SheetsClient should not be constructed when validation fails")

    monkeypatch.setitem(
        sys.modules,
        "src.config",
        SimpleNamespace(load_config=lambda: SimpleNamespace(sheet_id="id", google_credentials={})),
    )
    monkeypatch.setitem(
        sys.modules,
        "src.storage.sheets_client",
        SimpleNamespace(SheetsClient=_ExplodingSheetsClient),
    )

    exit_code = main(["--csv", str(csv_path)])
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "unsupported chain enum: UNKNOWN" in captured.out
    assert "validation failed; import aborted" in captured.err


def test_main_import_uses_selected_storage_backend(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    csv_path = tmp_path / "watched_addresses.csv"
    csv_path.write_text(
        "\n".join(
            [
                "address,chain,category,label,source,confidence,enabled,added_at,notes",
                "0xABCDEF,eth,cex,Good Row,manual,high,true,2026-04-20,ok",
            ]
        ),
        encoding="utf-8",
    )

    class _RecordingStorage:
        def __init__(self) -> None:
            self.rows: list[dict] = []

        def append_missing_watched_addresses(self, rows: list[dict]) -> dict[str, int]:
            self.rows = rows
            return {"inserted": len(rows), "skipped": 0, "invalid": 0}

    storage = _RecordingStorage()
    called: dict[str, str | None] = {}

    def fake_build_storage_client(*, backend=None, environ=None):
        called["backend"] = backend
        return storage

    monkeypatch.setattr(import_script, "build_storage_client", fake_build_storage_client)

    exit_code = main(["--csv", str(csv_path), "--backend", "postgres"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert called == {"backend": "postgres"}
    assert storage.rows[0]["address"] == "0xabcdef"
    assert storage.rows[0]["chain"] == "ETH"
    assert "Storage backend: postgres" in captured.out
    assert "Imported 1 new addresses" in captured.out
