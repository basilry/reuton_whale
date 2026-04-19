"""Telethon listener with regex parse + LLM fallback for on-chain alert channels."""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone

from src.ingestion.tg_normalizer import get_tg_channel_profile, normalize_tg_channel_handle
from src.observability.service_health import append_service_heartbeat, build_heartbeat_key
from src.utils.logger import get_logger

logger = get_logger("telethon_listener")

_DEFAULT_STALENESS_SECONDS = 900
_HEARTBEAT_INTERVAL_SECONDS = 300


def _staleness_threshold_seconds() -> int:
    """Read LISTENER_STALENESS_SECONDS with safe fallback.

    Falls back to _DEFAULT_STALENESS_SECONDS when:
      - the env var is unset or blank, or
      - the value fails int() parsing, or
      - the value is <= 0.
    """
    raw = os.getenv("LISTENER_STALENESS_SECONDS")
    if raw is None or not raw.strip():
        return _DEFAULT_STALENESS_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_STALENESS_SECONDS
    return value if value > 0 else _DEFAULT_STALENESS_SECONDS

# Matches: "1,000,000 #USDT (1,012,450 USD) transferred from #Binance to #unknown"
_MSG_RE = re.compile(
    r"(?P<amount>[\d,]+(?:\.\d+)?)\s+#?(?P<symbol>[A-Z0-9]+)"
    r"\s+\((?P<amount_usd>[\d,]+(?:\.\d+)?)\s+USD\)"
    r"\s+transferred\s+from\s+#?(?P<from_owner>\w+)\s+to\s+#?(?P<to_owner>\w+)",
    re.IGNORECASE,
)
_CHAIN_RE = re.compile(
    r"#(ethereum|bitcoin|tron|stellar|solana|polygon|ripple|eos|cardano|bsc|bnb)",
    re.IGNORECASE,
)
_EXCHANGE_NAMES = frozenset(
    ["binance", "kraken", "coinbase", "bitfinex", "huobi", "okex", "kucoin",
     "upbit", "gemini", "robinhood", "bybit"]
)


def _parse_amount(s: str) -> float:
    return float(s.replace(",", ""))


def _owner_type(name: str) -> str:
    name_lower = name.lower().lstrip("#")
    if name_lower in ("unknown", "0x", ""):
        return "unknown"
    if name_lower in _EXCHANGE_NAMES:
        return "exchange"
    return "wallet"


def parse_tg_message(text: str) -> dict | None:
    """Parse a whale-alert style Telegram message. Returns dict or None on no match."""
    m = _MSG_RE.search(text)
    if not m:
        return None
    chain_m = _CHAIN_RE.search(text)
    from_owner = m.group("from_owner").lstrip("#")
    to_owner = m.group("to_owner").lstrip("#")
    return {
        "symbol": m.group("symbol").upper(),
        "amount": _parse_amount(m.group("amount")),
        "amount_usd": _parse_amount(m.group("amount_usd")),
        "from_owner": from_owner,
        "to_owner": to_owner,
        "from_owner_type": _owner_type(from_owner),
        "to_owner_type": _owner_type(to_owner),
        "blockchain": chain_m.group(1).lower() if chain_m else "unknown",
    }


class TelethonListener:
    def __init__(
        self,
        api_id: int,
        api_hash: str,
        session: str,
        storage,
        router=None,
        channel: str = "",
        phone: str = "",
        session_string: str = "",
    ) -> None:
        self._api_id = api_id
        self._api_hash = api_hash
        self._session = session
        self._storage = storage
        self._router = router
        self._channel = channel
        self._phone = phone
        self._session_string = session_string
        self._channel_profile = get_tg_channel_profile(channel)
        self._last_message_at: datetime | None = None
        self._last_heartbeat_at: datetime | None = None
        self._message_count: int = 0
        self._error_count: int = 0

    def health_status(self) -> dict:
        now = datetime.now(timezone.utc)
        last = self._last_message_at
        staleness = (now - last).total_seconds() if last else None
        threshold = _staleness_threshold_seconds()
        is_healthy = staleness is not None and staleness < threshold
        return {
            "status": "healthy" if is_healthy else "stale",
            "last_message_at": last.isoformat() if last else None,
            "staleness_seconds": staleness,
            "message_count": self._message_count,
            "error_count": self._error_count,
        }

    async def run(self) -> None:
        try:
            from telethon import TelegramClient, events  # noqa: PLC0415
            from telethon.errors import PhoneNumberInvalidError  # noqa: PLC0415
            from telethon.sessions import StringSession  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError("telethon is not installed") from exc

        session = StringSession(self._session_string) if self._session_string else self._session
        client = TelegramClient(session, self._api_id, self._api_hash)

        @client.on(events.NewMessage(chats=self._channel))
        async def _handler(event):
            try:
                await self._handle_message(event.id, event.date, event.raw_text or "")
            except Exception as exc:  # pragma: no cover - defensive logging path
                logger.exception("Unhandled listener error msg_id=%s: %s", event.id, exc)
                await self._record_system_log(
                    "error",
                    "telethon_listener",
                    {
                        "event": "message_error",
                        "stage": "handler",
                        "msg_id": event.id,
                        "error": str(exc),
                    },
                )

        await client.connect()
        try:
            if not await client.is_user_authorized():
                await self._record_system_log(
                    "error",
                    "telethon_listener",
                    {
                        "event": "auth_error",
                        "reason": "session_not_authenticated",
                        "channel": self._channel,
                    },
                )
                await self._record_service_heartbeat(
                    status="error",
                    event="auth_error",
                    error="session_not_authenticated",
                )
                if not self._phone:
                    raise RuntimeError(
                        "Telethon session is not authenticated. "
                        "Run once with TELETHON_PHONE in international format, "
                        "for example TELETHON_PHONE=+821012345678, or provide "
                        "TELETHON_SESSION_STRING for non-interactive workers."
                    )

                try:
                    await client.start(phone=self._phone)
                except PhoneNumberInvalidError as exc:
                    await self._record_system_log(
                        "error",
                        "telethon_listener",
                        {
                            "event": "auth_error",
                            "reason": "invalid_phone",
                            "channel": self._channel,
                        },
                    )
                    await self._record_service_heartbeat(
                        status="error",
                        event="auth_error",
                        error="invalid_phone",
                    )
                    raise RuntimeError(
                        "Invalid TELETHON_PHONE. Use international E.164 format "
                        "with country code, for example +821012345678. "
                        "Do not use a leading local 0 or hyphens."
                    ) from exc

            logger.info("Listening on channel=%r", self._channel)
            await self._record_system_log(
                "info",
                "telethon_listener",
                {
                    "event": "listener_start",
                    "channel": self._channel,
                    "session": self._session,
                    "session_string": "set" if self._session_string else "unset",
                },
            )
            await self._record_service_heartbeat(status="ok", event="listener_start", force=True)
            await client.run_until_disconnected()
        finally:
            await client.disconnect()

    async def _handle_message(self, msg_id: int, msg_date, text: str) -> None:
        self._last_message_at = datetime.now(timezone.utc)
        self._message_count += 1

        parsed = parse_tg_message(text)
        confidence = "high"

        if parsed is None and self._router is not None:
            try:
                result = await asyncio.to_thread(
                    self._router.call_task,
                    "nl_intent",
                    system=(
                        "Extract whale transaction details from a Telegram message. "
                        "Return JSON with keys: symbol, amount, amount_usd, "
                        "from_owner, to_owner, from_owner_type, to_owner_type, blockchain."
                    ),
                    user=text,
                )
                parsed = json.loads(result.text)
                confidence = "low"
            except Exception as exc:
                logger.warning("LLM fallback failed msg_id=%s: %s", msg_id, exc)

        if parsed is None:
            logger.debug("Unparseable message id=%s", msg_id)
            return

        tg_date = msg_date.isoformat() if hasattr(msg_date, "isoformat") else str(msg_date)
        external_channel_handle = (
            normalize_tg_channel_handle(self._channel)
            or str(self._channel_profile.get("handle") or "").strip()
        )
        external_display_name = str(self._channel_profile.get("display_name") or "").strip()
        external_confidence = str(self._channel_profile.get("confidence") or "medium").strip().lower()
        event_row = {
            "tg_msg_id": str(msg_id),
            "tg_date": tg_date,
            "blockchain": parsed.get("blockchain", "unknown"),
            "symbol": parsed.get("symbol", ""),
            "amount": parsed.get("amount", 0),
            "amount_usd": parsed.get("amount_usd", 0),
            "from_owner_type": parsed.get("from_owner_type", "unknown"),
            "from_owner": parsed.get("from_owner", "unknown"),
            "to_owner_type": parsed.get("to_owner_type", "unknown"),
            "to_owner": parsed.get("to_owner", "unknown"),
            "raw_text": text,
            "parsed_confidence": confidence,
            "external_channel": external_channel_handle,
            "external_display_name": external_display_name,
            "external_confidence": external_confidence,
            "collected_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            await asyncio.to_thread(self._storage.append_tg_whale_event, event_row)
            await self._record_service_heartbeat(status="ok", event="message_processed")
            await self._record_system_log(
                "info",
                "telethon_listener",
                {
                    "event": "message_processed",
                    "msg_id": msg_id,
                    "symbol": event_row["symbol"],
                    "blockchain": event_row["blockchain"],
                    "confidence": confidence,
                    "stored": True,
                },
            )
        except Exception as exc:
            self._error_count += 1
            logger.error("Storage failed msg_id=%s: %s", msg_id, exc)
            await self._record_system_log(
                "error",
                "telethon_listener",
                {
                    "event": "message_error",
                    "stage": "storage",
                    "msg_id": msg_id,
                    "error": str(exc),
                },
            )
            await self._record_service_heartbeat(
                status="error",
                event="message_error",
                error=str(exc),
                force=True,
            )

    async def _record_system_log(self, level: str, category: str, payload: dict) -> None:
        if self._storage is None:
            return
        try:
            await asyncio.to_thread(self._storage.append_system_log, level, category, payload)
        except Exception as exc:
            logger.warning(
                "System log append failed level=%s category=%s: %s",
                level,
                category,
                exc,
            )

    async def _record_service_heartbeat(
        self,
        *,
        status: str,
        event: str,
        error: str = "",
        force: bool = False,
    ) -> None:
        if self._storage is None or not hasattr(self._storage, "append_service_health"):
            return

        now = datetime.now(timezone.utc)
        if (
            not force
            and self._last_heartbeat_at is not None
            and (now - self._last_heartbeat_at).total_seconds() < _HEARTBEAT_INTERVAL_SECONDS
        ):
            return

        details = self.health_status()
        details["channel"] = self._channel
        details["event"] = event
        try:
            await asyncio.to_thread(
                append_service_heartbeat,
                self._storage,
                service="telegram.listener",
                component="listener",
                status=status,
                heartbeat_key=build_heartbeat_key("telegram.listener", self._channel, now.strftime("%Y%m%dT%H%M")),
                details=details,
                error=error,
                observed_at=now,
                job_name=event,
                processed_count=self._message_count,
                source_name="telegram_channel",
            )
            self._last_heartbeat_at = now
        except Exception as exc:
            logger.warning("Listener heartbeat append failed event=%s: %s", event, exc)
