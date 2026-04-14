from unittest.mock import MagicMock, patch

import pytest

from src.collectors.coingecko import CoinGeckoEnricher


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
        assert len(CoinGeckoEnricher.SYMBOL_TO_ID) >= 35

    @patch.object(CoinGeckoEnricher, "_fetch_coins_list")
    def test_resolve_symbol_dynamic_hit(self, mock_fetch):
        mock_fetch.return_value = [
            {"id": "matic-network", "symbol": "matic", "name": "Polygon"},
            {"id": "new-coin", "symbol": "newc", "name": "New Coin"},
        ]
        enricher = CoinGeckoEnricher()
        assert enricher._resolve_symbol("NEWC") == "new-coin"
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
