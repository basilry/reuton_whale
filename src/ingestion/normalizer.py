"""Raw tx dict → Event normalizer supporting Etherscan, Solscan, and XRPL shapes."""
from __future__ import annotations

from datetime import datetime, timezone

from src.signals.models import Event


_LOWERCASE_ADDRESS_CHAINS = {"ETH", "ARB", "BASE", "BSC", "POLYGON"}


def _normalize_address(value: object, chain_label: str) -> str:
    text = str(value or "").strip()
    if chain_label.upper() in _LOWERCASE_ADDRESS_CHAINS:
        return text.lower()
    return text


def _lookup_watched_row(watched_index: dict, address: str, chain_label: str) -> dict:
    if not address:
        return {}
    if address in watched_index:
        return watched_index[address]
    if chain_label.upper() in _LOWERCASE_ADDRESS_CHAINS:
        return watched_index.get(address.lower(), {})
    return watched_index.get(address.lower(), {}) or watched_index.get(address.upper(), {}) or {}


def _parse_iso_datetime(value: object) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


def _normalize_xrp_tx(raw: dict, watched_index: dict, price_service) -> Event:
    from src.ingestion.xrpl import normalize_xrpl_payment

    entry = raw
    if "tx" not in raw:
        entry = {
            "close_time_iso": raw.get("close_time_iso") or raw.get("date") or raw.get("executed_time"),
            "hash": raw.get("hash") or raw.get("tx_hash"),
            "validated": raw.get("validated", True),
            "tx": {
                "hash": raw.get("hash") or raw.get("tx_hash"),
                "TransactionType": raw.get("TransactionType") or raw.get("tx_type") or "Payment",
                "Account": raw.get("Account") or raw.get("from"),
                "Destination": raw.get("Destination") or raw.get("to"),
                "Amount": raw.get("Amount") if "Amount" in raw else raw.get("amount"),
            },
            "meta": {
                "TransactionResult": raw.get("TransactionResult") or raw.get("transaction_result") or "tesSUCCESS",
                "delivered_amount": raw.get("delivered_amount")
                if "delivered_amount" in raw
                else raw.get("Amount")
                if "Amount" in raw
                else raw.get("amount"),
            },
        }

    event = normalize_xrpl_payment(
        entry,
        watched_address=raw.get("_watched_address") or "",
        watched_index=watched_index,
        price_service=price_service,
    )
    if event is None:
        amount = raw.get("Amount")
        if isinstance(amount, dict):
            currency = str(amount.get("currency") or "").strip().upper()
            if currency and currency != "XRP":
                raise ValueError(f"Unsupported XRP IOU currency: {currency}")
        raise ValueError("Unsupported XRP transaction")
    return event


def normalize_chain_tx(raw: dict, chain: str, watched_index: dict, price_service) -> Event:
    """Convert a raw API row to an Event.

    Etherscan keys: timeStamp, hash, from, to, value, tokenSymbol, tokenDecimal
    Solscan keys:   blockTime, txHash/signature, src/from, dst/to, lamport/amount, tokenSymbol, decimals
    Both shapes carry _chain and _watched_address injected by the collector.
    """
    ts = int(raw.get("timeStamp") or raw.get("blockTime") or 0)
    block_time = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else datetime.now(timezone.utc)

    chain_label: str = raw.get("_chain") or chain

    if chain_label == "XRP":
        return _normalize_xrp_tx(raw, watched_index, price_service)

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

    from_addr = _normalize_address(raw.get("from") or raw.get("src"), chain_label)
    to_addr = _normalize_address(raw.get("to") or raw.get("dst"), chain_label)

    watched_address = _normalize_address(raw.get("_watched_address"), chain_label)
    direction = "out" if watched_address and watched_address == from_addr else "in"

    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd(token)
        if price:
            amount_usd = amount_token * price

    counterparty_addr = to_addr if direction == "out" else from_addr
    cp_row = _lookup_watched_row(watched_index, counterparty_addr, chain_label)
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
