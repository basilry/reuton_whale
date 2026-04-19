"""Bitcoin collector with mempool.space primary and Blockchair fallback."""
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
_DEFAULT_FALLBACK_API_BASE = "https://api.blockchair.com/bitcoin"
_SATOSHIS_PER_BTC = 100_000_000
_ADDRESS_FIELD_NAMES = (
    "address",
    "recipient",
    "sender",
    "from",
    "to",
    "output_address",
    "input_address",
    "receiving_address",
    "spending_address",
)


def _get_with_backoff(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, object] | None = None,
) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, headers=headers, params=params, timeout=15),
        error_cls=BitcoinError,
        logger=logger,
    )


def _parse_sats(value: object) -> int:
    try:
        return int(str(value or "0").strip() or "0")
    except (TypeError, ValueError):
        return 0


def _normalize_address(value: object) -> str:
    return str(value or "").strip()


def _parse_block_time_value(value: object) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    try:
        numeric = int(float(raw))
    except (TypeError, ValueError):
        numeric = None

    if numeric is not None:
        if numeric <= 0:
            return None
        if numeric > 10_000_000_000:
            numeric //= 1000
        return datetime.fromtimestamp(numeric, tz=timezone.utc)

    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                parsed = datetime.strptime(raw, fmt)
                break
            except ValueError:
                continue
        else:
            return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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
        return _extract_row_time(row) or datetime.now(timezone.utc)
    block_time = _parse_sats(status.get("block_time"))
    if block_time <= 0:
        return _extract_row_time(row) or datetime.now(timezone.utc)
    return datetime.fromtimestamp(block_time, tz=timezone.utc)


def _extract_block_timestamp(row: dict) -> int:
    status = row.get("status")
    if not isinstance(status, dict):
        parsed = _extract_row_time(row)
        return int(parsed.timestamp()) if parsed is not None else 0
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


def _coerce_addresses(value: object) -> list[str]:
    addresses: list[str] = []

    if isinstance(value, list):
        for item in value:
            addresses.extend(_coerce_addresses(item))
    elif isinstance(value, dict):
        for field in _ADDRESS_FIELD_NAMES:
            if field in value:
                addresses.extend(_coerce_addresses(value.get(field)))
        for field in ("addresses", "recipients", "senders"):
            if field in value:
                addresses.extend(_coerce_addresses(value.get(field)))
    else:
        address = _normalize_address(value)
        if address:
            addresses.append(address)

    deduped: list[str] = []
    seen: set[str] = set()
    for address in addresses:
        if address in seen:
            continue
        seen.add(address)
        deduped.append(address)
    return deduped


def _sender_candidates(row: dict) -> list[str]:
    senders: list[str] = []
    for key in ("sender", "from", "spending_address", "input_address", "inputs", "vin"):
        if key in row:
            senders.extend(_coerce_addresses(row.get(key)))
    return senders


def _recipient_candidates(row: dict) -> list[str]:
    recipients: list[str] = []
    for key in ("recipient", "to", "address", "output_address", "receiving_address", "outputs", "vout"):
        if key in row:
            recipients.extend(_coerce_addresses(row.get(key)))
    return recipients


def _extract_amount_btc(row: dict) -> float:
    for key in ("value_btc", "amount_btc"):
        raw = str(row.get(key) or "").strip()
        if raw:
            try:
                return float(raw)
            except (TypeError, ValueError):
                return 0.0

    for key in ("value", "amount", "satoshis"):
        raw = str(row.get(key) or "").strip()
        if not raw:
            continue
        try:
            if "." in raw:
                return float(raw)
            return int(raw) / _SATOSHIS_PER_BTC
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _extract_tx_hash(row: dict) -> str:
    return str(
        row.get("txid")
        or row.get("hash")
        or row.get("transaction_hash")
        or row.get("transaction_id")
        or ""
    ).strip()


def _extract_outpoint_index(row: dict) -> str:
    for key in ("index", "output_index", "vout", "n"):
        value = row.get(key)
        if value is None or value == "":
            continue
        return str(value).strip()
    return ""


def _extract_row_time(row: dict) -> datetime | None:
    for key in ("time", "block_time", "blockTime", "transaction_time", "created"):
        parsed = _parse_block_time_value(row.get(key))
        if parsed is not None:
            return parsed
    return None


def _select_counterparty(addresses: list[str], watched: str) -> str:
    for address in addresses:
        if address != watched:
            return address
    return addresses[0] if addresses else ""


def normalize_blockchair_bitcoin_utxo(
    row: dict,
    *,
    watched_address: str,
    watched_index: dict[str, dict] | None = None,
    price_service=None,
) -> Event | None:
    watched_index = watched_index or {}
    watched = _normalize_address(watched_address)
    if not watched:
        return None

    senders = _sender_candidates(row)
    recipients = _recipient_candidates(row)

    explicit_direction = str(row.get("direction") or "").strip().lower()
    if explicit_direction in {"in", "out"}:
        direction = explicit_direction
    elif watched in senders:
        direction = "out"
    elif watched in recipients:
        direction = "in"
    else:
        return None

    if direction == "out":
        from_addr = watched
        to_addr = _select_counterparty(recipients, watched)
        counterparty = to_addr
    else:
        from_addr = _select_counterparty(senders, watched)
        to_addr = watched if watched in recipients or not recipients else recipients[0]
        counterparty = from_addr

    amount_token = _extract_amount_btc(row)
    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd("BTC")
        if price:
            amount_usd = amount_token * price

    counterparty_row = _lookup_watched_row(counterparty, watched_index)
    block_time = _extract_row_time(row) or datetime.now(timezone.utc)

    return Event(
        source="chain",
        chain="BTC",
        tx_hash=_extract_tx_hash(row) or None,
        watched_address=watched,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token="BTC",
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_row.get("category") if counterparty_row else None,
        block_time=block_time,
        collected_at=datetime.now(timezone.utc),
    )


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
        return normalize_blockchair_bitcoin_utxo(
            row,
            watched_address=watched,
            watched_index=watched_index or {},
            price_service=price_service,
        )

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
        fallback_api_base: str = _DEFAULT_FALLBACK_API_BASE,
        fallback_api_key: str | None = None,
        page_size: int = 25,
        max_pages: int = 2,
        fallback_limit: int = 100,
    ) -> None:
        self._api_base = api_base.rstrip("/")
        self._headers = {"X-API-Key": api_key} if api_key else {}
        self._fallback_api_base = fallback_api_base.rstrip("/")
        self._fallback_api_key = fallback_api_key
        self._page_size = page_size
        self._max_pages = max_pages
        self._fallback_limit = fallback_limit

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
            for row in self._fetch_transactions_with_fallback(address, since_ts):
                txid = _extract_tx_hash(row)
                outpoint = _extract_outpoint_index(row)
                dedup_key = f"{address}:{txid}:{outpoint}" if outpoint else f"{address}:{txid}"
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

    def _fetch_transactions_with_fallback(self, address: str, since_ts: int) -> list[dict]:
        try:
            return self._fetch_transactions(address, since_ts)
        except BitcoinError as exc:
            logger.warning(
                "Bitcoin mempool fetch failed addr=%s: %s; trying Blockchair fallback",
                address,
                exc,
            )

        try:
            return self._fetch_blockchair_transactions(address, since_ts)
        except BitcoinError as exc:
            logger.warning("Bitcoin Blockchair fallback failed addr=%s: %s", address, exc)
            return []

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

    def _fetch_blockchair_transactions(self, address: str, since_ts: int) -> list[dict]:
        dashboard = self._fetch_blockchair_dashboard(address)
        tx_lookup = self._transaction_lookup(dashboard)
        rows: list[dict] = []

        for row in self._utxo_rows(dashboard):
            merged = self._merge_transaction_context(row, tx_lookup)
            row_time = _extract_row_time(merged)
            if row_time is not None and int(row_time.timestamp()) < since_ts:
                continue
            rows.append(merged)

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

    def _fetch_blockchair_dashboard(self, address: str) -> dict:
        params = {"limit": self._fallback_limit}
        if self._fallback_api_key:
            params["key"] = self._fallback_api_key
        response = _get_with_backoff(
            f"{self._fallback_api_base}/dashboards/address/{address}",
            params=params,
        )
        payload = response.json()
        if not isinstance(payload, dict):
            raise BitcoinError(f"Unexpected fallback response type: {type(payload)}")
        return self._extract_dashboard_container(payload, address)

    @staticmethod
    def _extract_dashboard_container(payload: dict, address: str) -> dict:
        if any(key in payload for key in ("utxo", "utxos", "transactions")):
            return payload

        data = payload.get("data")
        if not isinstance(data, dict):
            raise BitcoinError("Unexpected Blockchair dashboard payload shape")

        if any(key in data for key in ("utxo", "utxos", "transactions")):
            return data

        if address in data and isinstance(data[address], dict):
            return data[address]

        if len(data) == 1:
            only_value = next(iter(data.values()))
            if isinstance(only_value, dict):
                return only_value

        raise BitcoinError(f"Address dashboard missing for {address}")

    @staticmethod
    def _transaction_lookup(dashboard: dict) -> dict[str, dict]:
        lookup: dict[str, dict] = {}
        transactions = dashboard.get("transactions")

        if isinstance(transactions, list):
            for entry in transactions:
                if not isinstance(entry, dict):
                    continue
                tx_hash = _extract_tx_hash(entry)
                if tx_hash:
                    lookup[tx_hash] = entry
        elif isinstance(transactions, dict):
            for key, entry in transactions.items():
                if not isinstance(entry, dict):
                    continue
                tx_hash = _extract_tx_hash(entry) or str(key).strip()
                if tx_hash:
                    lookup[tx_hash] = entry

        return lookup

    @staticmethod
    def _utxo_rows(dashboard: dict) -> list[dict]:
        rows = dashboard.get("utxo") or dashboard.get("utxos") or []
        if not isinstance(rows, list):
            raise BitcoinError(f"Unexpected fallback utxo container type: {type(rows)}")
        return [row for row in rows if isinstance(row, dict)]

    @staticmethod
    def _merge_transaction_context(row: dict, tx_lookup: dict[str, dict]) -> dict:
        merged = dict(tx_lookup.get(_extract_tx_hash(row), {}))
        merged.update(row)
        return merged
