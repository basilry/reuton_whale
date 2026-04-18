#!/usr/bin/env python3
"""Import curated whale wallet rows from the Obsidian markdown note.

Usage:
    python scripts/import_curated_wallets.py
    python scripts/import_curated_wallets.py --dry-run
    python scripts/import_curated_wallets.py --source /path/to/note.md
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.storage.sheets_client import SheetsClient

DEFAULT_SOURCE = Path(
    "/Users/basilry/Documents/Obsidian Vault/Projects/02015-WhaleScope/"
    "Top 10 Liquid Coins - Whale Wallets (2026.4 Updated).md"
)

SECTION_RE = re.compile(r"^##\s+\d+\.\s+(.+?)\s+\(([^)]+)\)\s*$")
TABLE_RE = re.compile(r"^\|(.+)\|\s*$")
EVM_ADDRESS_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
BTC_ADDRESS_RE = re.compile(r"^(bc1[a-z0-9]{20,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$")
SOL_ADDRESS_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
XRP_ADDRESS_RE = re.compile(r"^r[1-9A-HJ-NP-Za-km-z]{24,34}$")
DOGE_ADDRESS_RE = re.compile(r"^D[1-9A-HJ-NP-Za-km-z]{25,34}$")
TRX_ADDRESS_RE = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")


@dataclass
class ParsedWallet:
    asset: str
    chain: str
    rank: str
    address: str
    owner_label: str
    owner_category: str
    owner_subcategory: str
    approx_balance: str
    tier: str
    note: str


def clean_cell(value: str) -> str:
    text = value.strip()
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"`(.*?)`", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "wallet"


def infer_chain(asset: str) -> str:
    mapping = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "USDT": "ethereum",
        "USDC": "ethereum",
        "SOL": "solana",
        "XRP": "xrp",
        "BNB": "bnb",
        "DOGE": "dogecoin",
        "TRX": "tron",
        "TON": "ton",
    }
    return mapping.get(asset.upper(), asset.lower())


def infer_owner_fields(owner_note: str) -> tuple[str, str, str]:
    owner_note = clean_cell(owner_note)
    owner_label = re.split(r"\s+\(|\s+[-—]\s+", owner_note, maxsplit=1)[0].strip()
    lowered = owner_note.lower()

    if any(key in lowered for key in ("binance", "coinbase", "bitfinex", "upbit", "bithumb", "huobi", "robinhood", "okx")):
        category = "exchange"
    elif any(key in lowered for key in ("blackrock", "bitmine", "institutional", "prime", "corporate", "fbi")):
        category = "institution"
    elif any(key in lowered for key in ("foundation", "labs", "treasury")):
        category = "foundation"
    elif any(key in lowered for key in ("vitalik", "lubin", "larsen", "mccaleb", "satoshi", "founder")):
        category = "founder"
    elif any(key in lowered for key in ("tether", "circle")):
        category = "stablecoin"
    elif any(key in lowered for key in ("contract", "deposit", "escrow", "wrapped ether", "weth")):
        category = "protocol"
    else:
        category = "unknown"

    if "cold" in lowered:
        subcategory = "cold"
    elif "hot" in lowered:
        subcategory = "hot"
    elif "escrow" in lowered:
        subcategory = "escrow"
    elif "contract" in lowered or "deposit" in lowered:
        subcategory = "staking-contract"
    else:
        subcategory = ""

    return owner_label or owner_note, category, subcategory


def infer_tier(rank: str, balance: str) -> str:
    rank_text = clean_cell(rank)
    balance_text = clean_cell(balance).lower()

    if rank_text in {"1", "2", "3"}:
        return "1"
    if rank_text in {"4", "5", "6", "7"}:
        return "2"
    if rank_text:
        return "3"

    if any(token in balance_text for token in ("m+", "1.1m", "million")):
        return "1"
    if any(token in balance_text for token in ("250k", "248k", "150k", "140k", "130k", "96k", "94k", "86k", "large")):
        return "2"
    return "3"


def is_valid_address(chain: str, address: str) -> bool:
    value = address.strip()
    if not value or value in {"—", "-", "0x..."}:
        return False

    chain_key = chain.lower()
    if chain_key in {"ethereum", "bnb"}:
        return bool(EVM_ADDRESS_RE.fullmatch(value))
    if chain_key == "bitcoin":
        return bool(BTC_ADDRESS_RE.fullmatch(value))
    if chain_key == "solana":
        return bool(SOL_ADDRESS_RE.fullmatch(value))
    if chain_key == "xrp":
        return bool(XRP_ADDRESS_RE.fullmatch(value))
    if chain_key == "dogecoin":
        return bool(DOGE_ADDRESS_RE.fullmatch(value))
    if chain_key == "tron":
        return bool(TRX_ADDRESS_RE.fullmatch(value))
    if chain_key == "ton":
        return len(value) >= 32 and " " not in value
    return False


def parse_table(lines: list[str], asset: str, chain: str) -> list[ParsedWallet]:
    rows: list[ParsedWallet] = []
    header: list[str] | None = None

    for raw_line in lines:
        match = TABLE_RE.match(raw_line)
        if not match:
            continue

        cells = [clean_cell(part) for part in match.group(1).split("|")]
        if header is None:
            header = cells
            continue
        if all(set(cell) <= {"-"} for cell in cells):
            continue
        if header is None or len(cells) != len(header):
            continue

        row = dict(zip(header, cells))
        address = row.get("Address", "")
        owner_note = row.get("Owner / Note", "")
        balance = row.get("Approx. Balance", "")
        rank = row.get("Rank", "")

        if not is_valid_address(chain, address):
            continue

        owner_label, owner_category, owner_subcategory = infer_owner_fields(owner_note)
        note = owner_note if owner_note != owner_label else ""

        rows.append(
            ParsedWallet(
                asset=asset,
                chain=chain,
                rank=rank,
                address=address.strip(),
                owner_label=owner_label,
                owner_category=owner_category,
                owner_subcategory=owner_subcategory,
                approx_balance=balance,
                tier=infer_tier(rank, balance),
                note=note,
            )
        )

    return rows


def parse_wallets(markdown: str) -> list[ParsedWallet]:
    current_asset: str | None = None
    current_chain: str | None = None
    section_lines: list[str] = []
    wallets: list[ParsedWallet] = []

    def flush_section() -> None:
        nonlocal section_lines
        if current_asset and current_chain and section_lines:
            wallets.extend(parse_table(section_lines, current_asset, current_chain))
        section_lines = []

    for line in markdown.splitlines():
        section_match = SECTION_RE.match(line.strip())
        if section_match:
            flush_section()
            current_asset = section_match.group(2).strip().upper()
            current_chain = infer_chain(current_asset)
            continue

        if line.startswith("## ") and not section_match:
            flush_section()
            current_asset = None
            current_chain = None
            continue

        if current_asset and current_chain:
            section_lines.append(line)

    flush_section()
    return wallets


def build_wallet_id(wallet: ParsedWallet) -> str:
    owner_slug = slugify(wallet.owner_label)
    address_suffix = wallet.address[-8:].lower()
    return f"{wallet.asset.lower()}-{owner_slug}-{address_suffix}"


def to_sheet_rows(wallets: list[ParsedWallet], source_path: Path) -> list[dict]:
    rows: list[dict] = []

    for wallet in wallets:
        rows.append(
            {
                "id": build_wallet_id(wallet),
                "chain": wallet.chain,
                "address": wallet.address,
                "owner_label": wallet.owner_label,
                "owner_category": wallet.owner_category,
                "owner_subcategory": wallet.owner_subcategory,
                "approx_balance": wallet.approx_balance,
                "tier": wallet.tier,
                "source_ref": "obsidian_top10_liquid_coins",
                "source_url": str(source_path),
                "note": wallet.note,
                "is_active": "TRUE",
            }
        )

    return rows


def load_sheets_client() -> SheetsClient:
    load_dotenv()

    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    credentials_json = os.getenv("GOOGLE_CREDENTIALS_JSON", "").strip()
    if not sheet_id or not credentials_json:
        raise ValueError("GOOGLE_SHEET_ID and GOOGLE_CREDENTIALS_JSON must be set")

    return SheetsClient(sheet_id, credentials_json)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import curated whale wallets from the Obsidian source note"
    )
    parser.add_argument(
        "--source",
        default=str(DEFAULT_SOURCE),
        help="Path to the Obsidian markdown source",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print rows without writing to Google Sheets",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_path = Path(args.source).expanduser()
    if not source_path.exists():
        print(f"Source note not found: {source_path}", file=sys.stderr)
        return 1

    markdown = source_path.read_text(encoding="utf-8")
    parsed_wallets = parse_wallets(markdown)
    rows = to_sheet_rows(parsed_wallets, source_path)

    print(f"Parsed {len(parsed_wallets)} wallet rows from {source_path}")
    if args.dry_run:
        for row in rows[:20]:
            print(
                f"  {row['chain']:10s} {row['owner_category']:12s} "
                f"{row['owner_label'][:32]:32s} {row['address']}"
            )
        if len(rows) > 20:
            print(f"  ... {len(rows) - 20} more rows")
        print(f"dry-run: {len(rows)} rows would be upserted into curated_wallets")
        return 0

    client = load_sheets_client()
    result = client.upsert_curated_wallets(rows)
    print(
        "Upserted curated_wallets: "
        f"{result['inserted']} inserted, {result['updated']} updated, {result['invalid']} invalid"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
