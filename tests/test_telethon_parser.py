"""Tests for TelethonListener message parsing."""
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.ingestion.telethon_listener import (
    TelethonListener,
    _DEFAULT_STALENESS_SECONDS,
    _staleness_threshold_seconds,
    parse_tg_message,
)


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
        mock_storage.append_system_log.assert_called_once()
        log_args = mock_storage.append_system_log.call_args[0]
        assert log_args[0] == "info"
        assert log_args[1] == "telethon_listener"
        assert log_args[2]["event"] == "message_processed"
        heartbeat = mock_storage.append_service_health.call_args[0][0]
        assert heartbeat["job_name"] == "message_processed"
        assert heartbeat["processed_count"] == 1
        assert heartbeat["source_name"] == "telegram_channel"
        assert heartbeat["last_success_at"]

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
        mock_result.text = '{"symbol":"ETH","amount":1000,"amount_usd":2000000,"from_owner":"unknown","to_owner":"Binance","from_owner_type":"unknown","to_owner_type":"exchange","blockchain":"ethereum"}'
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
        mock_storage.append_system_log.assert_called()

    @pytest.mark.asyncio
    async def test_to_thread_offloads_router_and_storage(self):
        mock_storage = MagicMock()
        mock_router = MagicMock()
        mock_result = MagicMock()
        mock_result.text = '{"symbol":"ETH","amount":1,"amount_usd":2,"from_owner":"unknown","to_owner":"Binance","from_owner_type":"unknown","to_owner_type":"exchange","blockchain":"ethereum"}'
        mock_router.call_task.return_value = mock_result

        listener = TelethonListener(12345, "hash", "session", mock_storage, router=mock_router)

        with patch(
            "src.ingestion.telethon_listener.asyncio.to_thread",
            side_effect=lambda fn, *args, **kwargs: fn(*args, **kwargs),
        ) as mock_to_thread:
            await listener._handle_message(6, datetime.now(timezone.utc), "some unusual alert text")

        threaded_functions = [call.args[0] for call in mock_to_thread.call_args_list]
        assert mock_router.call_task in threaded_functions
        assert mock_storage.append_tg_whale_event in threaded_functions
        assert mock_storage.append_system_log in threaded_functions

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
        mock_storage.append_system_log = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage)
        # Should not raise
        await listener._handle_message(5, datetime.now(timezone.utc), _SAMPLE_MSG)
        mock_storage.append_system_log.assert_called()
        log_args = mock_storage.append_system_log.call_args[0]
        assert log_args[0] == "error"
        assert log_args[1] == "telethon_listener"
        assert log_args[2]["stage"] == "storage"

    @pytest.mark.asyncio
    async def test_listener_heartbeat_uses_render_instance_id_when_available(self, monkeypatch):
        mock_storage = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage, channel="@whale")
        monkeypatch.setenv("RENDER_INSTANCE_ID", "render-i-123")

        await listener._record_service_heartbeat(status="ok", event="listener_start", force=True)

        heartbeat = mock_storage.append_service_health.call_args[0][0]
        assert heartbeat["instance_id"] == "render-i-123"
        assert heartbeat["job_name"] == "listener_start"


class TestTelethonListenerRun:
    @pytest.mark.asyncio
    async def test_listener_start_logged_after_connect(self):
        mock_storage = MagicMock()
        mock_storage.append_system_log = MagicMock()

        calls = []

        class FakeClient:
            def __init__(self, session, api_id, api_hash):
                self.session = session
                self.api_id = api_id
                self.api_hash = api_hash

            def on(self, _event):
                def decorator(fn):
                    return fn

                return decorator

            async def connect(self):
                calls.append("connect")

            async def is_user_authorized(self):
                calls.append("authorized")
                return True

            async def run_until_disconnected(self):
                calls.append("run")

            async def disconnect(self):
                calls.append("disconnect")

        fake_telethon = types.ModuleType("telethon")
        fake_telethon.TelegramClient = FakeClient
        fake_events = types.SimpleNamespace(NewMessage=lambda chats=None: ("new_message", chats))
        fake_telethon.events = fake_events

        fake_errors = types.ModuleType("telethon.errors")
        fake_errors.PhoneNumberInvalidError = RuntimeError
        fake_sessions = types.ModuleType("telethon.sessions")
        fake_sessions.StringSession = lambda value: value

        with patch.dict(
            sys.modules,
            {
                "telethon": fake_telethon,
                "telethon.errors": fake_errors,
                "telethon.sessions": fake_sessions,
            },
        ), patch("src.ingestion.telethon_listener.asyncio.to_thread", side_effect=lambda fn, *args, **kwargs: fn(*args, **kwargs)):
            listener = TelethonListener(12345, "hash", "session", mock_storage, channel="@whale")
            await listener.run()

        assert calls[:2] == ["connect", "authorized"]
        mock_storage.append_system_log.assert_any_call(
            "info",
            "telethon_listener",
            {
                "event": "listener_start",
                "channel": "@whale",
                "session": "session",
                "session_string": "unset",
            },
        )


class TestTelethonListenerHealthStatus:
    def test_healthy_when_last_message_recent(self):
        mock_storage = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage)
        listener._last_message_at = datetime.now(timezone.utc) - timedelta(seconds=60)
        listener._message_count = 3
        listener._error_count = 0

        status = listener.health_status()

        assert status["status"] == "healthy"
        assert status["staleness_seconds"] is not None
        assert status["staleness_seconds"] < 900
        assert status["message_count"] == 3
        assert status["error_count"] == 0

    def test_stale_after_15min_without_message(self):
        mock_storage = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage)
        listener._last_message_at = datetime.now(timezone.utc) - timedelta(seconds=901)
        listener._message_count = 0
        listener._error_count = 0

        status = listener.health_status()

        assert status["status"] == "stale"
        assert status["staleness_seconds"] is not None
        assert status["staleness_seconds"] >= 900

    def test_stale_before_any_message(self):
        mock_storage = MagicMock()
        listener = TelethonListener(12345, "hash", "session", mock_storage)

        status = listener.health_status()

        assert status["status"] == "stale"
        assert status["last_message_at"] is None
        assert status["staleness_seconds"] is None
        assert status["message_count"] == 0
        assert status["error_count"] == 0

    @pytest.mark.asyncio
    async def test_storage_error_increments_error_count(self):
        mock_storage = MagicMock()
        mock_storage.append_tg_whale_event.side_effect = RuntimeError("sheet offline")
        mock_storage.append_system_log = MagicMock()

        listener = TelethonListener(12345, "hash", "session", mock_storage)
        await listener._handle_message(42, datetime.now(timezone.utc), _SAMPLE_MSG)

        assert listener._error_count == 1


class TestStalenessThresholdEnv:
    def test_unset_returns_default(self, monkeypatch):
        monkeypatch.delenv("LISTENER_STALENESS_SECONDS", raising=False)
        assert _staleness_threshold_seconds() == _DEFAULT_STALENESS_SECONDS

    def test_blank_and_nonnumeric_fall_back(self, monkeypatch):
        for raw in ("", "   ", "abc", "12.5"):
            monkeypatch.setenv("LISTENER_STALENESS_SECONDS", raw)
            assert _staleness_threshold_seconds() == _DEFAULT_STALENESS_SECONDS

    def test_positive_value_is_returned(self, monkeypatch):
        monkeypatch.setenv("LISTENER_STALENESS_SECONDS", "300")
        assert _staleness_threshold_seconds() == 300

    def test_zero_and_negative_fall_back(self, monkeypatch):
        for raw in ("0", "-1", "-600"):
            monkeypatch.setenv("LISTENER_STALENESS_SECONDS", raw)
            assert _staleness_threshold_seconds() == _DEFAULT_STALENESS_SECONDS
