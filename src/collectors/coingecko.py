import requests

from src.utils.logger import get_logger
from src.utils.retry import retry

logger = get_logger("coingecko")

PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"
COINS_LIST_URL = "https://api.coingecko.com/api/v3/coins/list"


class CoinGeckoEnricher:
    SYMBOL_TO_ID = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "SOL": "solana",
        "USDT": "tether",
        "USDC": "usd-coin",
        "BNB": "binancecoin",
        "XRP": "ripple",
        "ADA": "cardano",
        "DOGE": "dogecoin",
        "DOT": "polkadot",
        "MATIC": "matic-network",
        "AVAX": "avalanche-2",
        "LINK": "chainlink",
        "UNI": "uniswap",
        "SHIB": "shiba-inu",
        "TRX": "tron",
        "LTC": "litecoin",
        "BCH": "bitcoin-cash",
        "ATOM": "cosmos",
        "ARB": "arbitrum",
        "OP": "optimism",
        "NEAR": "near",
        "APT": "aptos",
        "SUI": "sui",
        "FTM": "fantom",
        "ALGO": "algorand",
        "XLM": "stellar",
        "FIL": "filecoin",
        "ICP": "internet-computer",
        "HBAR": "hedera-hashgraph",
        "PEPE": "pepe",
        "TON": "the-open-network",
        "INJ": "injective-protocol",
        "AAVE": "aave",
        "MKR": "maker",
    }

    def __init__(self) -> None:
        self._coins_list: list[dict] | None = None
        self._dynamic_cache: dict[str, str] = {}

    def enrich_transactions(self, transactions: list[dict]) -> list[dict]:
        symbols = {tx.get("symbol", "") for tx in transactions if tx.get("symbol")}
        resolved: dict[str, str] = {}
        for symbol in symbols:
            coin_id = self._resolve_symbol(symbol)
            if coin_id:
                resolved[symbol] = coin_id

        if not resolved:
            return transactions

        prices = self._fetch_prices(list(resolved.values()))

        for tx in transactions:
            symbol = tx.get("symbol", "")
            coin_id = resolved.get(symbol)
            if coin_id and coin_id in prices:
                data = prices[coin_id]
                tx["current_price"] = data.get("usd")
                tx["price_change_24h"] = data.get("usd_24h_change")
                tx["volume_24h"] = data.get("usd_24h_vol")
                tx["market_cap"] = data.get("usd_market_cap")
            else:
                if symbol:
                    logger.info("No price data for symbol: %s", symbol)
                tx["current_price"] = None
                tx["price_change_24h"] = None
                tx["volume_24h"] = None
                tx["market_cap"] = None

        return transactions

    def _resolve_symbol(self, symbol: str) -> str | None:
        upper = symbol.upper()
        if upper in self.SYMBOL_TO_ID:
            return self.SYMBOL_TO_ID[upper]
        if upper in self._dynamic_cache:
            return self._dynamic_cache[upper]

        if self._coins_list is None:
            self._coins_list = self._fetch_coins_list()

        for coin in self._coins_list:
            if coin.get("symbol", "").upper() == upper:
                coin_id = coin.get("id")
                if coin_id:
                    self._dynamic_cache[upper] = coin_id
                    return coin_id
        return None

    def _fetch_coins_list(self) -> list[dict]:
        try:
            resp = requests.get(COINS_LIST_URL, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.warning("Failed to fetch CoinGecko coins list: %s", exc)
            return []

    @retry(max_retries=5, base_delay=1.0)
    def _fetch_prices(self, coin_ids: list[str]) -> dict:
        all_prices: dict = {}

        for i in range(0, len(coin_ids), 50):
            batch = coin_ids[i : i + 50]
            resp = requests.get(
                PRICE_URL,
                params={
                    "ids": ",".join(batch),
                    "vs_currencies": "usd",
                    "include_24hr_vol": "true",
                    "include_24hr_change": "true",
                    "include_market_cap": "true",
                },
                timeout=30,
            )

            if resp.status_code == 429:
                raise Exception("CoinGecko rate limited (429)")

            resp.raise_for_status()
            all_prices.update(resp.json())

        return all_prices
