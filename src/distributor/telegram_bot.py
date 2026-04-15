from __future__ import annotations

import datetime as dt
import random
import re
from collections.abc import Callable

from telegram import Update
from telegram.constants import ParseMode
from telegram.error import BadRequest, Forbidden, NetworkError, RetryAfter, TimedOut
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

from src.distributor.formatters import (
    format_watchlist_confirmation,
    format_welcome_message,
)
from src.signals.models import Signal
from src.utils.errors import DistributorError
from src.utils.logger import get_logger
from src.utils.retry import async_retry

logger = get_logger("telegram_bot")


class WhaleScopeBot:
    def __init__(
        self,
        token: str,
        sheets_client: "SheetsClient",
        personalize_fn: Callable[[list[Signal], list[dict]], list[Signal]] | None = None,
    ):
        self._token = token
        self._sheets = sheets_client
        self._personalize_fn = personalize_fn
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

    async def send_daily_brief(
        self,
        brief_text: str,
        signals: list[Signal] | None = None,
    ) -> dict:
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
            text = self._brief_for_subscriber(chat_id, brief_text, signals, watchlist)

            try:
                await async_retry(
                    lambda: self._app.bot.send_message(
                        chat_id=chat_id,
                        text=text,
                        parse_mode=ParseMode.HTML,
                    ),
                    max_attempts=3,
                    base_delay=2.0,
                    max_delay=30.0,
                    delay_for_exception=self._retry_delay_for_send,
                    should_retry=self._should_retry_send_error,
                )
                result["sent"] += 1
            except Exception as exc:
                if self._is_blocked_send_error(exc):
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

    def _brief_for_subscriber(
        self,
        chat_id: int,
        brief_text: str,
        signals: list[Signal] | None,
        watchlist: list[str] | None,
    ) -> str:
        base_brief = brief_text if not watchlist else self._filter_brief(brief_text, watchlist)
        if signals is None or self._personalize_fn is None:
            return base_brief

        interests = self._load_signal_interests(chat_id)
        personalized = self._personalize_fn(signals, interests)
        if not personalized:
            return "\n\n".join([
                base_brief,
                "<i>추가로 관심 기준에 맞는 시그널은 없었습니다.</i>",
            ])
        return self._append_personalized_signals(base_brief, personalized)

    def _load_signal_interests(self, chat_id: int) -> list[dict]:
        try:
            raw = self._sheets.list_user_interests(str(chat_id))
        except Exception as exc:
            logger.warning("Failed to load interests for %s: %s", chat_id, exc)
            return []

        interests: list[dict] = []
        for item in raw:
            normalized = dict(item)
            if "rule" not in normalized and normalized.get("dimension") == "rule":
                normalized["rule"] = normalized.get("value", "")
            if "weight" in normalized:
                try:
                    normalized["weight"] = float(normalized["weight"])
                except (TypeError, ValueError):
                    normalized["weight"] = 1.0
            interests.append(normalized)
        return interests

    def _append_personalized_signals(
        self, base_brief: str, signals: list[Signal]
    ) -> str:
        return "\n\n".join([
            base_brief,
            self._format_signal_brief(signals),
        ])

    def _format_signal_brief(self, signals: list[Signal]) -> str:
        cards = ["<b>관심 시그널</b>"]
        for sig in sorted(signals, key=lambda s: s.score, reverse=True):
            cards.append(
                "\n".join([
                    f"<b>{sig.rule}</b>",
                    f"심각도: {sig.severity} / 신뢰도: {sig.confidence}",
                    f"점수: {sig.score}/10",
                    sig.summary,
                ])
            )
        return "\n\n".join(cards)

    def _retry_delay_for_send(self, exc: Exception, attempt: int) -> float:
        if isinstance(exc, RetryAfter):
            retry_after = exc.retry_after
            if isinstance(retry_after, dt.timedelta):
                return retry_after.total_seconds()
            return float(retry_after)

        base_delay = min(2.0 * (2 ** (attempt - 1)), 30.0)
        return min(random.uniform(base_delay * 0.8, base_delay * 1.2), 30.0)

    def _should_retry_send_error(self, exc: Exception) -> bool:
        if self._is_blocked_send_error(exc):
            return False
        return isinstance(exc, (RetryAfter, TimedOut, NetworkError))

    def _is_blocked_send_error(self, exc: Exception) -> bool:
        if isinstance(exc, Forbidden):
            return True

        message = str(exc).lower()
        if isinstance(exc, BadRequest):
            return "chat not found" in message

        return "blocked" in message or "deactivated" in message or "chat not found" in message

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
