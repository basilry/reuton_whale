#!/usr/bin/env python3
"""Import watched_addresses.csv into Google Sheets watched_addresses tab.

Usage:
    python scripts/import_watched_addresses.py
    python scripts/import_watched_addresses.py --csv config/watched_addresses.csv
    python scripts/import_watched_addresses.py --dry-run
    python scripts/import_watched_addresses.py --backend postgres
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

from src.storage.factory import build_storage_client, normalize_storage_backend
from src.storage.schema import WATCHED_ADDRESSES_HEADERS
from src.utils.chains import canonical_chain, is_evm_chain
from src.utils.logger import get_logger

logger = get_logger("import_watched")

_DEFAULT_CSV = Path(__file__).resolve().parent.parent / "config" / "watched_addresses.csv"
_SUPPORTED_CHAINS = frozenset(
    {"ETH", "ARB", "BASE", "BSC", "POLYGON", "SOL", "XRP", "TRX", "BTC", "DOGE"}
)
_TRUE_VALUES = frozenset({"true", "1", "yes", "y", "on"})
_FALSE_VALUES = frozenset({"false", "0", "no", "n", "off"})
_TEXT_CONFIDENCE = frozenset({"low", "medium", "high"})


@dataclass(frozen=True)
class ValidationMessage:
    level: str
    message: str
    row_number: int | None = None


@dataclass
class ValidationReport:
    normalized_rows: list[dict[str, str]] = field(default_factory=list)
    warnings: list[ValidationMessage] = field(default_factory=list)
    errors: list[ValidationMessage] = field(default_factory=list)
    chain_counts: Counter[str] = field(default_factory=Counter)

    @property
    def has_errors(self) -> bool:
        return bool(self.errors)


def load_csv_with_fieldnames(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    filtered_lines: list[str] = []
    with open(path, newline="", encoding="utf-8") as f:
        for line in f:
            stripped = line.lstrip()
            if not stripped.strip() or stripped.startswith("#"):
                continue
            filtered_lines.append(line)

    if not filtered_lines:
        return [], []

    reader = csv.DictReader(filtered_lines)
    rows = [{str(key): str(value or "") for key, value in row.items()} for row in reader]
    return list(reader.fieldnames or []), rows


def load_csv(path: Path) -> list[dict[str, str]]:
    _, rows = load_csv_with_fieldnames(path)
    return rows


def _normalize_import_address(address: object, chain: str) -> str:
    text = str(address or "").strip()
    if is_evm_chain(chain):
        return text.lower()
    return text


def _normalize_enabled(value: object) -> tuple[str, str | None, str | None]:
    raw = str(value or "").strip()
    if not raw:
        return "", "enabled is blank; expected true/false", None
    lowered = raw.lower()
    if lowered in _TRUE_VALUES:
        return "true", None, None
    if lowered in _FALSE_VALUES:
        return "false", None, None
    return raw, None, "enabled must be one of true/false/1/0/yes/no"


def _normalize_confidence(value: object) -> tuple[str, str | None, str | None]:
    raw = str(value or "").strip()
    if not raw:
        return "", "confidence is blank; expected low/medium/high or 0..1", None
    lowered = raw.lower()
    if lowered in _TEXT_CONFIDENCE:
        return lowered, None, None
    try:
        numeric = float(raw)
    except ValueError:
        return raw, None, "confidence must be low/medium/high or a numeric value between 0 and 1"
    if 0.0 <= numeric <= 1.0:
        return raw, None, None
    return raw, None, "confidence numeric value must be between 0 and 1"


def validate_rows(
    fieldnames: list[str],
    rows: list[dict[str, str]],
) -> ValidationReport:
    report = ValidationReport()

    missing_columns = [column for column in WATCHED_ADDRESSES_HEADERS if column not in fieldnames]
    if missing_columns:
        report.errors.append(
            ValidationMessage(
                level="error",
                message=f"missing required columns: {', '.join(missing_columns)}",
            )
        )
        return report

    seen_keys: dict[tuple[str, str], int] = {}
    for index, row in enumerate(rows, start=2):
        normalized = {column: str(row.get(column, "") or "").strip() for column in WATCHED_ADDRESSES_HEADERS}

        raw_chain = normalized["chain"]
        canonical = canonical_chain(raw_chain)
        chain_label = canonical or raw_chain.upper() or "(blank)"
        report.chain_counts[chain_label] += 1

        if not canonical or canonical not in _SUPPORTED_CHAINS:
            report.errors.append(
                ValidationMessage(
                    level="error",
                    row_number=index,
                    message=f"unsupported chain enum: {raw_chain or '(blank)'}",
                )
            )
            continue
        normalized["chain"] = canonical

        normalized["address"] = _normalize_import_address(normalized["address"], canonical)
        if not normalized["address"]:
            report.errors.append(
                ValidationMessage(level="error", row_number=index, message="address is blank")
            )
            continue

        normalized["enabled"], enabled_warning, enabled_error = _normalize_enabled(
            normalized.get("enabled")
        )
        if enabled_warning:
            report.warnings.append(
                ValidationMessage(level="warning", row_number=index, message=enabled_warning)
            )
        if enabled_error:
            report.errors.append(
                ValidationMessage(level="error", row_number=index, message=enabled_error)
            )

        normalized["confidence"], confidence_warning, confidence_error = _normalize_confidence(
            normalized.get("confidence")
        )
        if confidence_warning:
            report.warnings.append(
                ValidationMessage(level="warning", row_number=index, message=confidence_warning)
            )
        if confidence_error:
            report.errors.append(
                ValidationMessage(level="error", row_number=index, message=confidence_error)
            )

        dedup_key = (canonical, normalized["address"])
        previous_row = seen_keys.get(dedup_key)
        if previous_row is not None:
            report.errors.append(
                ValidationMessage(
                    level="error",
                    row_number=index,
                    message=(
                        "duplicate address for canonical chain "
                        f"{canonical}: {normalized['address']} (already seen at row {previous_row})"
                    ),
                )
            )
            continue
        seen_keys[dedup_key] = index

        if enabled_error or confidence_error:
            continue
        report.normalized_rows.append(normalized)

    return report


def _print_row_listing(rows: list[dict[str, str]]) -> None:
    for row in rows:
        print(
            f"  {row['chain']:10s} {row['category']:15s} {row['label']:30s} "
            f"{row['address']}"
        )


def _print_chain_summary(chain_counts: Counter[str]) -> None:
    print("Rows by chain:")
    if not chain_counts:
        print("  (none)")
        return
    for chain, count in sorted(chain_counts.items()):
        print(f"  {chain:10s} {count}")


def _print_messages(title: str, messages: list[ValidationMessage]) -> None:
    print(f"{title}: {len(messages)}")
    if not messages:
        print("  (none)")
        return
    for item in messages:
        prefix = f"row {item.row_number}" if item.row_number is not None else "file"
        print(f"  - {prefix}: {item.message}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import watched addresses from CSV into storage")
    parser.add_argument("--csv", default=str(_DEFAULT_CSV), help="Path to CSV file")
    parser.add_argument("--dry-run", action="store_true", help="Print rows without writing")
    parser.add_argument(
        "--backend",
        choices=("sheets", "postgres"),
        default=None,
        help="Storage backend to write to. Defaults to STORAGE_BACKEND.",
    )
    args = parser.parse_args(argv)

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1

    fieldnames, rows = load_csv_with_fieldnames(csv_path)
    report = validate_rows(fieldnames, rows)
    print(f"Loaded {len(rows)} addresses from {csv_path}")
    _print_row_listing(report.normalized_rows)
    _print_chain_summary(report.chain_counts)
    _print_messages("Validation warnings", report.warnings)
    _print_messages("Validation errors", report.errors)

    if args.dry_run:
        if report.has_errors:
            print(
                f"dry-run: validation failed; {len(report.normalized_rows)} valid rows "
                "would be importable after fixes"
            )
        else:
            print(f"dry-run: {len(report.normalized_rows)} rows would be imported")
        return 0

    if report.has_errors:
        print("validation failed; import aborted", file=sys.stderr)
        return 1

    load_dotenv()
    backend = normalize_storage_backend(args.backend)
    storage = build_storage_client(backend=backend)

    try:
        result = storage.append_missing_watched_addresses(report.normalized_rows)
    except Exception as e:
        logger.error("Failed to import watched addresses: %s", e)
        return 1

    print(f"Storage backend: {backend}")
    print(
        "Imported {inserted} new addresses, skipped {skipped} existing, "
        "{invalid} invalid".format(**result)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
