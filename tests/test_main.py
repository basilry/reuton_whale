import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.signals.models import Event, Signal


def _mock_config():
    config = MagicMock()
    config.etherscan_api_key = "test-etherscan"
    config.solscan_api_key = ""
    config.anthropic_api_key = "test-anthropic"
    config.sheet_id = "test-sheet"
    config.google_credentials = '{"type":"service_account"}'
    config.telegram_token = "test-token"
    return config


def _sample_event(tx_hash="h1", amount_usd=5_000_000.0):
    return Event(
        source="chain",
        chain="ETH",
        tx_hash=tx_hash,
        watched_address="0xaaa",
        from_addr="0xaaa",
        to_addr="0xbbb",
        direction="out",
        token="BTC",
        amount_token=100.0,
        amount_usd=float(amount_usd),
        counterparty_category="exchange",
        block_time=datetime(2024, 1, 1, tzinfo=timezone.utc),
        collected_at=datetime.now(timezone.utc),
    )


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

        mock_sheets.list_watched_addresses.return_value = {}
        with patch("src.main.EtherscanCollector") as mock_eth_cls, \
             patch("src.main.SolscanCollector") as mock_sol_cls, \
             patch("src.main.PriceService"):
            mock_eth = MagicMock()
            mock_eth.fetch.return_value = []
            mock_eth_cls.return_value = mock_eth
            mock_sol = MagicMock()
            mock_sol.fetch.return_value = []
            mock_sol_cls.return_value = mock_sol

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed_empty"
        mock_sheets.log_run.assert_called_once()

    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_full_pipeline_saves_top_transactions_as_dict_list(
        self, mock_config, mock_sheets_cls, mock_bot_cls
    ):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets.append_transactions.return_value = 2
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 1, "failed": 0, "blocked": 0})
        mock_bot_cls.return_value = mock_bot

        events = [_sample_event("h1", 5_000_000), _sample_event("h2", 15_000_000)]
        txs_as_dicts = [
            {
                "hash": e.tx_hash,
                "from_address": e.from_addr,
                "from_owner_type": "exchange",
                "from_owner": "exchange",
                "to_address": e.to_addr,
                "to_owner_type": "exchange",
                "to_owner": "exchange",
                "symbol": e.token,
                "amount": e.amount_token,
                "amount_usd": e.amount_usd,
                "timestamp": int(e.block_time.timestamp()),
                "blockchain": e.chain,
                "raw_response_hash": e.tx_hash,
            }
            for e in events
        ]
        analyzed = [
            {**tx, "importance_score": 8, "type": "distribution", "interpretation": "큰 거래"}
            for tx in txs_as_dicts
        ]

        mock_sheets.list_watched_addresses.return_value = {"0xaaa": {"address": "0xaaa", "chain": "ETH", "category": "exchange"}}
        with patch("src.main.EtherscanCollector") as mock_eth_cls, \
             patch("src.main.SolscanCollector") as mock_sol_cls, \
             patch("src.main.PriceService"), \
             patch("src.main.CoinGeckoEnricher") as mock_enrich_cls, \
             patch("src.main.ClaudeAnalyzer") as mock_analyzer_cls, \
             patch("src.main.TransactionScorer") as mock_scorer_cls:

            mock_eth = MagicMock()
            mock_eth.fetch.return_value = events
            mock_eth_cls.return_value = mock_eth
            mock_sol = MagicMock()
            mock_sol.fetch.return_value = []
            mock_sol_cls.return_value = mock_sol

            mock_enrich = MagicMock()
            mock_enrich.enrich_transactions.side_effect = lambda txs: txs
            mock_enrich_cls.return_value = mock_enrich

            mock_analyzer = MagicMock()
            mock_analyzer.analyze_batch.return_value = analyzed
            mock_analyzer.generate_daily_brief.return_value = "오늘의 브리프"
            mock_analyzer_cls.return_value = mock_analyzer

            mock_scorer = MagicMock()
            mock_scorer.pre_filter.side_effect = lambda txs: txs
            mock_scorer.rank_by_importance.return_value = analyzed
            mock_scorer_cls.return_value = mock_scorer

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed"
        assert result["transactions_count"] == 2
        mock_sheets.append_address_activity.assert_called_once()
        activity_rows = mock_sheets.append_address_activity.call_args[0][0]
        assert len(activity_rows) == 2
        assert activity_rows[0]["tx_hash"] == "h1"
        assert activity_rows[0]["watched_address"] == "0xaaa"

        mock_sheets.save_daily_brief.assert_called_once()
        briefs_arg = mock_sheets.save_daily_brief.call_args[0][1]
        assert len(briefs_arg) == 1
        entry = briefs_arg[0]
        assert entry["summary"] == "오늘의 브리프"
        assert entry["alert_count"] == 2

        top_txs = json.loads(entry["top_transactions"])
        assert isinstance(top_txs, list)
        assert len(top_txs) == 2
        required_keys = {"hash", "symbol", "amount_usd", "importance_score", "interpretation", "type"}
        for tx in top_txs:
            assert isinstance(tx, dict)
            assert required_keys.issubset(tx.keys())
        assert top_txs[0]["symbol"] == "BTC"
        assert top_txs[0]["importance_score"] == 8

        mock_bot.send_daily_brief.assert_called_once()

    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_analyze_batch_failure_falls_back_to_base_score(
        self, mock_config, mock_sheets_cls, mock_bot_cls
    ):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets.append_transactions.return_value = 1
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 0, "failed": 0, "blocked": 0})
        mock_bot_cls.return_value = mock_bot

        evt = _sample_event("h1", 10_000_000)
        events = [evt]

        mock_sheets.list_watched_addresses.return_value = {"0xaaa": {"address": "0xaaa", "chain": "ETH", "category": "exchange"}}
        with patch("src.main.EtherscanCollector") as mock_eth_cls, \
             patch("src.main.SolscanCollector") as mock_sol_cls, \
             patch("src.main.PriceService"), \
             patch("src.main.CoinGeckoEnricher") as mock_enrich_cls, \
             patch("src.main.ClaudeAnalyzer") as mock_analyzer_cls, \
             patch("src.main.TransactionScorer") as mock_scorer_cls:

            mock_eth = MagicMock()
            mock_eth.fetch.return_value = events
            mock_eth_cls.return_value = mock_eth
            mock_sol = MagicMock()
            mock_sol.fetch.return_value = []
            mock_sol_cls.return_value = mock_sol

            mock_enrich = MagicMock()
            mock_enrich.enrich_transactions.side_effect = lambda txs: txs
            mock_enrich_cls.return_value = mock_enrich

            mock_analyzer = MagicMock()
            mock_analyzer.analyze_batch.side_effect = Exception("Claude down")
            mock_analyzer.generate_daily_brief.return_value = "fallback brief"
            mock_analyzer_cls.return_value = mock_analyzer

            mock_scorer = MagicMock()
            mock_scorer.pre_filter.side_effect = lambda txs: [
                {**tx, "base_score": 6} for tx in txs
            ]
            mock_scorer.rank_by_importance.side_effect = lambda xs: xs
            mock_scorer_cls.return_value = mock_scorer

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        errors = json.loads(result["errors"])
        assert any("analyze_batch" in e for e in errors)
        assert result["status"] == "completed_with_errors"

        briefs_arg = mock_sheets.save_daily_brief.call_args[0][1]
        top_txs = json.loads(briefs_arg[0]["top_transactions"])
        assert top_txs[0]["importance_score"] == 6
        assert top_txs[0]["type"] == "unknown"

    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_signal_path_skips_legacy_scorer_and_analysis(
        self, mock_config, mock_sheets_cls, mock_bot_cls
    ):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets.append_transactions.return_value = 1
        mock_sheets.list_watched_addresses.return_value = {
            "0xaaa": {"address": "0xaaa", "chain": "ETH", "category": "exchange"}
        }
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 1, "failed": 0, "blocked": 0})
        mock_bot_cls.return_value = mock_bot

        evt = _sample_event("h1", 10_000_000)
        sig = Signal(
            signal_id="sig1",
            rule="cold_to_hot_transfer",
            severity="high",
            score=9.0,
            confidence="high",
            source="chain",
            evidence_tx_hashes=["h1"],
            window_start=evt.block_time,
            window_end=evt.block_time,
            summary="Signal summary",
        )

        with patch("src.main.EtherscanCollector") as mock_eth_cls, \
             patch("src.main.SolscanCollector") as mock_sol_cls, \
             patch("src.main.PriceService"), \
             patch("src.main.CoinGeckoEnricher") as mock_enrich_cls, \
             patch("src.main.ClaudeAnalyzer") as mock_analyzer_cls, \
             patch("src.main.SignalEngine") as mock_engine_cls, \
             patch("src.main.TransactionScorer") as mock_scorer_cls, \
             patch("src.main.build_chain_baselines") as mock_baselines:

            mock_eth = MagicMock()
            mock_eth.fetch.return_value = [evt]
            mock_eth_cls.return_value = mock_eth
            mock_sol = MagicMock()
            mock_sol.fetch.return_value = []
            mock_sol_cls.return_value = mock_sol

            mock_enrich = MagicMock()
            mock_enrich.enrich_transactions.side_effect = lambda txs: txs
            mock_enrich_cls.return_value = mock_enrich

            mock_analyzer = MagicMock()
            mock_analyzer.generate_daily_brief.return_value = "signal brief"
            mock_analyzer_cls.return_value = mock_analyzer

            mock_engine = MagicMock()
            mock_engine.run.return_value = [sig]
            mock_engine.personalize.side_effect = lambda signals, interests: signals
            mock_engine_cls.return_value = mock_engine
            mock_baselines.return_value = {"default": {"out_mean_usd": 1.0}}

            mock_scorer = MagicMock()
            mock_scorer_cls.return_value = mock_scorer

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed"
        mock_scorer.pre_filter.assert_not_called()
        mock_scorer.rank_by_importance.assert_not_called()
        mock_analyzer.analyze_batch.assert_not_called()
        mock_baselines.assert_called_once()
        assert mock_engine.run.call_args.kwargs["baselines"] == {"default": {"out_mean_usd": 1.0}}
        assert mock_bot_cls.call_args.kwargs["personalize_fn"] == mock_engine.personalize

        briefs_arg = mock_sheets.save_daily_brief.call_args[0][1]
        top_txs = json.loads(briefs_arg[0]["top_transactions"])
        assert top_txs == [{
            "hash": "h1",
            "symbol": "BTC",
            "amount_usd": 10_000_000.0,
            "amount_usd_known": True,
            "importance_score": 9.0,
            "interpretation": "Signal summary",
            "type": "cold_to_hot_transfer",
            "signal_id": "sig1",
            "rule": "cold_to_hot_transfer",
            "severity": "high",
            "source": "chain",
            "confidence": "high",
            "evidence_count": 1,
            "window_start": "2024-01-01T00:00:00+00:00",
            "window_end": "2024-01-01T00:00:00+00:00",
        }]

    @patch("src.main.WhaleScopeBot")
    @patch("src.main.SheetsClient")
    @patch("src.main.load_config")
    async def test_pipeline_with_sheets_error(self, mock_config, mock_sheets_cls, mock_bot_cls):
        mock_config.return_value = _mock_config()
        mock_sheets = MagicMock()
        mock_sheets.append_transactions.side_effect = Exception("Sheets API error")
        mock_sheets_cls.return_value = mock_sheets

        mock_bot = MagicMock()
        mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 0, "failed": 0, "blocked": 0})
        mock_bot_cls.return_value = mock_bot

        evt = _sample_event()
        analyzed_item = {
            "hash": evt.tx_hash,
            "symbol": evt.token,
            "amount_usd": evt.amount_usd,
            "importance_score": 7,
            "type": "accumulation",
            "interpretation": "",
        }

        mock_sheets.list_watched_addresses.return_value = {"0xaaa": {"address": "0xaaa", "chain": "ETH", "category": "exchange"}}
        with patch("src.main.EtherscanCollector") as mock_eth_cls, \
             patch("src.main.SolscanCollector") as mock_sol_cls, \
             patch("src.main.PriceService"), \
             patch("src.main.CoinGeckoEnricher") as mock_enrich_cls, \
             patch("src.main.ClaudeAnalyzer") as mock_analyzer_cls, \
             patch("src.main.TransactionScorer") as mock_scorer_cls:

            mock_eth = MagicMock()
            mock_eth.fetch.return_value = [evt]
            mock_eth_cls.return_value = mock_eth
            mock_sol = MagicMock()
            mock_sol.fetch.return_value = []
            mock_sol_cls.return_value = mock_sol

            mock_enrich = MagicMock()
            mock_enrich.enrich_transactions.side_effect = lambda txs: txs
            mock_enrich_cls.return_value = mock_enrich

            mock_analyzer = MagicMock()
            mock_analyzer.analyze_batch.return_value = [analyzed_item]
            mock_analyzer.generate_daily_brief.return_value = "Brief"
            mock_analyzer_cls.return_value = mock_analyzer

            mock_scorer = MagicMock()
            mock_scorer.pre_filter.side_effect = lambda txs: txs
            mock_scorer.rank_by_importance.return_value = [analyzed_item]
            mock_scorer_cls.return_value = mock_scorer

            from src.main import run_daily_pipeline
            result = await run_daily_pipeline()

        assert result["status"] == "completed_with_errors"
        errors = json.loads(result["errors"])
        assert any("Sheets API error" in e for e in errors)


def test_signals_to_top5_keeps_hashless_signal_summary_without_fake_amount():
    from src.main import _signals_to_top5

    now = datetime(2024, 1, 1, tzinfo=timezone.utc)
    sig = Signal(
        signal_id="sig-tg",
        rule="tg_cex_inflow_burst",
        severity="medium",
        score=7.0,
        confidence="medium",
        source="tg",
        evidence_tx_hashes=[],
        window_start=now,
        window_end=now,
        summary="TG burst summary",
        extra={"symbol": "USDT"},
    )

    top_items = _signals_to_top5([sig], [])

    assert top_items == [{
        "hash": "",
        "symbol": "USDT",
        "amount_usd": None,
        "amount_usd_known": False,
        "importance_score": 7.0,
        "interpretation": "TG burst summary",
        "type": "tg_cex_inflow_burst",
        "signal_id": "sig-tg",
        "rule": "tg_cex_inflow_burst",
        "severity": "medium",
        "source": "tg",
        "confidence": "medium",
        "evidence_count": 0,
        "window_start": "2024-01-01T00:00:00+00:00",
        "window_end": "2024-01-01T00:00:00+00:00",
        "summary": "TG burst summary",
    }]
