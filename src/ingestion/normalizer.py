"""Raw tx dict → Event normalizer supporting Etherscan v2 and Solscan v2 shapes."""
from __future__ import annotations

from datetime import datetime, timezone

from src.signals.models import Event


def normalize_chain_tx(raw: dict, chain: str, watched_index: dict, price_service) -> Event:
    """Convert a raw API row to an Event.

    Etherscan keys: timeStamp, hash, from, to, value, tokenSymbol, tokenDecimal
    Solscan keys:   blockTime, txHash/signature, src/from, dst/to, lamport/amount, tokenSymbol, decimals
    Both shapes carry _chain and _watched_address injected by the collector.
    """
    ts = int(raw.get("timeStamp") or raw.get("blockTime") or 0)
    block_time = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else datetime.now(timezone.utc)

    chain_label: str = raw.get("_chain") or chain

    if raw.get("tokenSymbol"):
        token = raw["tokenSymbol"].upper()
        decimals = int(raw.get("tokenDecimal") or raw.get("decimals") or 18)
        raw_value = float(raw.get("value") or raw.get("amount") or 0)
        amount_token = raw_value / (10 ** decimals)
    elif chain_label == "SOL":
        token = "SOL"
        lamports = float(raw.get("lamport") or raw.get("amount") or 0)
        amount_token = lamports / 1e9
    else:
        token = chain_label
        amount_token = float(raw.get("value") or 0) / 1e18

    from_addr = (raw.get("from") or raw.get("src") or "").lower()
    to_addr = (raw.get("to") or raw.get("dst") or "").lower()

    watched_address = (raw.get("_watched_address") or "").lower()
    direction = "out" if watched_address and watched_address == from_addr else "in"

    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd(token)
        if price:
            amount_usd = amount_token * price

    counterparty_addr = to_addr if direction == "out" else from_addr
    cp_row = watched_index.get(counterparty_addr, {})
    counterparty_category: str | None = cp_row.get("category") if cp_row else None

    return Event(
        source="chain",
        chain=chain_label,
        tx_hash=raw.get("hash") or raw.get("txHash") or raw.get("signature"),
        watched_address=watched_address or None,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token=token,
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_category,
        block_time=block_time,
        collected_at=datetime.now(timezone.utc),
    )
