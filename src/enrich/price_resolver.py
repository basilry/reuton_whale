from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

from src.analyzer.price_service import PriceService
from src.utils.logger import get_logger

logger = get_logger("enrich.price_resolver")

_BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price"
_STABLE_SYMBOLS = {
    "USDT",
    "USDC",
    "DAI",
    "BUSD",
    "FDUSD",
    "USDE",
    "PYUSD",
    "TUSD",
}
_SYMBOL_ALIASES = {
    "WETH": "ETH",
    "WBTC": "BTC",
}
_CACHE_TTL = timedelta(minutes=10)
_STALE_CACHE_TTL = timedelta(hours=6)


@dataclass(frozen=True)
class PriceQuote:
    symbol: str
    price_usd: float
    source: str
    fetched_at: datetime
    stale: bool = False


class PriceResolver:
    def __init__(
        self,
        *,
        primary: PriceService | None = None,
        session: requests.Session | None = None,
    ) -> None:
        self._primary = primary or PriceService()
        self._session = session or requests.Session()
        self._cache: dict[str, PriceQuote] = {}

    def resolve(self, symbol: str, *, at: datetime | None = None) -> PriceQuote | None:
        target = self._normalize_symbol(symbol)
        if not target:
            return None

        now = at or datetime.now(timezone.utc)
        cached = self._cache.get(target)
        if cached and now - cached.fetched_at <= _CACHE_TTL:
            return cached

        if target in _STABLE_SYMBOLS:
            quote = PriceQuote(
                symbol=target,
                price_usd=1.0,
                source="stablecoin_proxy",
                fetched_at=now,
            )
            self._cache[target] = quote
            return quote

        primary_price = self._primary.get_usd(target)
        if primary_price is not None:
            quote = PriceQuote(
                symbol=target,
                price_usd=float(primary_price),
                source="coingecko",
                fetched_at=now,
            )
            self._cache[target] = quote
            return quote

        binance_price = self._fetch_binance_price(target)
        if binance_price is not None:
            quote = PriceQuote(
                symbol=target,
                price_usd=binance_price,
                source="binance",
                fetched_at=now,
            )
            self._cache[target] = quote
            return quote

        if cached and now - cached.fetched_at <= _STALE_CACHE_TTL:
            stale_quote = PriceQuote(
                symbol=cached.symbol,
                price_usd=cached.price_usd,
                source=f"{cached.source}:stale",
                fetched_at=cached.fetched_at,
                stale=True,
            )
            return stale_quote

        return None

    def _normalize_symbol(self, symbol: str) -> str:
        raw = str(symbol or "").strip().upper()
        if not raw:
            return ""
        return _SYMBOL_ALIASES.get(raw, raw)

    def _fetch_binance_price(self, symbol: str) -> float | None:
        for quote_symbol in ("USDT", "USDC", "FDUSD", "BUSD"):
            try:
                response = self._session.get(
                    _BINANCE_TICKER_URL,
                    params={"symbol": f"{symbol}{quote_symbol}"},
                    timeout=5,
                )
                response.raise_for_status()
                data = response.json()
                price = data.get("price")
                if price is not None:
                    return float(price)
            except Exception as exc:
                logger.debug(
                    "Binance price fetch failed symbol=%s quote=%s: %s",
                    symbol,
                    quote_symbol,
                    exc,
                )
        return None
