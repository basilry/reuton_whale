import requests

from src.utils.logger import get_logger
from src.utils.retry import retry

logger = get_logger("coingecko")

PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"


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
    }

    def enrich_transactions(self, transactions: list[dict]) -> list[dict]:
        symbols = {tx.get("symbol", "") for tx in transactions}
        coin_ids = [
            self.SYMBOL_TO_ID[s] for s in symbols if s in self.SYMBOL_TO_ID
        ]

        if not coin_ids:
            return transactions

        prices = self._fetch_prices(coin_ids)

        for tx in transactions:
            symbol = tx.get("symbol", "")
            coin_id = self.SYMBOL_TO_ID.get(symbol)
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
