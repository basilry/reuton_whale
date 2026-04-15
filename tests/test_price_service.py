from unittest.mock import patch

from src.analyzer.price_service import PriceService


class TestPriceServiceUnknownSymbolReporting:
    def test_unknown_symbols_are_counted_and_drained_in_stable_order(self):
        svc = PriceService()
        svc._cache["PEPE"] = (0.00001, 0.0)

        with patch("src.analyzer.price_service.time.time", return_value=100.0), \
             patch("src.analyzer.price_service.requests.get") as mock_get:
            assert svc.get_usd("doge") is None
            assert svc.get_usd("DOGE") is None
            assert svc.get_usd("pepe") == 0.00001

        mock_get.assert_not_called()
        assert svc.drain_unknown_report() == [("DOGE", 2), ("PEPE", 1)]
        assert svc.drain_unknown_report() == []

    def test_supported_symbol_uses_cached_fallback_on_network_failure(self):
        svc = PriceService()
        svc._cache["ETH"] = (1234.56, 0.0)

        with patch("src.analyzer.price_service.time.time", return_value=100.0), \
             patch("src.analyzer.price_service.requests.get", side_effect=RuntimeError("boom")):
            assert svc.get_usd("ETH") == 1234.56

        assert svc.drain_unknown_report() == []
