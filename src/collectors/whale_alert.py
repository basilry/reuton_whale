import hashlib
import json
import re
import time

import requests

from src.utils.errors import WhaleAlertError
from src.utils.logger import get_logger
from src.utils.retry import retry

logger = get_logger("whale_alert")

BASE_URL = "https://api.whale-alert.io/v1/transactions"


def _mask_url(url: str) -> str:
    return re.sub(r"api_key=[^&]*", "api_key=***", url)


class WhaleAlertCollector:
    def __init__(self, api_key: str):
        self._api_key = api_key

    def fetch_transactions(
        self, hours: int = 24, min_value: int = 1_000_000
    ) -> list[dict]:
        try:
            raw_transactions = self._request(hours, min_value)
        except ValueError:
            raise
        except WhaleAlertError:
            return []

        parsed = [self._parse_transaction(tx) for tx in raw_transactions]
        return self._deduplicate(parsed)

    @retry(max_retries=5, base_delay=1.0)
    def _request(self, hours: int, min_value: int) -> list[dict]:
        start = int(time.time()) - hours * 3600
        resp = requests.get(
            BASE_URL,
            params={
                "api_key": self._api_key,
                "start": start,
                "min_value": min_value,
            },
            timeout=30,
        )

        logger.debug("Whale Alert request: %s", _mask_url(resp.url))

        if resp.status_code == 401:
            raise ValueError("Invalid Whale Alert API key")

        if resp.status_code == 503:
            logger.warning("Whale Alert API unavailable (503)")
            raise WhaleAlertError("Service unavailable")

        if resp.status_code == 429:
            raise WhaleAlertError("Rate limited (429)")

        try:
            resp.raise_for_status()
        except requests.HTTPError as exc:
            raise WhaleAlertError(_mask_url(str(exc))) from None
        return resp.json().get("transactions", [])

    def _parse_transaction(self, raw: dict) -> dict:
        return {
            "hash": raw.get("hash", ""),
            "from_address": raw.get("from", {}).get("address", ""),
            "from_owner_type": raw.get("from", {}).get("owner_type", "unknown"),
            "from_owner": raw.get("from", {}).get("owner", "unknown"),
            "to_address": raw.get("to", {}).get("address", ""),
            "to_owner_type": raw.get("to", {}).get("owner_type", "unknown"),
            "to_owner": raw.get("to", {}).get("owner", "unknown"),
            "symbol": raw.get("symbol", "").upper(),
            "amount": raw.get("amount", 0),
            "amount_usd": raw.get("amount_usd", 0),
            "timestamp": raw.get("timestamp", 0),
            "blockchain": raw.get("blockchain", ""),
            "raw_response_hash": hashlib.sha256(
                json.dumps(raw, sort_keys=True).encode()
            ).hexdigest(),
        }

    def _deduplicate(self, transactions: list[dict]) -> list[dict]:
        seen: set[str] = set()
        result: list[dict] = []
        for tx in transactions:
            key = tx["raw_response_hash"]
            if key not in seen:
                seen.add(key)
                result.append(tx)
        return result
