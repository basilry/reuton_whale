from __future__ import annotations

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

from src.distributor.formatters import (
    format_daily_brief,
    format_watchlist_confirmation,
    format_welcome_message,
)
from src.utils.errors import DistributorError
from src.utils.logger import get_logger

logger = get_logger("telegram_bot")


class WhaleScopeBot:
    def __init__(self, token: str, sheets_client: "SheetsClient"):
        self._token = token
        self._sheets = sheets_client
        self._app: Application | None = None

    def build(self) -> Application:
        self._app = (
            Application.builder()
            .token(self._token)
            .build()
        )
        self._app.add_handler(CommandHandler("start", self.handle_start))
        self._app.add_handler(CommandHandler("watchlist", self.handle_watchlist))
        self._app.add_handler(CommandHandler("pause", self.handle_pause))
        self._app.add_handler(CommandHandler("status", self.handle_status))
        return self._app

    async def send_daily_brief(self, brief_text: str) -> dict:
        if self._app is None:
            raise DistributorError("Bot not built. Call build() first.")

        subscribers = self._sheets.get_active_subscribers()
        result = {"sent": 0, "failed": 0, "blocked": 0}

        for sub in subscribers:
            chat_id = sub.get("chat_id")
            if not chat_id:
                result["failed"] += 1
                continue

            watchlist = sub.get("watchlist")
            text = brief_text if not watchlist else self._filter_brief(brief_text, watchlist)

            try:
                await self._app.bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    parse_mode=ParseMode.HTML,
                )
                result["sent"] += 1
            except Exception as exc:
                if "blocked" in str(exc).lower() or "deactivated" in str(exc).lower():
                    result["blocked"] += 1
                    logger.info("User %s blocked the bot", chat_id)
                else:
                    result["failed"] += 1
                    logger.warning("Failed to send to %s: %s", chat_id, exc)

        logger.info(
            "Daily brief sent: %d ok, %d failed, %d blocked",
            result["sent"],
            result["failed"],
            result["blocked"],
        )
        return result

    def _filter_brief(self, brief_text: str, watchlist: list[str]) -> str:
        return brief_text

    async def handle_start(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        chat_id = update.effective_chat.id
        username = update.effective_user.username or ""

        try:
            self._sheets.add_subscriber(chat_id=chat_id, username=username)
        except Exception as exc:
            logger.warning("Failed to register subscriber %s: %s", chat_id, exc)
            raise DistributorError(f"Subscriber registration failed: {exc}") from exc

        await update.message.reply_text(
            format_welcome_message(), parse_mode=ParseMode.HTML
        )

    async def handle_watchlist(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        chat_id = update.effective_chat.id
        args = context.args or []

        if not args:
            current = self._sheets.get_watchlist(chat_id=chat_id)
            if current:
                text = format_watchlist_confirmation(current)
            else:
                text = "No watchlist set. Usage: /watchlist ETH BTC SOL"
            await update.message.reply_text(text, parse_mode=ParseMode.HTML)
            return

        coins = [c.upper() for c in args]
        self._sheets.set_watchlist(chat_id=chat_id, coins=coins)
        await update.message.reply_text(
            format_watchlist_confirmation(coins), parse_mode=ParseMode.HTML
        )

    async def handle_pause(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        chat_id = update.effective_chat.id
        self._sheets.set_status(chat_id=chat_id, status="paused")
        await update.message.reply_text("Notifications paused. Send /start to resume.")

    async def handle_status(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        chat_id = update.effective_chat.id
        info = self._sheets.get_subscriber_info(chat_id=chat_id)

        if not info:
            await update.message.reply_text("Not subscribed. Send /start to begin.")
            return

        status = info.get("status", "unknown")
        watchlist = info.get("watchlist", [])
        last_brief = info.get("last_brief_at", "N/A")

        wl_text = ", ".join(watchlist) if watchlist else "all coins"
        text = (
            f"<b>Subscription Status</b>\n\n"
            f"Status: {status}\n"
            f"Watchlist: {wl_text}\n"
            f"Last brief: {last_brief}"
        )
        await update.message.reply_text(text, parse_mode=ParseMode.HTML)
