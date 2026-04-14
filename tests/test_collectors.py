from unittest.mock import MagicMock, patch

import pytest

from src.collectors.whale_alert import WhaleAlertCollector, _mask_url
from src.collectors.coingecko import CoinGeckoEnricher


def _raw_tx(hash_val="h1", amount=100, amount_usd=5_000_000, symbol="btc"):
    return {
        "hash": hash_val,
        "from": {"address": "0xaaa", "owner_type": "exchange", "owner": "Binance"},
        "to": {"address": "0xbbb", "owner_type": "unknown", "owner": "unknown"},
        "symbol": symbol,
        "amount": amount,
        "amount_usd": amount_usd,
        "timestamp": 1700000000,
        "blockchain": "bitcoin",
    }


class TestMaskUrl:
    def test_masks_api_key_query_param(self):
        url = "https://api.whale-alert.io/v1/transactions?api_key=SECRET123&start=0"
        assert "SECRET123" not in _mask_url(url)
        assert "api_key=***" in _mask_url(url)

    def test_preserves_other_params(self):
        url = "https://api.whale-alert.io/v1/transactions?api_key=x&start=100"
        assert "start=100" in _mask_url(url)

    def test_no_key_no_change(self):
        url = "https://api.whale-alert.io/v1/transactions?start=0"
        assert _mask_url(url) == url


class TestWhaleAlertCollector:
    @patch("src.collectors.whale_alert.requests.get")
    def test_fetch_success(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.url = "https://api.whale-alert.io/v1/transactions?api_key=x"
        mock_resp.json.return_value = {"transactions": [_raw_tx()]}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        collector = WhaleAlertCollector(api_key="test")
        result = collector.fetch_transactions(hours=1)
        assert len(result) == 1
        assert result[0]["symbol"] == "BTC"
        assert result[0]["from_owner"] == "Binance"

    @patch("src.collectors.whale_alert.requests.get")
    def test_invalid_api_key(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.url = "https://api.whale-alert.io/v1/transactions?api_key=bad"
        mock_get.return_value = mock_resp

        collector = WhaleAlertCollector(api_key="bad")
        with pytest.raises(ValueError, match="Invalid"):
            collector.fetch_transactions()

    def test_parse_transaction(self):
        collector = WhaleAlertCollector(api_key="test")
        parsed = collector._parse_transaction(_raw_tx())
        assert parsed["hash"] == "h1"
        assert parsed["from_owner_type"] == "exchange"
        assert parsed["symbol"] == "BTC"
        assert "raw_response_hash" in parsed

    def test_deduplicate(self):
        collector = WhaleAlertCollector(api_key="test")
        tx = collector._parse_transaction(_raw_tx())
        result = collector._deduplicate([tx, tx])
        assert len(result) == 1


class TestCoinGeckoEnricher:
    @patch("src.collectors.coingecko.requests.get")
    def test_enrich(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "bitcoin": {
                "usd": 60000,
                "usd_24h_change": -2.5,
                "usd_24h_vol": 25_000_000_000,
                "usd_market_cap": 1_200_000_000_000,
            }
        }
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        enricher = CoinGeckoEnricher()
        txs = [{"symbol": "BTC"}]
        result = enricher.enrich_transactions(txs)
        assert result[0]["current_price"] == 60000

    def test_empty_transactions(self):
        enricher = CoinGeckoEnricher()
        assert enricher.enrich_transactions([]) == []

    def test_resolve_symbol_hardcoded_hit(self):
        enricher = CoinGeckoEnricher()
        assert enricher._resolve_symbol("BTC") == "bitcoin"
        assert enricher._resolve_symbol("eth") == "ethereum"

    def test_resolve_symbol_hardcoded_has_35_entries(self):
        # Verifies CoinGecko map expansion (H4).
        assert len(CoinGeckoEnricher.SYMBOL_TO_ID) >= 35

    @patch.object(CoinGeckoEnricher, "_fetch_coins_list")
    def test_resolve_symbol_dynamic_hit(self, mock_fetch):
        mock_fetch.return_value = [
            {"id": "matic-network", "symbol": "matic", "name": "Polygon"},
            {"id": "new-coin", "symbol": "newc", "name": "New Coin"},
        ]
        enricher = CoinGeckoEnricher()
        assert enricher._resolve_symbol("NEWC") == "new-coin"
        # Subsequent lookup uses dynamic cache (no additional fetch)
        assert enricher._resolve_symbol("NEWC") == "new-coin"
        mock_fetch.assert_called_once()

    @patch.object(CoinGeckoEnricher, "_fetch_coins_list")
    def test_resolve_symbol_not_found(self, mock_fetch):
        mock_fetch.return_value = []
        enricher = CoinGeckoEnricher()
        assert enricher._resolve_symbol("NOPE") is None

    @patch("src.collectors.coingecko.requests.get")
    @patch.object(CoinGeckoEnricher, "_fetch_coins_list")
    def test_unknown_symbol_no_enrichment(self, mock_fetch, mock_get):
        mock_fetch.return_value = []
        enricher = CoinGeckoEnricher()
        txs = [{"symbol": "UNKNOWN_COIN"}]
        result = enricher.enrich_transactions(txs)
        assert "current_price" not in result[0]
