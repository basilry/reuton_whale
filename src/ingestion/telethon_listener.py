"""Telethon listener with regex parse + LLM fallback for on-chain alert channels."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from src.utils.logger import get_logger

logger = get_logger("telethon_listener")

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
    ) -> None:
        self._api_id = api_id
        self._api_hash = api_hash
        self._session = session
        self._storage = storage
        self._router = router
        self._channel = channel

    async def run(self) -> None:
        try:
            from telethon import TelegramClient, events  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError("telethon is not installed") from exc

        client = TelegramClient(self._session, self._api_id, self._api_hash)

        @client.on(events.NewMessage(chats=self._channel))
        async def _handler(event):
            await self._handle_message(event.id, event.date, event.raw_text or "")

        logger.info("Listening on channel=%r", self._channel)
        async with client:
            await client.run_until_disconnected()

    async def _handle_message(self, msg_id: int, msg_date, text: str) -> None:
        parsed = parse_tg_message(text)
        confidence = "high"

        if parsed is None and self._router is not None:
            try:
                result = self._router.call_task(
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
            "collected_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            self._storage.append_tg_whale_event(event_row)
        except Exception as exc:
            logger.error("Storage failed msg_id=%s: %s", msg_id, exc)
