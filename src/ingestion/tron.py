"""TronGrid collector for native TRX and TRC20 transfers."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib

import requests

from src.ingestion.base import ChainCollector
from src.signals.models import Event
from src.utils.errors import TronError
from src.utils.http_backoff import get_with_backoff
from src.utils.logger import get_logger

logger = get_logger("tron")

_BASE_URL = "https://api.trongrid.io"
_PAGE_SIZE = 200
_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _get_with_backoff(url: str, params: dict, headers: dict | None = None) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, params=params, headers=headers, timeout=15),
        error_cls=TronError,
        logger=logger,
    )


def _base58_encode(payload: bytes) -> str:
    value = int.from_bytes(payload, "big")
    encoded = ""
    while value > 0:
        value, remainder = divmod(value, 58)
        encoded = _BASE58_ALPHABET[remainder] + encoded
    leading_zeroes = len(payload) - len(payload.lstrip(b"\x00"))
    return ("1" * leading_zeroes) + (encoded or "1")


def _tron_hex_to_base58(value: str) -> str:
    raw = value.strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    if len(raw) != 42 or not raw.startswith("41"):
        return value.strip()
    payload = bytes.fromhex(raw)
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    return _base58_encode(payload + checksum)


def _normalize_tron_address(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("T"):
        return raw
    lowered = raw.lower()
    if lowered.startswith("41") or lowered.startswith("0x41"):
        return _tron_hex_to_base58(raw)
    return raw


def _lookup_watched_row(address: str, watched_index: dict[str, dict]) -> dict | None:
    if not address:
        return None
    return watched_index.get(address) or watched_index.get(address.lower()) or watched_index.get(address.upper())


def _parse_ms_datetime(value: object) -> datetime:
    try:
        numeric = int(str(value or "0").strip() or "0")
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)
    if numeric <= 0:
        return datetime.now(timezone.utc)
    if numeric > 10_000_000_000:
        numeric //= 1000
    return datetime.fromtimestamp(numeric, tz=timezone.utc)


def _parse_amount(value: object, decimals: int) -> float:
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    try:
        if "." in raw:
            return float(raw)
        return int(raw) / (10 ** decimals)
    except (TypeError, ValueError):
        return 0.0


def normalize_tron_transaction(
    row: dict,
    *,
    watched_address: str,
    watched_index: dict[str, dict] | None = None,
    price_service=None,
) -> Event | None:
    watched_index = watched_index or {}
    watched = _normalize_tron_address(watched_address)
    is_trc20 = bool(row.get("_is_trc20"))

    if is_trc20:
        token_info = row.get("token_info") if isinstance(row.get("token_info"), dict) else {}
        token = str(
            token_info.get("symbol") or row.get("tokenSymbol") or row.get("symbol") or "TRC20"
        ).strip().upper()
        decimals = int(str(token_info.get("decimals") or row.get("decimals") or 6).strip() or "6")
        from_addr = _normalize_tron_address(row.get("from"))
        to_addr = _normalize_tron_address(row.get("to"))
        amount_token = _parse_amount(row.get("value") or row.get("quant"), decimals)
        block_time = _parse_ms_datetime(
            row.get("block_timestamp") or row.get("blockTime") or row.get("transaction_timestamp")
        )
        tx_hash = str(row.get("transaction_id") or row.get("hash") or row.get("txID") or "").strip() or None
    else:
        raw_data = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
        contract = {}
        contracts = raw_data.get("contract")
        if isinstance(contracts, list) and contracts:
            first = contracts[0]
            if isinstance(first, dict):
                parameter = first.get("parameter") if isinstance(first.get("parameter"), dict) else {}
                contract = parameter.get("value") if isinstance(parameter.get("value"), dict) else {}

        from_addr = _normalize_tron_address(
            row.get("owner_address") or row.get("from") or contract.get("owner_address")
        )
        to_addr = _normalize_tron_address(
            row.get("to_address") or row.get("to") or contract.get("to_address")
        )
        token = "TRX"
        amount_token = _parse_amount(
            row.get("amount") or row.get("value") or contract.get("amount"),
            6,
        )
        block_time = _parse_ms_datetime(row.get("block_timestamp") or raw_data.get("timestamp"))
        tx_hash = str(row.get("txID") or row.get("transaction_id") or row.get("hash") or "").strip() or None

    if not watched or watched not in {from_addr, to_addr}:
        return None

    direction = "out" if watched == from_addr else "in"
    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd(token)
        if price:
            amount_usd = amount_token * price

    counterparty = to_addr if direction == "out" else from_addr
    counterparty_row = _lookup_watched_row(counterparty, watched_index)

    return Event(
        source="chain",
        chain="TRX",
        tx_hash=tx_hash,
        watched_address=watched,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token=token,
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_row.get("category") if counterparty_row else None,
        block_time=block_time,
        collected_at=datetime.now(timezone.utc),
    )


class TronCollector(ChainCollector):
    supported_chains = ("TRX",)
    chain_aliases = {
        "TRX": "TRX",
        "trx": "TRX",
        "tron": "TRX",
    }

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = _BASE_URL,
        page_size: int = _PAGE_SIZE,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._page_size = page_size
        self._headers = {"TRON-PRO-API-KEY": api_key} if api_key else {}

    def fetch(
        self,
        addresses: list[str],
        chain: str,
        since_ts: int,
        *,
        watched_index: dict | None = None,
        price_service=None,
    ) -> list[Event]:
        if self.normalize_chain(chain) != "TRX":
            raise TronError(f"Unknown chain: {chain!r}")

        events: list[Event] = []
        seen: set[str] = set()
        since_ms = since_ts * 1000
        for address in addresses:
            for path, is_trc20 in (("transactions", False), ("transactions/trc20", True)):
                rows = self._fetch_endpoint(address, path, since_ms)
                for row in rows:
                    tx_id = str(
                        row.get("transaction_id") or row.get("txID") or row.get("hash") or ""
                    ).strip()
                    dedup_key = f"{path}:{tx_id}"
                    if dedup_key in seen:
                        continue
                    row["_chain"] = "TRX"
                    row["_watched_address"] = address
                    row["_is_trc20"] = is_trc20
                    try:
                        event = normalize_tron_transaction(
                            row,
                            watched_address=address,
                            watched_index=watched_index or {},
                            price_service=price_service,
                        )
                    except Exception as exc:
                        logger.warning("TRX normalize failed tx=%s: %s", tx_id or "unknown", exc)
                        continue
                    if event is None:
                        continue
                    seen.add(dedup_key)
                    events.append(event)
        return events

    def _fetch_endpoint(self, address: str, path: str, since_ms: int) -> list[dict]:
        response = _get_with_backoff(
            f"{self._base}/v1/accounts/{address}/{path}",
            params={
                "limit": self._page_size,
                "min_timestamp": since_ms,
                "only_confirmed": "true",
                "order_by": "block_timestamp,desc",
            },
            headers=self._headers or None,
        )
        payload = response.json() or {}
        if not isinstance(payload, dict):
            raise TronError("Unexpected TronGrid response type")
        rows = payload.get("data") or []
        if not isinstance(rows, list):
            raise TronError("Unexpected TronGrid payload shape")

        filtered: list[dict] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_ts = row.get("block_timestamp")
            if raw_ts is None and isinstance(row.get("raw_data"), dict):
                raw_ts = row["raw_data"].get("timestamp")
            try:
                block_ms = int(str(raw_ts or "0").strip() or "0")
            except (TypeError, ValueError):
                block_ms = 0
            if block_ms and block_ms < since_ms:
                continue
            filtered.append(row)
        return filtered
