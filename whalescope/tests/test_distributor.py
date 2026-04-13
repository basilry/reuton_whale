from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.distributor.formatters import (
    format_daily_brief,
    format_watchlist_confirmation,
    format_welcome_message,
    _format_usd,
    _importance_bar,
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
        bar = _importance_bar(1.0)
        assert len(bar) == 10

    def test_empty(self):
        bar = _importance_bar(0.0)
        assert len(bar) == 10

    def test_clamp_above(self):
        bar = _importance_bar(1.5)
        assert len(bar) == 10


class TestFormatDailyBrief:
    def test_empty(self):
        result = format_daily_brief([])
        assert "No significant" in result

    def test_with_briefs(self):
        briefs = [{"symbol": "BTC", "amount_usd": 50_000_000, "importance_score": 0.8, "analysis": "Big move"}]
        result = format_daily_brief(briefs)
        assert "BTC" in result
        assert "Big move" in result

    def test_watchlist_star(self):
        briefs = [{"symbol": "ETH", "amount_usd": 10_000_000, "importance_score": 0.5}]
        result = format_daily_brief(briefs, watchlist=["eth"])
        assert "\u2b50" in result


class TestFormatWelcomeMessage:
    def test_contains_commands(self):
        msg = format_welcome_message()
        assert "/watchlist" in msg
        assert "/pause" in msg
        assert "/status" in msg


class TestFormatWatchlistConfirmation:
    def test_with_coins(self):
        result = format_watchlist_confirmation(["btc", "eth"])
        assert "BTC" in result
        assert "ETH" in result

    def test_cleared(self):
        result = format_watchlist_confirmation([])
        assert "cleared" in result.lower()


class TestWhaleScopeBot:
    @pytest.mark.asyncio
    async def test_send_daily_brief_no_build_raises(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        from src.utils.errors import DistributorError

        sheets_mock = MagicMock()
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
        bot = WhaleScopeBot(token="test-token", sheets_client=MagicMock())
        app = bot.build()
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

        sheets_mock = MagicMock()
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": "123", "watchlist": None},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result["sent"] == 1
        assert result["failed"] == 0

    @patch("src.distributor.telegram_bot.Application")
    @pytest.mark.asyncio
    async def test_send_daily_brief_blocked_user(self, mock_app_cls):
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.token.return_value = mock_builder
        mock_builder.build.return_value = mock_app
        mock_app_cls.builder.return_value = mock_builder
        mock_app.bot.send_message = AsyncMock(side_effect=Exception("Forbidden: bot was blocked"))

        sheets_mock = MagicMock()
        sheets_mock.get_active_subscribers.return_value = [
            {"chat_id": "456"},
        ]

        from src.distributor.telegram_bot import WhaleScopeBot
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)
        bot.build()

        result = await bot.send_daily_brief("test brief")
        assert result["blocked"] == 1
        assert result["sent"] == 0

    @pytest.mark.asyncio
    async def test_handle_start(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock()
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
        sheets_mock = MagicMock()
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = ["btc", "eth"]

        await bot.handle_watchlist(update, context)
        sheets_mock.set_watchlist.assert_called_once_with(chat_id=999, coins=["BTC", "ETH"])

    @pytest.mark.asyncio
    async def test_handle_watchlist_view(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock()
        sheets_mock.get_watchlist.return_value = ["BTC"]
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()
        context.args = []

        await bot.handle_watchlist(update, context)
        update.message.reply_text.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_pause(self):
        from src.distributor.telegram_bot import WhaleScopeBot
        sheets_mock = MagicMock()
        bot = WhaleScopeBot(token="test-token", sheets_client=sheets_mock)

        update = MagicMock()
        update.effective_chat.id = 999
        update.message.reply_text = AsyncMock()
        context = MagicMock()

        await bot.handle_pause(update, context)
        sheets_mock.set_status.assert_called_once_with(chat_id=999, status="paused")
