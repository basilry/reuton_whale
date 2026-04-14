"""CoinGecko /simple/price lookup with 60-second in-memory TTL cache."""
from __future__ import annotations

import time
from typing import Optional

import requests

from src.utils.logger import get_logger

logger = get_logger("price_service")

_TTL = 60.0  # seconds

_COINGECKO_IDS: dict[str, str] = {
    "ETH": "ethereum",
    "BTC": "bitcoin",
    "USDT": "tether",
    "USDC": "usd-coin",
    "BNB": "binancecoin",
    "SOL": "solana",
    "MATIC": "matic-network",
    "ARB": "arbitrum",
    "OP": "optimism",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "AAVE": "aave",
    "WBTC": "wrapped-bitcoin",
    "WETH": "weth",
    "DAI": "dai",
    "BUSD": "binance-usd",
    "XRP": "ripple",
    "ADA": "cardano",
    "AVAX": "avalanche-2",
    "DOT": "polkadot",
}

_BASE_URL = "https://api.coingecko.com/api/v3/simple/price"


class PriceService:
    def __init__(self) -> None:
        # {symbol: (price_usd, fetched_at)}
        self._cache: dict[str, tuple[float, float]] = {}

    def get_usd(self, symbol: str, ts: int | None = None) -> Optional[float]:
        """Return current USD price for *symbol*. *ts* is unused (reserved for historical lookup)."""
        sym = symbol.upper()
        cached = self._cache.get(sym)
        if cached is not None:
            price, fetched_at = cached
            if time.time() - fetched_at < _TTL:
                return price

        coin_id = _COINGECKO_IDS.get(sym)
        if not coin_id:
            return cached[0] if cached else None

        try:
            resp = requests.get(
                _BASE_URL,
                params={"ids": coin_id, "vs_currencies": "usd"},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            price = data.get(coin_id, {}).get("usd")
            if price is not None:
                self._cache[sym] = (float(price), time.time())
                return float(price)
        except Exception as e:
            logger.warning("CoinGecko price fetch failed symbol=%s: %s", sym, e)

        return cached[0] if cached else None
