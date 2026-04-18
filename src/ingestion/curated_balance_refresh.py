from __future__ import annotations

from src.pipeline.common import build_sheets_client, init_run_result, load_pipeline_env
from src.storage.queries import now_iso
from src.utils.logger import get_logger

logger = get_logger("curated_balance_refresh")


def build_balance_rows(
    wallets: list[dict],
    *,
    updated_at: str | None = None,
    refreshed_at: str | None = None,
) -> list[dict]:
    timestamp = refreshed_at or updated_at or now_iso()
    rows: list[dict] = []
    for wallet in wallets:
        wallet_id = str(wallet.get("id", "")).strip()
        chain = str(wallet.get("chain", "")).strip()
        address = str(wallet.get("address", "")).strip()
        if not wallet_id or not chain or not address:
            continue
        rows.append(
            {
                "wallet_id": wallet_id,
                "chain": chain,
                "address": address,
                "owner_label": wallet.get("owner_label", ""),
                "owner_category": wallet.get("owner_category", ""),
                "approx_balance": wallet.get("approx_balance", ""),
                "source_ref": wallet.get("source_ref", ""),
                "source_url": wallet.get("source_url", ""),
                "note": wallet.get("note", ""),
                "is_active": wallet.get("is_active", "true"),
                "updated_at": timestamp,
            }
        )
    return rows


def run_curated_balance_refresh() -> dict[str, object]:
    result = init_run_result("curated_balance")
    env = load_pipeline_env()
    sheets = build_sheets_client(env)
    wallets = sheets.list_curated_wallets(active_only=True)
    rows = build_balance_rows(wallets)
    upserted = sheets.upsert_curated_wallet_balances(rows)
    result.update(
        status="completed",
        finished_at=now_iso(),
        transactions_count=0,
        errors="[]",
        details=(
            f"wallets={len(wallets)}; "
            f"inserted={upserted['inserted']}; updated={upserted['updated']}; invalid={upserted['invalid']}"
        ),
    )
    sheets.log_run(result)
    logger.info("curated balance refresh completed wallets=%d", len(wallets))
    return result


def main() -> None:
    run_curated_balance_refresh()


if __name__ == "__main__":
    main()
