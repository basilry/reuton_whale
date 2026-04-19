"""Dogecoin UTXO collector using Blockchair-style address dashboard payloads."""
from __future__ import annotations

from datetime import datetime, timezone

import requests

from src.ingestion.base import ChainCollector
from src.signals.models import Event
from src.utils.errors import DogecoinError
from src.utils.http_backoff import get_with_backoff
from src.utils.logger import get_logger

logger = get_logger("dogecoin")

_BASE_URL = "https://api.blockchair.com/dogecoin"
_SATOSHIS_PER_DOGE = 100_000_000
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

def _get_with_backoff(url: str, params: dict) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, params=params, timeout=15),
        error_cls=DogecoinError,
        logger=logger,
    )


def _normalize_address(value: object) -> str:
    return str(value or "").strip()


def _parse_block_time(value: object) -> datetime | None:
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


def _extract_amount_doge(row: dict) -> float:
    for key in ("value_doge", "amount_doge"):
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
            return int(raw) / _SATOSHIS_PER_DOGE
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _lookup_watched_row(address: str, watched_index: dict[str, dict]) -> dict | None:
    if not address:
        return None
    return watched_index.get(address) or watched_index.get(address.lower()) or watched_index.get(address.upper())


def _select_counterparty(addresses: list[str], watched: str) -> str:
    for address in addresses:
        if address != watched:
            return address
    return addresses[0] if addresses else ""


def _extract_tx_hash(row: dict) -> str:
    return str(
        row.get("transaction_hash")
        or row.get("hash")
        or row.get("txid")
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
        parsed = _parse_block_time(row.get(key))
        if parsed is not None:
            return parsed
    return None


def normalize_dogecoin_utxo(
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

    amount_token = _extract_amount_doge(row)
    amount_usd = 0.0
    if price_service and amount_token:
        price = price_service.get_usd("DOGE")
        if price:
            amount_usd = amount_token * price

    counterparty_row = _lookup_watched_row(counterparty, watched_index)
    block_time = _extract_row_time(row) or datetime.now(timezone.utc)

    return Event(
        source="chain",
        chain="DOGE",
        tx_hash=_extract_tx_hash(row) or None,
        watched_address=watched,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token="DOGE",
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_row.get("category") if counterparty_row else None,
        block_time=block_time,
        collected_at=datetime.now(timezone.utc),
    )


class DogecoinCollector(ChainCollector):
    supported_chains = ("DOGE",)
    is_partial_view = True
    chain_aliases = {
        "DOGE": "DOGE",
        "doge": "DOGE",
        "dogecoin": "DOGE",
    }

    def __init__(
        self,
        *,
        base_url: str = _BASE_URL,
        api_key: str | None = None,
        limit: int = 100,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self._limit = limit

    def fetch(
        self,
        addresses: list[str],
        chain: str,
        since_ts: int,
        *,
        watched_index: dict | None = None,
        price_service=None,
    ) -> list[Event]:
        if self.normalize_chain(chain) != "DOGE":
            raise DogecoinError(f"Unknown chain: {chain!r}")

        watched_index = watched_index or {}
        seen: set[str] = set()
        events: list[Event] = []

        for address in addresses:
            try:
                dashboard = self._fetch_dashboard(address)
            except DogecoinError as exc:
                logger.warning("Dogecoin dashboard fetch failed addr=%s: %s", address, exc)
                continue

            tx_lookup = self._transaction_lookup(dashboard)
            for row in self._utxo_rows(dashboard):
                merged = self._merge_transaction_context(row, tx_lookup)
                row_time = _extract_row_time(merged)
                if row_time is not None and int(row_time.timestamp()) < since_ts:
                    continue

                tx_hash = _extract_tx_hash(merged)
                outpoint_key = _extract_outpoint_index(merged)
                dedup_key = f"{tx_hash}:{outpoint_key}" if tx_hash else outpoint_key
                if dedup_key and dedup_key in seen:
                    continue

                try:
                    event = normalize_dogecoin_utxo(
                        merged,
                        watched_address=address,
                        watched_index=watched_index,
                        price_service=price_service,
                    )
                except Exception as exc:
                    logger.warning("DOGE normalize failed tx=%s: %s", tx_hash or "unknown", exc)
                    continue
                if event is None:
                    continue

                if dedup_key:
                    seen.add(dedup_key)
                events.append(event)

        return events

    def _fetch_dashboard(self, address: str) -> dict:
        params = {"limit": self._limit}
        if self._api_key:
            params["key"] = self._api_key
        response = _get_with_backoff(
            f"{self._base}/dashboards/address/{address}",
            params=params,
        )
        payload = response.json()
        if not isinstance(payload, dict):
            raise DogecoinError(f"Unexpected response type: {type(payload)}")
        return self._extract_dashboard_container(payload, address)

    @staticmethod
    def _extract_dashboard_container(payload: dict, address: str) -> dict:
        if any(key in payload for key in ("utxo", "utxos", "transactions")):
            return payload

        data = payload.get("data")
        if not isinstance(data, dict):
            raise DogecoinError("Unexpected dashboard payload shape")

        if any(key in data for key in ("utxo", "utxos", "transactions")):
            return data

        if address in data and isinstance(data[address], dict):
            return data[address]

        if len(data) == 1:
            only_value = next(iter(data.values()))
            if isinstance(only_value, dict):
                return only_value

        raise DogecoinError(f"Address dashboard missing for {address}")

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
            raise DogecoinError(f"Unexpected utxo container type: {type(rows)}")
        return [row for row in rows if isinstance(row, dict)]

    @staticmethod
    def _merge_transaction_context(row: dict, tx_lookup: dict[str, dict]) -> dict:
        merged = dict(tx_lookup.get(_extract_tx_hash(row), {}))
        merged.update(row)
        return merged
