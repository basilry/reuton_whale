"""Etherscan v2 multi-chain collector."""
from __future__ import annotations

import time

import requests

from src.ingestion.normalizer import normalize_chain_tx
from src.signals.models import Event
from src.utils.errors import EtherscanError
from src.utils.http_backoff import get_with_backoff
from src.utils.logger import get_logger

logger = get_logger("etherscan")

_CHAIN_IDS: dict[str, int] = {
    "ETH": 1, "ethereum": 1,
    "ARB": 42161, "arbitrum": 42161,
    "BASE": 8453, "base": 8453,
    "BSC": 56, "bsc": 56, "bnb": 56,
    "POLYGON": 137, "polygon": 137,
    "MATIC": 137,
}
_CHAIN_LABELS: dict[int, str] = {
    1: "ETH",
    42161: "ARB",
    8453: "BASE",
    56: "BSC",
    137: "POLYGON",
}
_BASE_URL = "https://api.etherscan.io/v2/api"


def _is_etherscan_rate_limited(data: dict) -> bool:
    return str(data.get("status")) == "0" and "rate limit" in data.get("message", "").lower()


def _get_with_backoff(url: str, params: dict) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, params=params, timeout=15),
        is_rate_limited=_is_etherscan_rate_limited,
        error_cls=EtherscanError,
        logger=logger,
    )


class EtherscanCollector:
    def __init__(self, api_key: str, rate_limit_per_sec: float = 3.0) -> None:
        self._api_key = api_key
        self._interval = 1.0 / rate_limit_per_sec
        self._last_call: float = 0.0

    def fetch(
        self,
        addresses: list[str],
        chain: str,
        since_ts: int,
        *,
        watched_index: dict | None = None,
        price_service=None,
    ) -> list[Event]:
        chain_id = _CHAIN_IDS.get(chain) or _CHAIN_IDS.get(chain.upper())
        if chain_id is None:
            raise EtherscanError(f"Unknown chain: {chain!r}")
        chain_label = _CHAIN_LABELS.get(chain_id, chain.upper())

        seen: set[str] = set()
        events: list[Event] = []

        for addr in addresses:
            for action in ("txlist", "tokentx"):
                try:
                    rows = self._fetch_page(addr, action, chain_id, since_ts)
                except EtherscanError as exc:
                    logger.warning("Etherscan error addr=%s action=%s: %s", addr, action, exc)
                    continue

                for row in rows:
                    tx_hash = row.get("hash", "")
                    key = f"{tx_hash}:{action}"
                    if key in seen:
                        continue
                    seen.add(key)

                    row["_chain"] = chain_label
                    row["_watched_address"] = addr
                    try:
                        evt = normalize_chain_tx(row, chain_label, watched_index or {}, price_service)
                        events.append(evt)
                    except Exception as exc:
                        logger.warning("normalize failed hash=%s: %s", tx_hash, exc)

        return events

    def _fetch_page(self, addr: str, action: str, chain_id: int, since_ts: int) -> list[dict]:
        self._rate_limit()
        params = {
            "chainid": chain_id,
            "module": "account",
            "action": action,
            "address": addr,
            "startblock": 0,
            "endblock": 99999999,
            "sort": "desc",
            "apikey": self._api_key,
        }
        resp = _get_with_backoff(_BASE_URL, params)
        data = resp.json()
        if data.get("status") == "0":
            msg = data.get("message", "")
            if "No transactions found" in msg or "No records found" in msg:
                return []
            raise EtherscanError(f"API error: {msg}")

        result = data.get("result", [])
        if not isinstance(result, list):
            raise EtherscanError(f"Unexpected result type: {type(result)}")

        return [row for row in result if int(row.get("timeStamp", 0)) >= since_ts]

    def _rate_limit(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_call
        if elapsed < self._interval:
            time.sleep(self._interval - elapsed)
        self._last_call = time.monotonic()
