"""Etherscan v2 multi-chain collector."""
from __future__ import annotations

import time

import requests

from src.ingestion.base import ChainCollector
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


class EtherscanCollector(ChainCollector):
    supported_chains = ("ETH", "ARB", "BASE", "BSC", "POLYGON")
    chain_aliases = {
        "ETH": "ETH",
        "eth": "ETH",
        "ethereum": "ETH",
        "ARB": "ARB",
        "arb": "ARB",
        "arbitrum": "ARB",
        "BASE": "BASE",
        "base": "BASE",
        "BSC": "BSC",
        "bsc": "BSC",
        "bnb": "BSC",
        "POLYGON": "POLYGON",
        "polygon": "POLYGON",
        "MATIC": "POLYGON",
        "matic": "POLYGON",
    }
    expanded_aliases = {
        "": supported_chains,
        "EVM": supported_chains,
        "evm": supported_chains,
    }

    def __init__(
        self,
        api_key: str,
        rate_limit_per_sec: float = 3.0,
        page_size: int = 100,
        max_pages: int = 2,
        use_startblock: bool = True,
    ) -> None:
        self._api_key = api_key
        self._interval = 1.0 / rate_limit_per_sec
        self._last_call: float = 0.0
        self._page_size = page_size
        self._max_pages = max_pages
        self._use_startblock = use_startblock
        self._startblock_cache: dict[tuple[int, int], int] = {}

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
        recent_rows: list[dict] = []
        startblock = self._start_block_for_since(chain_id, since_ts)
        for page in range(1, self._max_pages + 1):
            self._rate_limit()
            params = {
                "chainid": chain_id,
                "module": "account",
                "action": action,
                "address": addr,
                "startblock": startblock,
                "endblock": 99999999,
                "page": page,
                "offset": self._page_size,
                "sort": "desc",
                "apikey": self._api_key,
            }
            resp = _get_with_backoff(_BASE_URL, params)
            data = resp.json()
            if data.get("status") == "0":
                msg = data.get("message", "")
                if "No transactions found" in msg or "No records found" in msg:
                    return recent_rows
                raise EtherscanError(f"API error: {msg}")

            result = data.get("result", [])
            if not isinstance(result, list):
                raise EtherscanError(f"Unexpected result type: {type(result)}")

            recent_rows.extend(
                row for row in result if int(row.get("timeStamp", 0)) >= since_ts
            )
            if len(result) < self._page_size:
                break
            if any(int(row.get("timeStamp", 0)) < since_ts for row in result):
                break

        return recent_rows

    def _start_block_for_since(self, chain_id: int, since_ts: int) -> int:
        if not self._use_startblock or since_ts <= 0:
            return 0
        key = (chain_id, since_ts)
        if key in self._startblock_cache:
            return self._startblock_cache[key]

        self._rate_limit()
        params = {
            "chainid": chain_id,
            "module": "block",
            "action": "getblocknobytime",
            "timestamp": since_ts,
            "closest": "before",
            "apikey": self._api_key,
        }
        try:
            resp = _get_with_backoff(_BASE_URL, params)
            data = resp.json()
            if data.get("status") == "1":
                block = int(data.get("result", 0))
                self._startblock_cache[key] = block
                return block
        except Exception as exc:
            logger.warning(
                "Etherscan startblock lookup failed chain_id=%s since_ts=%s: %s",
                chain_id,
                since_ts,
                exc,
            )

        self._startblock_cache[key] = 0
        return 0

    def _rate_limit(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_call
        if elapsed < self._interval:
            time.sleep(self._interval - elapsed)
        self._last_call = time.monotonic()
