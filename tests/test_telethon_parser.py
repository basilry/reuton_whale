"""Tests for TelethonListener message parsing."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.ingestion.telethon_listener import TelethonListener, parse_tg_message


_SAMPLE_MSG = "🚨 1,000,000 #USDT (1,012,450 USD) transferred from #Binance to #unknown"
_SAMPLE_MSG_BTC = "🐳 150 #BTC (9,000,000 USD) transferred from #unknown to #Kraken\n#ethereum"
_SAMPLE_MSG_SOL = "500,000 #SOL (75,000,000 USD) transferred from #Coinbase to #unknown"


class TestParseTgMessage:
    def test_parses_standard_message(self):
        result = parse_tg_message(_SAMPLE_MSG)
        assert result is not None
        assert result["symbol"] == "USDT"
        assert result["amount"] == 1_000_000.0
        assert result["amount_usd"] == 1_012_450.0
        assert result["from_owner"] == "Binance"
        assert result["to_owner"] == "unknown"

    def test_parses_btc_message_with_chain(self):
        result = parse_tg_message(_SAMPLE_MSG_BTC)
        assert result is not None
        assert result["symbol"] == "BTC"
        assert result["amount"] == 150.0
        assert result["amount_usd"] == 9_000_000.0
        assert result["to_owner"] == "Kraken"
        assert result["blockchain"] == "ethereum"

    def test_parses_sol_message(self):
        result = parse_tg_message(_SAMPLE_MSG_SOL)
        assert result is not None
        assert result["symbol"] == "SOL"
        assert result["from_owner"] == "Coinbase"

    def test_returns_none_for_unrelated_text(self):
        assert parse_tg_message("Hello world!") is None
        assert parse_tg_message("") is None

    def test_from_owner_type_exchange_known(self):
        result = parse_tg_message(_SAMPLE_MSG)
        assert result["from_owner_type"] == "exchange"

    def test_to_owner_type_unknown(self):
        result = parse_tg_message(_SAMPLE_MSG)
        assert result["to_owner_type"] == "unknown"

    def test_default_blockchain_unknown(self):
        result = parse_tg_message(_SAMPLE_MSG)
        assert result["blockchain"] == "unknown"

    def test_strips_hash_prefix_from_owners(self):
        msg = "500,000 #ETH (1,000,000 USD) transferred from #Binance to #Kraken"
        result = parse_tg_message(msg)
        assert result["from_owner"] == "Binance"
        assert result["to_owner"] == "Kraken"


class TestTelethonListenerHandleMessage:
    @pytest.mark.asyncio
    async def test_stores_parsed_message(self):
        mock_storage = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage)
        await listener._handle_message(1, datetime.now(timezone.utc), _SAMPLE_MSG)
        mock_storage.append_tg_whale_event.assert_called_once()
        row = mock_storage.append_tg_whale_event.call_args[0][0]
        assert row["symbol"] == "USDT"
        assert row["parsed_confidence"] == "high"

    @pytest.mark.asyncio
    async def test_skips_unparseable_without_router(self):
        mock_storage = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage)
        await listener._handle_message(2, datetime.now(timezone.utc), "unrelated text")
        mock_storage.append_tg_whale_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_llm_fallback_called_when_regex_fails(self):
        mock_storage = MagicMock()
        mock_router = MagicMock()
        mock_result = MagicMock()
        mock_result.content = '{"symbol":"ETH","amount":1000,"amount_usd":2000000,"from_owner":"unknown","to_owner":"Binance","from_owner_type":"unknown","to_owner_type":"exchange","blockchain":"ethereum"}'
        mock_router.call_task.return_value = mock_result

        listener = TelethonListener(12345, "hash", "session", mock_storage, router=mock_router)
        await listener._handle_message(3, datetime.now(timezone.utc), "some unusual alert text")

        call_kwargs = mock_router.call_task.call_args
        assert call_kwargs[0][0] == "nl_intent"
        assert "symbol" in call_kwargs[1]["system"]
        assert call_kwargs[1]["user"] == "some unusual alert text"
        mock_storage.append_tg_whale_event.assert_called_once()
        row = mock_storage.append_tg_whale_event.call_args[0][0]
        assert row["parsed_confidence"] == "low"
        assert row["symbol"] == "ETH"

    @pytest.mark.asyncio
    async def test_llm_fallback_failure_skips_storage(self):
        mock_storage = MagicMock()
        mock_router = MagicMock()
        mock_router.call_task.side_effect = Exception("LLM down")

        listener = TelethonListener(12345, "hash", "session", mock_storage, router=mock_router)
        await listener._handle_message(4, datetime.now(timezone.utc), "garbled message")
        mock_storage.append_tg_whale_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_storage_error_does_not_raise(self):
        mock_storage = MagicMock()
        mock_storage.append_tg_whale_event.side_effect = Exception("Storage down")
        listener = TelethonListener(12345, "hash", "session", mock_storage)
        # Should not raise
        await listener._handle_message(5, datetime.now(timezone.utc), _SAMPLE_MSG)
