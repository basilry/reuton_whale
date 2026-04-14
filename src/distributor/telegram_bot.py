from __future__ import annotations

import re

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
        if not watchlist:
            return brief_text
        symbols = [re.escape(c.upper()) for c in watchlist if c]
        if not symbols:
            return brief_text
        pattern = re.compile(rf"\b({'|'.join(symbols)})\b")
        lines = []
        for line in brief_text.splitlines():
            if pattern.search(line):
                stripped = line.lstrip()
                indent = line[: len(line) - len(stripped)]
                lines.append(f"{indent}\u2b50 {stripped}")
            else:
                lines.append(line)
        return "\n".join(lines)

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
                text = "설정된 관심 코인이 없습니다. 사용법: /watchlist ETH BTC SOL"
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
        await update.message.reply_text(
            "알림이 일시중지되었습니다. 다시 시작하려면 /start 를 입력하세요."
        )

    async def handle_status(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        chat_id = update.effective_chat.id
        info = self._sheets.get_subscriber_info(chat_id=chat_id)

        if not info:
            await update.message.reply_text(
                "구독되어 있지 않습니다. 시작하려면 /start 를 입력하세요."
            )
            return

        status_map = {"active": "활성", "paused": "일시중지"}
        status_raw = info.get("status", "")
        status_text = status_map.get(status_raw, status_raw or "알 수 없음")
        watchlist = info.get("watchlist", [])
        last_brief = info.get("last_brief_at") or "없음"

        wl_text = ", ".join(watchlist) if watchlist else "전체 코인"
        text = (
            f"<b>구독 상태</b>\n\n"
            f"상태: {status_text}\n"
            f"관심 코인: {wl_text}\n"
            f"최근 브리프: {last_brief}"
        )
        await update.message.reply_text(text, parse_mode=ParseMode.HTML)
