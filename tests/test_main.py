import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _mock_config():
    config = MagicMock()
    config.whale_alert_api_key = "test-whale"
    config.anthropic_api_key = "test-anthropic"
    config.sheet_id = "test-sheet"
    config.google_credentials = '{"type":"service_account"}'
    config.telegram_token = "test-token"
    return config


def _sample_tx(hash_val="h1", amount_usd=5_000_000):
    return {
        "hash": hash_val,
        "from_address": "0xaaa",
        "from_owner_type": "exchange",
        "from_owner": "Binance",
        "to_address": "0xbbb",
        "to_owner_type": "unknown",
        "to_owner": "unknown",
        "symbol": "BTC",
        "amount": 100,
        "amount_usd": amount_usd,
        "timestamp": 1700000000,
        "blockchain": "bitcoin",
        "raw_response_hash": "abc123",
        "current_price": 60000,
        "price_change_24h": -2.5,
        "volume_24h": 25_000_000_000,
        "market_cap": 1_200_000_000_000,
    }


@pytest.mark.asyncio
class TestRunDailyPipeline:
    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_no_transactions(self, mock_config, mock_sheets_cls, mock_bot_cls):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot_cls.return_value = mock_bot

        with patch("src.main.WhaleAlertCollector") as mock_collector_cls:
            mock_collector = MagicMock()
            mock_collector.fetch_transactions.return_value = []
            mock_collector_cls.return_value = mock_collector

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed_empty"
        mock_sheets.log_run.assert_called_once()

    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_full_pipeline(self, mock_config, mock_sheets_cls, mock_bot_cls):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets.append_transactions.return_value = 2
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 1, "failed": 0, "blocked": 0})
        mock_bot_cls.return_value = mock_bot

        txs = [_sample_tx("h1", 5_000_000), _sample_tx("h2", 15_000_000)]
        analyzed = [{**tx, "importance_score": 8, "type": "distribution"} for tx in txs]

        with patch("src.main.WhaleAlertCollector") as mock_coll_cls, \
             patch("src.main.CoinGeckoEnricher") as mock_enrich_cls, \
             patch("src.main.ClaudeAnalyzer") as mock_analyzer_cls, \
             patch("src.main.TransactionScorer") as mock_scorer_cls:

            mock_coll = MagicMock()
            mock_coll.fetch_transactions.return_value = txs
            mock_coll_cls.return_value = mock_coll

            mock_enrich = MagicMock()
            mock_enrich.enrich_transactions.return_value = txs
            mock_enrich_cls.return_value = mock_enrich

            mock_analyzer = MagicMock()
            mock_analyzer.analyze_batch.return_value = analyzed
            mock_analyzer.generate_daily_brief.return_value = "Daily brief text"
            mock_analyzer_cls.return_value = mock_analyzer

            mock_scorer = MagicMock()
            mock_scorer.pre_filter.return_value = txs
            mock_scorer.rank_by_importance.return_value = analyzed[:1]
            mock_scorer_cls.return_value = mock_scorer

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed"
        assert result["transactions_count"] == 2
        mock_sheets.save_daily_brief.assert_called_once()
        mock_bot.send_daily_brief.assert_called_once()

    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_pipeline_with_errors(self, mock_config, mock_sheets_cls, mock_bot_cls):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets.append_transactions.side_effect = Exception("Sheets API error")
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 0, "failed": 0, "blocked": 0})
        mock_bot_cls.return_value = mock_bot

        txs = [_sample_tx()]
        analyzed = [{**txs[0], "importance_score": 7, "type": "accumulation"}]

        with patch("src.main.WhaleAlertCollector") as mock_coll_cls, \
             patch("src.main.CoinGeckoEnricher") as mock_enrich_cls, \
             patch("src.main.ClaudeAnalyzer") as mock_analyzer_cls, \
             patch("src.main.TransactionScorer") as mock_scorer_cls:

            mock_coll = MagicMock()
            mock_coll.fetch_transactions.return_value = txs
            mock_coll_cls.return_value = mock_coll

            mock_enrich = MagicMock()
            mock_enrich.enrich_transactions.return_value = txs
            mock_enrich_cls.return_value = mock_enrich

            mock_analyzer = MagicMock()
            mock_analyzer.analyze_batch.return_value = analyzed
            mock_analyzer.generate_daily_brief.return_value = "Brief"
            mock_analyzer_cls.return_value = mock_analyzer

            mock_scorer = MagicMock()
            mock_scorer.pre_filter.return_value = txs
            mock_scorer.rank_by_importance.return_value = analyzed
            mock_scorer_cls.return_value = mock_scorer

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed_with_errors"
        errors = json.loads(result["errors"])
        assert any("Sheets API error" in e for e in errors)
