"""Solscan Public API v2 collector."""
from __future__ import annotations

import requests

from src.ingestion.base import ChainCollector
from src.ingestion.normalizer import normalize_chain_tx
from src.signals.models import Event
from src.utils.errors import SolscanError
from src.utils.http_backoff import get_with_backoff
from src.utils.logger import get_logger

logger = get_logger("solscan")

_BASE_URL = "https://public-api.solscan.io"
_PAGE_SIZE = 50


def _is_solscan_rate_limited(data: dict) -> bool:
    return data.get("status") == 0 and "rate limit" in str(data.get("message", "")).lower()


def _get_with_backoff(url: str, params: dict, headers: dict | None = None) -> requests.Response:
    return get_with_backoff(
        do_get=lambda: requests.get(url, params=params, headers=headers, timeout=15),
        is_rate_limited=_is_solscan_rate_limited,
        error_cls=SolscanError,
        logger=logger,
    )


class SolscanCollector(ChainCollector):
    supported_chains = ("SOL",)
    chain_aliases = {
        "SOL": "SOL",
        "sol": "SOL",
        "solana": "SOL",
    }

    def __init__(self, api_key: str | None = None) -> None:
        self._headers: dict[str, str] = {}
        if api_key:
            self._headers["token"] = api_key

    def fetch(
        self,
        addresses: list[str],
        chain: str,
        since_ts: int,
        *,
        watched_index: dict | None = None,
        price_service=None,
    ) -> list[Event]:
        if self.normalize_chain(chain) != "SOL":
            raise SolscanError(f"Unknown chain: {chain!r}")
        seen: set[str] = set()
        events: list[Event] = []

        for addr in addresses:
            try:
                rows = self._fetch_transactions(addr, since_ts)
            except SolscanError as exc:
                logger.warning("Solscan error addr=%s: %s", addr, exc)
                continue

            for row in rows:
                sig = row.get("txHash") or row.get("signature") or ""
                if sig and sig in seen:
                    continue
                seen.add(sig)

                row["_chain"] = "SOL"
                row["_watched_address"] = addr
                try:
                    evt = normalize_chain_tx(row, "SOL", watched_index or {}, price_service)
                    events.append(evt)
                except Exception as exc:
                    logger.warning("normalize failed sig=%s: %s", sig, exc)

        return events

    def _fetch_transactions(self, addr: str, since_ts: int) -> list[dict]:
        resp = _get_with_backoff(
            f"{_BASE_URL}/v2/account/transactions",
            params={"account": addr, "limit": _PAGE_SIZE},
            headers=self._headers or None,
        )
        data = resp.json()
        if isinstance(data, dict) and data.get("status") == 0:
            raise SolscanError(f"API error: {data.get('message')}")

        txs: list[dict] = data if isinstance(data, list) else data.get("data", [])
        result: list[dict] = []
        for tx in txs:
            block_time = int(tx.get("blockTime") or 0)
            if block_time < since_ts:
                continue
            row = dict(tx)
            row.setdefault("hash", tx.get("txHash") or tx.get("signature") or "")
            row.setdefault("timeStamp", block_time)
            result.append(row)
        return result
