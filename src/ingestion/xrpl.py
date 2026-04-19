"""XRPL/XRPSCAN account transaction collector for native XRP payments."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

from src.ingestion.base import ChainCollector
from src.signals.models import Event
from src.utils.errors import XrplError
from src.utils.http_backoff import get_with_backoff
from src.utils.logger import get_logger

logger = get_logger("xrpl")

_DEFAULT_API_BASE = "https://api.xrpscan.com/api/v1"
_XRP_DROPS = 1_000_000
_RIPPLE_EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)


XRPLError = XrplError


@dataclass(frozen=True)
class XRPLPage:
    rows: list[dict]
    marker: str | dict | None


def _get_with_backoff(url: str, params: dict) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, params=params, timeout=15),
        error_cls=XRPLError,
        logger=logger,
    )


def _parse_iso_datetime(value: object) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_ledger_time(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, str) and any(char in value for char in ("T", "-", ":")):
        return _parse_iso_datetime(value)

    try:
        numeric = int(str(value).strip())
    except (TypeError, ValueError):
        return None

    if numeric < 946_684_800:
        return _RIPPLE_EPOCH + timedelta(seconds=numeric)
    return datetime.fromtimestamp(numeric, tz=timezone.utc)


def _extract_tx(entry: dict) -> dict:
    tx = entry.get("tx")
    if isinstance(tx, dict):
        return tx
    return entry


def _extract_hash(entry: dict) -> str:
    tx = _extract_tx(entry)
    return str(tx.get("hash") or entry.get("hash") or "").strip()


def _extract_block_time(entry: dict) -> datetime | None:
    tx = _extract_tx(entry)
    for key in ("close_time_iso", "executed_time", "timestamp", "date"):
        parsed = _parse_ledger_time(entry.get(key))
        if parsed is not None:
            return parsed
    return _parse_ledger_time(tx.get("date"))


def _extract_delivered_drops(entry: dict) -> int | None:
    meta = entry.get("meta")
    delivered = meta.get("delivered_amount") if isinstance(meta, dict) else None
    if isinstance(delivered, str) and delivered.isdigit():
        return int(delivered)
    tx = _extract_tx(entry)
    amount = tx.get("Amount")
    if isinstance(amount, str) and amount.isdigit():
        return int(amount)
    if isinstance(amount, int):
        return amount
    return None


def _lookup_watched_row(address: str, watched_index: dict[str, dict]) -> dict | None:
    if not watched_index:
        return None
    if address in watched_index:
        return watched_index[address]
    lower = address.lower()
    return watched_index.get(lower)


def normalize_xrpl_payment(
    entry: dict,
    watched_address: str,
    watched_index: dict[str, dict] | None = None,
    price_service=None,
) -> Event | None:
    tx = _extract_tx(entry)
    if tx.get("TransactionType") != "Payment":
        return None

    if entry.get("validated") is False:
        return None
    meta = entry.get("meta")
    if isinstance(meta, dict) and meta.get("TransactionResult") not in (None, "tesSUCCESS"):
        return None

    delivered_drops = _extract_delivered_drops(entry)
    if delivered_drops is None:
        return None

    block_time = _extract_block_time(entry)
    if block_time is None:
        return None

    from_addr = str(tx.get("Account") or "").strip()
    to_addr = str(tx.get("Destination") or "").strip()
    watched = str(watched_address or "").strip()
    if not watched or (watched != from_addr and watched != to_addr):
        return None

    direction = "out" if watched == from_addr else "in"
    amount_token = delivered_drops / _XRP_DROPS

    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd("XRP")
        if price:
            amount_usd = amount_token * price

    counterparty = to_addr if direction == "out" else from_addr
    counterparty_row = _lookup_watched_row(counterparty, watched_index or {})

    return Event(
        source="chain",
        chain="XRP",
        tx_hash=_extract_hash(entry) or None,
        watched_address=watched,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token="XRP",
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_row.get("category") if counterparty_row else None,
        block_time=block_time,
        collected_at=datetime.now(timezone.utc),
    )


class XRPLCollector(ChainCollector):
    supported_chains = ("XRP",)
    chain_aliases = {
        "XRP": "XRP",
        "xrp": "XRP",
        "ripple": "XRP",
        "xrpl": "XRP",
    }

    def __init__(
        self,
        api_base: str = _DEFAULT_API_BASE,
        *,
        page_size: int = 50,
        max_pages: int = 2,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._page_size = page_size
        self._max_pages = max_pages

    def fetch(
        self,
        addresses: list[str],
        chain: str,
        since_ts: int,
        *,
        watched_index: dict | None = None,
        price_service=None,
    ) -> list[Event]:
        if self.normalize_chain(chain) != "XRP":
            raise XRPLError(f"Unknown chain: {chain!r}")

        seen_hashes: set[str] = set()
        events: list[Event] = []
        for address in addresses:
            for entry in self._fetch_transactions(address, since_ts):
                tx_hash = _extract_hash(entry)
                if tx_hash and tx_hash in seen_hashes:
                    continue
                event = normalize_xrpl_payment(
                    entry,
                    watched_address=address,
                    watched_index=watched_index,
                    price_service=price_service,
                )
                if event is None:
                    continue
                if tx_hash:
                    seen_hashes.add(tx_hash)
                events.append(event)
        return events

    def _fetch_transactions(self, address: str, since_ts: int) -> list[dict]:
        rows: list[dict] = []
        marker: str | dict | None = None

        for _ in range(self._max_pages):
            page = self._fetch_page(address, marker=marker)
            if not page.rows:
                break

            oldest_ts: int | None = None
            for entry in page.rows:
                block_time = _extract_block_time(entry)
                if block_time is None:
                    continue
                block_ts = int(block_time.timestamp())
                if oldest_ts is None or block_ts < oldest_ts:
                    oldest_ts = block_ts
                if block_ts < since_ts:
                    continue
                rows.append(entry)

            if page.marker is None:
                break
            if oldest_ts is not None and oldest_ts < since_ts:
                break
            marker = page.marker

        return rows

    def _fetch_page(self, address: str, *, marker: str | dict | None = None) -> XRPLPage:
        params: dict[str, object] = {"limit": self._page_size}
        if marker is not None:
            params["marker"] = marker

        response = _get_with_backoff(f"{self._api_base}/account/{address}/transactions", params)
        payload = response.json()
        if not isinstance(payload, dict):
            raise XRPLError(f"Unexpected response type: {type(payload)}")

        result = payload.get("result")
        container = result if isinstance(result, dict) else payload
        if not isinstance(container, dict):
            raise XRPLError(f"Unexpected container type: {type(container)}")

        rows = container.get("transactions") or container.get("data") or container.get("txs") or []
        if not isinstance(rows, list):
            raise XRPLError(f"Unexpected transactions type: {type(rows)}")

        marker_value = container.get("marker")
        return XRPLPage(rows=rows, marker=marker_value)


XrplCollector = XRPLCollector
