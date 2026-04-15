from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter

from src.distributor.formatters import (
    format_daily_brief,
    format_watchlist_confirmation,
    format_welcome_message,
    _format_usd,
    _importance_bar,
)
from src.storage.sheets_client import SheetsClient
from src.signals.models import Signal


def _signal(rule="cex_outflow_spike", score=8.0):
    now = datetime(2026, 4, 15, tzinfo=timezone.utc)
    return Signal(
        signal_id=f"{rule}-1",
        rule=rule,
        severity="high",
        score=score,
        confidence="high",
        source="chain",
        evidence_tx_hashes=["0xabc"],
        window_start=now,
        window_end=now,
        summary=f"{rule} summary",
    )


class TestFormatUsd:
    def test_millions(self):
        assert _format_usd(5_500_000) == "$5.5M"

    def test_thousands(self):
        assert _format_usd(2_500) == "$2.5K"

    def test_small(self):
        assert _format_usd(99) == "$99"


class TestImportanceBar:
    def test_full(self):
        bar = _importance_bar(10)
        assert len(bar) == 10
        assert bar.count("\u2588") == 10

    def test_empty(self):
        bar = _importance_bar(0)
        assert len(bar) == 10
        assert bar.count("\u2591") == 10

    def test_clamp_above(self):
        bar = _importance_bar(15)
        assert len(bar) == 10
        assert bar.count("\u2588") == 10

    def test_mid(self):
        bar = _importance_bar(5)
        assert len(bar) == 10


class TestFormatDailyBrief:
    def test_empty_korean(self):
        result = format_daily_brief([])
        assert "주목할 만한" in result

    def test_with_briefs(self):
        briefs = [
            {"symbol": "BTC", "amount_usd": 50_000_000, "importance_score": 8, "analysis": "큰 움직임"}
        ]
        result = format_daily_brief(briefs)
        assert "BTC" in result
        assert "큰 움직임" in result
        assert "8/10" in result

    def test_watchlist_star(self):
        briefs = [{"symbol": "ETH", "amount_usd": 10_000_000, "importance_score": 5}]
        result = format_daily_brief(briefs, watchlist=["eth"])
        assert "\u2b50" in result


class TestFormatWelcomeMessage:
    def test_contains_commands(self):
        msg = format_welcome_message()
        assert "/watchlist" in msg
        assert "/pause" in msg
        assert "/status" in msg

    def test_is_korean(self):
        msg = format_welcome_message()
        assert "환영" in msg


class TestFormatWatchlistConfirmation:
    def test_with_coins(self):
        result = format_watchlist_confirmation(["btc", "eth"])
        assert "BTC" in result
        assert "ETH" in result

    def test_cleared_korean(self):
        result = format_watchlist_confirmation([])
        assert "모든 코인" in result


class TestFilterBrief:
    def _bot(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        return WhaleScopeBot(token="x", sheets_client=MagicMock(spec=SheetsClient))

    def test_empty_watchlist_returns_original(self):
        bot = self._bot()
        text = "- 500 ETH to Binance"
        assert bot._filter_brief(text, []) == text

    def test_marks_matching_lines(self):
        bot = self._bot()
        text = "- 500 ETH to Binance\n- 100 BTC to cold wallet\n- 200 SOL burn"
        result = bot._filter_brief(text, ["ETH", "SOL"])
        lines = result.splitlines()
        assert lines[0].startswith("\u2b50")
        assert not lines[1].startswith("\u2b50")
        assert lines[2].startswith("\u2b50")

    def test_word_boundary_no_partial_match(self):
        bot = self._bot()
        # "BNB" shouldn't match "BN" in text like "Binance BNB"
        text = "- 500 BNBX to somewhere"
        result = bot._filter_brief(text, ["BNB"])
        assert "\u2b50" not in result

    def test_case_insensitive_via_upper(self):
        bot = self._bot()
        text = "- 500 ETH to Binance"
        result = bot._filter_brief(text, ["eth"])
        assert result.startswith("\u2b50")


class TestWhaleScopeBot:
    @pytest.mark.asyncio
    async def test_send_daily_brief_no_build_raises(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        from src.utils.errors import DistributorError

        sheets_mock = MagicMock(spec=SheetsClient)
        bot = WhaleScopeBot(token="test", sheets_client=sheets_mock)
        with pytest.raises(DistributorError, match="not built"):
            await bot.send_daily_brief("test brief")

    @patch("src.distributor.telegram_bot.Application")
    def test_build_registers_handlers(self, mock_app_cls):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=MagicMock(spec=SheetsClient))
        bot.build()
        assert mock_app.add_handler.call_count == 4

    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_success(self, mock_app_cls):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock()

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 123, "watchlist": []},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result["sent"] == 1
        assert result["failed"] == 0
        assert result["blocked"] == 0

    @patch("src.utils.retry.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_retry_after_then_success(self, mock_app_cls, mock_sleep):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock(side_effect=[RetryAfter(2), None])

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 123, "watchlist": []},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result == {"sent": 1, "failed": 0, "blocked": 0}
        assert mock_app.bot.send_message.call_count == 2
        mock_sleep.assert_awaited_once_with(2.0)

    @patch("src.utils.retry.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_network_error_exhausts_retries(self, mock_app_cls, mock_sleep):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock(
            side_effect=[NetworkError("network"), NetworkError("network"), NetworkError("network")]
        )

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 123, "watchlist": []},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result == {"sent": 0, "failed": 1, "blocked": 0}
        assert mock_app.bot.send_message.call_count == 3
        assert mock_sleep.await_count == 2

    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_applies_filter_when_watchlist(self, mock_app_cls):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        send_mock = AsyncMock()
        mock_app.bot.send_message = send_mock

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 123, "watchlist": ["ETH"]},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        await bot.send_daily_brief("- 500 ETH transfer\n- 10 BTC transfer")
        sent_text = send_mock.call_args.kwargs["text"]
        assert "\u2b50" in sent_text

    @patch("src.utils.retry.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_forbidden_user_blocked(self, mock_app_cls, mock_sleep):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock(side_effect=Forbidden("Forbidden: bot was blocked"))

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 456, "watchlist": []},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result["blocked"] == 1
        assert result["sent"] == 0
        assert result["failed"] == 0
        assert mock_app.bot.send_message.call_count == 1
        mock_sleep.assert_not_awaited()

    @patch("src.utils.retry.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_chat_not_found_blocked(self, mock_app_cls, mock_sleep):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock(side_effect=BadRequest("Chat not found"))

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 789, "watchlist": []},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result == {"sent": 0, "failed": 0, "blocked": 1}
        assert mock_app.bot.send_message.call_count == 1
        mock_sleep.assert_not_awaited()

    @patch("src.utils.retry.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_isolates_subscribers(self, mock_app_cls, mock_sleep):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock(
            side_effect=[NetworkError("network"), NetworkError("network"), NetworkError("network"), None]
        )

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 111, "watchlist": []},
            {"chat_id": 222, "watchlist": []},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result == {"sent": 1, "failed": 1, "blocked": 0}
        assert mock_app.bot.send_message.call_count == 4
        assert mock_sleep.await_count == 2

    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_personalizes_signals_per_subscriber(self, mock_app_cls):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock()

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 111, "watchlist": []},
            {"chat_id": 222, "watchlist": []},
        ]
        sheets_mock.list_user_interests.side_effect = [
            [{"dimension": "rule", "value": "cex_outflow_spike", "weight": "1.0"}],
            [{"dimension": "rule", "value": "cold_to_hot_transfer", "weight": "1.0"}],
        ]

        cex_signal = _signal("cex_outflow_spike", 9.0)
        cold_signal = _signal("cold_to_hot_transfer", 7.0)

        def personalize(signals, interests):
            rule = interests[0]["rule"]
            return [sig for sig in signals if sig.rule == rule]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(
            token="test-token",
            sheets_client=sheets_mock,
            personalize_fn=personalize,
        )
        bot.build()

        result = await bot.send_daily_brief(
            "generic brief",
            signals=[cex_signal, cold_signal],
        )

        assert result == {"sent": 2, "failed": 0, "blocked": 0}
        sent_texts = [call.kwargs["text"] for call in mock_app.bot.send_message.call_args_list]
        assert "generic brief" in sent_texts[0]
        assert "generic brief" in sent_texts[1]
        assert "<b>관심 시그널</b>" in sent_texts[0]
        assert "<b>관심 시그널</b>" in sent_texts[1]
        assert "cex_outflow_spike summary" in sent_texts[0]
        assert "cold_to_hot_transfer summary" in sent_texts[1]
        sheets_mock.list_user_interests.assert_any_call("111")
        sheets_mock.list_user_interests.assert_any_call("222")

    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_signals_without_interests_keeps_base_brief(self, mock_app_cls):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock()

        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": 111, "watchlist": []},
        ]
        sheets_mock.list_user_interests.return_value = [
            {"dimension": "rule", "value": "cold_to_hot_transfer", "weight": "1.0"}
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(
            token="test-token",
            sheets_client=sheets_mock,
            personalize_fn=lambda signals, interests: [],
        )
        bot.build()

        result = await bot.send_daily_brief(
            "generic brief",
            signals=[_signal("cex_outflow_spike")],
        )

        assert result == {"sent": 1, "failed": 0, "blocked": 0}
        sent_text = mock_app.bot.send_message.call_args.kwargs["text"]
        assert sent_text.startswith("generic brief")
        assert "관심 기준" in sent_text
        assert "추가로 관심 기준에 맞는 시그널은 없었습니다." in sent_text

    @pytest.mark.asyncio
    async def test_handle_start_calls_add_subscriber(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.effective_user.username = "testuser"
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot.handle_start(update, context)
        sheets_mock.add_subscriber.assert_called_once_with(chat_id=999, username="testuser")
        update.message.reply_text.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_watchlist_set(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["btc", "eth"]

        await bot.handle_watchlist(update, context)
        sheets_mock.set_watchlist.assert_called_once_with(chat_id=999, coins=["BTC", "ETH"])

    @pytest.mark.asyncio
    async def test_handle_watchlist_view_existing(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_watchlist.return_value = ["BTC"]
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = []

        await bot.handle_watchlist(update, context)
        reply_text = update.message.reply_text.call_args[0][0]
        assert "BTC" in reply_text

    @pytest.mark.asyncio
    async def test_handle_watchlist_view_empty_korean(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_watchlist.return_value = []
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = []

        await bot.handle_watchlist(update, context)
        reply_text = update.message.reply_text.call_args[0][0]
        assert "관심 코인" in reply_text

    @pytest.mark.asyncio
    async def test_handle_pause_korean(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot.handle_pause(update, context)
        sheets_mock.set_status.assert_called_once_with(chat_id=999, status="paused")
        reply_text = update.message.reply_text.call_args[0][0]
        assert "일시중지" in reply_text

    @pytest.mark.asyncio
    async def test_handle_status_subscribed(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_subscriber_info.return_value = {
            "chat_id": 999,
            "status": "active",
            "watchlist": ["BTC", "ETH"],
            "last_brief_at": "2026-04-14",
        }
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot.handle_status(update, context)
        reply_text = update.message.reply_text.call_args[0][0]
        assert "활성" in reply_text
        assert "BTC" in reply_text
        assert "구독 상태" in reply_text

    @pytest.mark.asyncio
    async def test_handle_status_not_subscribed_korean(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock(spec=SheetsClient)
        sheets_mock.get_subscriber_info.return_value = None
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot.handle_status(update, context)
        reply_text = update.message.reply_text.call_args[0][0]
        assert "구독" in reply_text
