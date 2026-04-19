"""mempool.space BTC collector with UTXO-aware normalization."""
from __future__ import annotations

from datetime import datetime, timezone

import requests

from src.ingestion.base import ChainCollector
from src.signals.models import Event
from src.utils.errors import BitcoinError
from src.utils.http_backoff import get_with_backoff
from src.utils.logger import get_logger

logger = get_logger("bitcoin")

_DEFAULT_API_BASE = "https://mempool.space/api"
_SATOSHIS_PER_BTC = 100_000_000


def _get_with_backoff(url: str, headers: dict[str, str] | None = None) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, headers=headers, timeout=15),
        error_cls=BitcoinError,
        logger=logger,
    )


def _parse_sats(value: object) -> int:
    try:
        return int(str(value or "0").strip() or "0")
    except (TypeError, ValueError):
        return 0


def _extract_prevout(vin: dict) -> dict:
    prevout = vin.get("prevout")
    return prevout if isinstance(prevout, dict) else {}


def _extract_input_address(vin: dict) -> str:
    return str(_extract_prevout(vin).get("scriptpubkey_address") or "").strip()


def _extract_output_address(vout: dict) -> str:
    return str(vout.get("scriptpubkey_address") or "").strip()


def _extract_input_value(vin: dict) -> int:
    return _parse_sats(_extract_prevout(vin).get("value"))


def _extract_output_value(vout: dict) -> int:
    return _parse_sats(vout.get("value"))


def _extract_block_time(row: dict) -> datetime:
    status = row.get("status")
    if not isinstance(status, dict):
        return datetime.now(timezone.utc)
    block_time = _parse_sats(status.get("block_time"))
    if block_time <= 0:
        return datetime.now(timezone.utc)
    return datetime.fromtimestamp(block_time, tz=timezone.utc)


def _extract_block_timestamp(row: dict) -> int:
    status = row.get("status")
    if not isinstance(status, dict):
        return 0
    if status.get("confirmed") is False:
        return 0
    return _parse_sats(status.get("block_time"))


def _lookup_watched_row(address: str, watched_index: dict[str, dict]) -> dict | None:
    if not address:
        return None
    return (
        watched_index.get(address)
        or watched_index.get(address.lower())
        or watched_index.get(address.upper())
    )


def _sum_inputs_for_address(vins: list[dict], address: str) -> int:
    return sum(_extract_input_value(vin) for vin in vins if _extract_input_address(vin) == address)


def _sum_outputs_for_address(vouts: list[dict], address: str) -> int:
    return sum(_extract_output_value(vout) for vout in vouts if _extract_output_address(vout) == address)


def _sum_external_outputs(vouts: list[dict], address: str) -> int:
    return sum(_extract_output_value(vout) for vout in vouts if _extract_output_address(vout) != address)


def _first_external_input(vins: list[dict], address: str) -> str:
    for vin in vins:
        candidate = _extract_input_address(vin)
        if candidate and candidate != address:
            return candidate
    return ""


def _first_external_output(vouts: list[dict], address: str) -> str:
    for vout in vouts:
        candidate = _extract_output_address(vout)
        if candidate and candidate != address:
            return candidate
    return ""


def normalize_bitcoin_transaction(
    row: dict,
    *,
    watched_address: str,
    watched_index: dict[str, dict] | None = None,
    price_service=None,
) -> Event | None:
    """Normalize a mempool.space transaction for one watched BTC address.

    This uses a simple UTXO rule:
    - if the watched address appears in an input, treat the transaction as an outflow
      and exclude outputs that return to the same watched address as change.
    - otherwise, if the watched address appears in an output, treat it as an inflow.
    """

    watched = str(watched_address or "").strip()
    if not watched:
        return None

    vins = row.get("vin")
    vouts = row.get("vout")
    if not isinstance(vins, list) or not isinstance(vouts, list):
        return None

    watched_input_sats = _sum_inputs_for_address(vins, watched)
    watched_output_sats = _sum_outputs_for_address(vouts, watched)
    if watched_input_sats <= 0 and watched_output_sats <= 0:
        return None

    if watched_input_sats > 0:
        counterparty = _first_external_output(vouts, watched)
        amount_sats = _sum_external_outputs(vouts, watched)
        if amount_sats <= 0:
            return None
        direction = "out"
        from_addr = watched
        to_addr = counterparty
    else:
        counterparty = _first_external_input(vins, watched)
        amount_sats = watched_output_sats
        if amount_sats <= 0:
            return None
        direction = "in"
        from_addr = counterparty
        to_addr = watched

    amount_token = amount_sats / _SATOSHIS_PER_BTC
    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd("BTC")
        if price:
            amount_usd = amount_token * price

    counterparty_row = _lookup_watched_row(counterparty, watched_index or {})

    return Event(
        source="chain",
        chain="BTC",
        tx_hash=str(row.get("txid") or "").strip() or None,
        watched_address=watched,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token="BTC",
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_row.get("category") if counterparty_row else None,
        block_time=_extract_block_time(row),
        collected_at=datetime.now(timezone.utc),
    )


class BitcoinCollector(ChainCollector):
    supported_chains = ("BTC",)
    is_partial_view = True
    chain_aliases = {
        "BTC": "BTC",
        "btc": "BTC",
        "bitcoin": "BTC",
    }

    def __init__(
        self,
        *,
        api_base: str = _DEFAULT_API_BASE,
        api_key: str | None = None,
        page_size: int = 25,
        max_pages: int = 2,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._headers = {"X-API-Key": api_key} if api_key else {}
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
        if self.normalize_chain(chain) != "BTC":
            raise BitcoinError(f"Unknown chain: {chain!r}")

        events: list[Event] = []
        seen: set[str] = set()
        for address in addresses:
            for row in self._fetch_transactions(address, since_ts):
                txid = str(row.get("txid") or "").strip()
                dedup_key = f"{address}:{txid}"
                if dedup_key in seen:
                    continue
                event = normalize_bitcoin_transaction(
                    row,
                    watched_address=address,
                    watched_index=watched_index or {},
                    price_service=price_service,
                )
                if event is None:
                    continue
                seen.add(dedup_key)
                events.append(event)
        return events

    def _fetch_transactions(self, address: str, since_ts: int) -> list[dict]:
        rows: list[dict] = []
        last_seen_txid: str | None = None

        for _ in range(self._max_pages):
            page = self._fetch_page(address, last_seen_txid=last_seen_txid)
            if not page:
                break

            oldest_ts: int | None = None
            for row in page:
                if not isinstance(row, dict):
                    continue
                block_ts = _extract_block_timestamp(row)
                if block_ts <= 0:
                    continue
                if oldest_ts is None or block_ts < oldest_ts:
                    oldest_ts = block_ts
                if block_ts < since_ts:
                    continue
                rows.append(row)

            if len(page) < self._page_size:
                break

            last_seen_txid = str(page[-1].get("txid") or "").strip()
            if not last_seen_txid:
                break
            if oldest_ts is not None and oldest_ts < since_ts:
                break

        return rows

    def _fetch_page(self, address: str, *, last_seen_txid: str | None = None) -> list[dict]:
        if last_seen_txid:
            url = f"{self._api_base}/address/{address}/txs/chain/{last_seen_txid}"
        else:
            url = f"{self._api_base}/address/{address}/txs"

        response = _get_with_backoff(url, headers=self._headers or None)
        payload = response.json()
        if not isinstance(payload, list):
            raise BitcoinError(f"Unexpected response type: {type(payload)}")
        return payload
