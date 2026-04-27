#!/usr/bin/env python3
"""Seed human-readable wallet detail profiles into Postgres.

Usage:
    python scripts/seed_wallet_detail_profiles.py --dry-run
    python scripts/seed_wallet_detail_profiles.py
    python scripts/seed_wallet_detail_profiles.py --limit 20 --overwrite
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.import_curated_wallets import parse_wallets, to_sheet_rows
from src.storage.postgres_client import initialize_schema

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception as exc:  # pragma: no cover - dependency guard for local setup.
    raise SystemExit(
        "psycopg is required. Install project requirements before running this script."
    ) from exc


SOURCE = "seed_wallet_detail_profiles.v1"
DEFAULT_CURATED_SOURCE = (
    Path(__file__).resolve().parent.parent
    / "docs"
    / "obsidian"
    / "Top 10 Liquid Coins - Whale Wallets (2026.4 Updated).md"
)


@dataclass(frozen=True)
class WalletProfile:
    wallet_id: str
    entity_id: str
    address: str
    chain: str
    title: str
    thesis: str
    behavior_summary: str
    watch_reason: str
    risk_note: str
    data_status: str
    approx_balance_label: str
    tags: list[str]
    source: str = SOURCE
    source_ref: str = ""
    source_url: str = ""


def display_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    if not parsed.scheme or not parsed.netloc:
        return "<DATABASE_URL set>"
    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    username = parsed.username or ""
    userinfo = f"{username}:***@" if username else ""
    return urlunsplit((parsed.scheme, f"{userinfo}{hostname}{port}", parsed.path, "", ""))


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return str(value)
    return str(value).strip()


def split_tags(value: Any) -> list[str]:
    text = clean_text(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return [clean_text(item) for item in parsed if clean_text(item)]
    return [tag.strip() for tag in text.replace("|", ",").split(",") if tag.strip()]


def unique_tags(*groups: list[str]) -> list[str]:
    seen: set[str] = set()
    tags: list[str] = []
    for group in groups:
        for raw in group:
            tag = clean_text(raw)
            key = tag.lower()
            if not tag or key in seen:
                continue
            seen.add(key)
            tags.append(tag)
    return tags[:8]


def category_copy(category: str, subcategory: str) -> tuple[str, str, str]:
    category_key = category.lower()
    subcategory_key = subcategory.lower()

    if category_key == "exchange":
        thesis = "거래소 또는 수탁 지갑으로 분류되어 대형 유입·유출이 시장 유동성 변화의 선행 단서가 될 수 있습니다."
        behavior = "핫월렛/콜드월렛 성격에 따라 짧은 시간에 다수의 입출금이 몰리거나, 장기 보관 잔고가 큰 단위로 이동하는 패턴을 보입니다."
        watch = "거래소 밖으로 반복 유출되면 매도 압력 완화 또는 보관 이동, 거래소로 반복 유입되면 잠재 매도 대기 물량으로 우선 확인합니다."
    elif category_key in {"institution", "foundation", "founder"}:
        thesis = "기관·재단·초기 보유자 성격의 지갑으로 분류되어 일반 거래소 지갑보다 서사 영향이 큰 이동을 만들 수 있습니다."
        behavior = "거래 빈도는 낮지만 한 번 움직일 때 금액 규모와 뉴스 파급력이 커지는 경향이 있습니다."
        watch = "장기 정체 후 첫 이동, 거래소 방향 이동, 여러 보조 지갑으로의 분산 여부를 우선 관찰합니다."
    elif category_key in {"protocol", "stablecoin"}:
        thesis = "프로토콜 또는 스테이블코인 운용과 연결된 지갑으로, 단순 매수·매도보다 발행·상환·담보·브릿지 맥락으로 해석해야 합니다."
        behavior = "계약·운용 지갑 특성상 반복적이고 규칙적인 이동이 많아, 이상치는 평소 리듬에서 벗어나는 규모와 방향으로 판단합니다."
        watch = "스테이블코인 발행/상환, 브릿지 집중, 담보 이동이 주요 자산 가격 움직임과 동시에 발생하는지 확인합니다."
    elif "cold" in subcategory_key:
        thesis = "콜드월렛 성격의 대형 보관 주소로, 이동 자체가 운영 정책 변화나 보관 구조 재편 신호가 될 수 있습니다."
        behavior = "평소 활동은 적고 잔고 유지 기간이 길며, 이동 시에는 큰 금액이 한 번에 처리되는 경우가 많습니다."
        watch = "장기 미활동 이후 외부 주소나 거래소로 이동하는 이벤트를 우선 감시합니다."
    else:
        thesis = "대형 잔고 또는 반복 관측 이력이 있어 WhaleScope 감시 대상에 포함된 지갑입니다."
        behavior = "현재는 큐레이션 레지스트리 기반의 기본 프로필이며, 직접 연결된 거래가 쌓이면 패턴 해석 정확도가 올라갑니다."
        watch = "최근 24시간 내 대형 이동, 거래소 방향성, 뉴스와 동시 발생하는 이동을 우선 확인합니다."

    return thesis, behavior, watch


def build_profile(row: dict[str, Any]) -> WalletProfile:
    wallet_id = clean_text(row.get("id")) or f"{clean_text(row.get('chain'))}:{clean_text(row.get('address'))}"
    label = clean_text(row.get("owner_label")) or clean_text(row.get("address")) or wallet_id
    chain = clean_text(row.get("chain")) or "unknown"
    address = clean_text(row.get("address"))
    category = clean_text(row.get("owner_category")) or "unknown"
    subcategory = clean_text(row.get("owner_subcategory"))
    tier = clean_text(row.get("tier"))
    approx_balance = clean_text(row.get("approx_balance"))
    approx_balance_label = approx_balance or "원본 큐레이션 문서에 잔고 수치 없음"
    note = clean_text(row.get("note"))
    source_url = clean_text(row.get("source_url"))
    public_source_url = source_url if source_url.startswith(("https://", "http://")) else ""
    thesis, behavior, watch = category_copy(category, subcategory)

    balance_part = f" 등록 잔고는 약 {approx_balance}입니다." if approx_balance else ""
    note_part = f" 기존 메모: {note}" if note else ""
    risk = (
        "소유자 라벨과 잔고는 공개 출처 및 내부 큐레이션 기준으로 갱신 지연이 있을 수 있습니다. "
        "이 프로필은 관찰 우선순위 설명이며 투자 조언이 아닙니다."
    )
    data_status = (
        "curated_wallets 기반 시드 프로필입니다. 직접 연결된 거래·시그널·잔고 스냅샷이 없더라도 "
        "지갑 상세에서 관찰 맥락을 먼저 보여주도록 기록했습니다."
    )
    tags = unique_tags(
        [chain, category, subcategory, tier],
        split_tags(row.get("narrative_tags")),
        ["seed-profile"],
    )

    return WalletProfile(
        wallet_id=wallet_id,
        entity_id=clean_text(row.get("entity_id")),
        address=address,
        chain=chain,
        title=f"{label} 관찰 프로필",
        thesis=f"{thesis}{balance_part}{note_part}",
        behavior_summary=behavior,
        watch_reason=watch,
        risk_note=risk,
        data_status=data_status,
        approx_balance_label=approx_balance_label,
        tags=tags,
        source_ref=clean_text(row.get("source_ref")) or "obsidian_top10_liquid_coins",
        source_url=public_source_url,
    )


def slugify(value: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "wallet"


def load_source_wallet_rows(source_path: Path) -> list[dict[str, Any]]:
    markdown = source_path.read_text(encoding="utf-8")
    parsed_wallets = parse_wallets(markdown)
    return to_sheet_rows(parsed_wallets, source_path)


def curated_row_for_postgres(row: dict[str, Any], index: int) -> dict[str, Any]:
    owner_label = clean_text(row.get("owner_label"))
    owner_category = clean_text(row.get("owner_category"))
    chain = clean_text(row.get("chain"))
    source_url = clean_text(row.get("source_url"))
    public_source_url = source_url if source_url.startswith(("https://", "http://")) else ""
    narrative_tags = unique_tags(
        [chain, owner_category, clean_text(row.get("owner_subcategory")), clean_text(row.get("tier"))],
        ["top10-liquid-coins"],
    )
    return {
        "id": clean_text(row.get("id")),
        "chain": chain,
        "address": clean_text(row.get("address")),
        "owner_label": owner_label,
        "owner_category": owner_category,
        "owner_subcategory": clean_text(row.get("owner_subcategory")),
        # curated_wallets.approx_balance is numeric in Postgres, while the source
        # note stores mixed units such as "288K BTC"; keep that text in the
        # detail profile and avoid lossy numeric coercion here.
        "approx_balance": None,
        "tier": clean_text(row.get("tier")),
        "source_ref": clean_text(row.get("source_ref")) or "obsidian_top10_liquid_coins",
        "source_url": public_source_url,
        "note": clean_text(row.get("note")),
        "entity_id": slugify(owner_label or clean_text(row.get("id"))),
        "is_representative": "true",
        "narrative_tags": json.dumps(narrative_tags, ensure_ascii=False),
        "display_priority": max(1, 1_000 - index),
        "is_active": clean_text(row.get("is_active")) or "TRUE",
    }


def upsert_curated_wallet_rows(database_url: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"inserted": 0, "updated": 0, "invalid": 0}
    sql = """
        INSERT INTO curated_wallets (
          id, chain, address, owner_label, owner_category, owner_subcategory,
          approx_balance, tier, source_ref, source_url, note, entity_id,
          is_representative, narrative_tags, display_priority, is_active,
          created_at, updated_at
        )
        VALUES (
          %(id)s, %(chain)s, %(address)s, %(owner_label)s, %(owner_category)s,
          %(owner_subcategory)s, %(approx_balance)s, %(tier)s, %(source_ref)s,
          %(source_url)s, %(note)s, %(entity_id)s, %(is_representative)s,
          %(narrative_tags)s, %(display_priority)s, %(is_active)s, now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          chain = EXCLUDED.chain,
          address = EXCLUDED.address,
          owner_label = EXCLUDED.owner_label,
          owner_category = EXCLUDED.owner_category,
          owner_subcategory = EXCLUDED.owner_subcategory,
          tier = EXCLUDED.tier,
          source_ref = EXCLUDED.source_ref,
          source_url = EXCLUDED.source_url,
          note = EXCLUDED.note,
          entity_id = EXCLUDED.entity_id,
          is_representative = EXCLUDED.is_representative,
          narrative_tags = EXCLUDED.narrative_tags,
          display_priority = EXCLUDED.display_priority,
          is_active = EXCLUDED.is_active,
          updated_at = EXCLUDED.updated_at
        RETURNING (xmax = 0) AS inserted
    """
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for index, source_row in enumerate(rows):
                row = curated_row_for_postgres(source_row, index)
                if not row["id"] or not row["address"]:
                    counts["invalid"] += 1
                    continue
                cur.execute(sql, row)
                result = cur.fetchone()
                if result and result.get("inserted"):
                    counts["inserted"] += 1
                else:
                    counts["updated"] += 1
    return counts


def fetch_curated_wallets(database_url: str, limit: int | None) -> list[dict[str, Any]]:
    limit_clause = " LIMIT %s" if limit and limit > 0 else ""
    params: tuple[Any, ...] = (limit,) if limit and limit > 0 else ()
    sql = f"""
        SELECT
          id, entity_id, address, chain, owner_label, owner_category,
          owner_subcategory, approx_balance, tier, narrative_tags, note,
          display_priority, updated_at, created_at
        FROM curated_wallets
        WHERE COALESCE(is_active, 'true') NOT IN ('false', '0', 'no')
        ORDER BY COALESCE(display_priority, 0) DESC, COALESCE(updated_at, created_at) DESC NULLS LAST, id ASC
        {limit_clause}
    """
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def upsert_profiles(
    database_url: str,
    profiles: list[WalletProfile],
    *,
    overwrite: bool,
) -> dict[str, int]:
    counts = {"inserted": 0, "updated": 0, "skipped": 0}
    conflict_guard = "" if overwrite else "WHERE wallet_detail_profiles.source IS NULL OR wallet_detail_profiles.source = '' OR wallet_detail_profiles.source = EXCLUDED.source"
    sql = f"""
        INSERT INTO wallet_detail_profiles (
          wallet_id, entity_id, address, chain, title, thesis,
          behavior_summary, watch_reason, risk_note, data_status,
          approx_balance_label, tags, source, source_ref, source_url, updated_at
        )
        VALUES (
          %(wallet_id)s, %(entity_id)s, %(address)s, %(chain)s, %(title)s, %(thesis)s,
          %(behavior_summary)s, %(watch_reason)s, %(risk_note)s, %(data_status)s,
          %(approx_balance_label)s, %(tags)s::jsonb, %(source)s, %(source_ref)s,
          %(source_url)s, now()
        )
        ON CONFLICT (wallet_id) DO UPDATE SET
          entity_id = EXCLUDED.entity_id,
          address = EXCLUDED.address,
          chain = EXCLUDED.chain,
          title = EXCLUDED.title,
          thesis = EXCLUDED.thesis,
          behavior_summary = EXCLUDED.behavior_summary,
          watch_reason = EXCLUDED.watch_reason,
          risk_note = EXCLUDED.risk_note,
          data_status = EXCLUDED.data_status,
          approx_balance_label = EXCLUDED.approx_balance_label,
          tags = EXCLUDED.tags,
          source = EXCLUDED.source,
          source_ref = EXCLUDED.source_ref,
          source_url = EXCLUDED.source_url,
          updated_at = EXCLUDED.updated_at
        {conflict_guard}
        RETURNING (xmax = 0) AS inserted
    """
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for profile in profiles:
                cur.execute(
                    sql,
                    {
                        **profile.__dict__,
                        "tags": json.dumps(profile.tags, ensure_ascii=False),
                    },
                )
                result = cur.fetchone()
                if result is None:
                    counts["skipped"] += 1
                elif result.get("inserted"):
                    counts["inserted"] += 1
                else:
                    counts["updated"] += 1
    return counts


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed wallet detail profiles from curated_wallets.")
    parser.add_argument("--database-url", default=None, help="Postgres URL. Defaults to DATABASE_URL.")
    parser.add_argument(
        "--source",
        default=str(DEFAULT_CURATED_SOURCE),
        help="Markdown source used when curated_wallets is empty.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of curated wallets to process.")
    parser.add_argument("--dry-run", action="store_true", help="Read curated wallets and print sample profiles without writing.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite manually edited wallet_detail_profiles rows.")
    parser.add_argument(
        "--refresh-curated-wallets",
        action="store_true",
        help="Upsert curated_wallets from --source even when curated_wallets already has rows.",
    )
    parser.add_argument(
        "--skip-curated-wallet-seed",
        action="store_true",
        help="Do not seed curated_wallets from --source when the table is empty.",
    )
    parser.add_argument("--skip-init-schema", action="store_true", help="Do not run idempotent schema initialization before writing.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    database_url = clean_text(args.database_url or os.getenv("DATABASE_URL"))
    if not database_url:
        raise SystemExit("DATABASE_URL must be set")

    source_path = Path(args.source).expanduser()
    rows = fetch_curated_wallets(database_url, args.limit)
    source_rows: list[dict[str, Any]] = []
    should_seed_curated = (
        args.refresh_curated_wallets or (len(rows) == 0 and not args.skip_curated_wallet_seed)
    )
    if should_seed_curated:
        if not source_path.exists():
            raise SystemExit(f"Curated wallet source not found: {source_path}")
        source_rows = load_source_wallet_rows(source_path)
        rows = source_rows[: args.limit] if args.limit and args.limit > 0 else source_rows
    profiles = [build_profile(row) for row in rows if clean_text(row.get("id")) or clean_text(row.get("address"))]

    print(f"Target: {display_database_url(database_url)}")
    print(f"Loaded curated_wallets={len(rows)} profiles={len(profiles)}")
    if should_seed_curated:
        reason = "refresh requested" if args.refresh_curated_wallets else "curated_wallets table is empty"
        print(f"{reason}; source seed rows={len(source_rows)} from {source_path}")

    if args.dry_run:
        for profile in profiles[:8]:
            print(f"- {profile.wallet_id}: {profile.title} [{', '.join(profile.tags)}]")
            print(f"  {profile.thesis[:180]}")
        if len(profiles) > 8:
            print(f"... {len(profiles) - 8} more profiles")
        if should_seed_curated:
            print(f"dry-run: {len(rows)} curated_wallets rows would be upserted before profile seed")
        print("dry-run: no rows written")
        return 0

    if not args.skip_init_schema:
        initialize_schema(database_url)

    if should_seed_curated:
        curated_counts = upsert_curated_wallet_rows(database_url, rows)
        print(
            "Upserted curated_wallets: "
            f"{curated_counts['inserted']} inserted, "
            f"{curated_counts['updated']} updated, "
            f"{curated_counts['invalid']} invalid"
        )

    counts = upsert_profiles(database_url, profiles, overwrite=args.overwrite)
    print(
        "Upserted wallet_detail_profiles: "
        f"{counts['inserted']} inserted, {counts['updated']} updated, {counts['skipped']} skipped"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
