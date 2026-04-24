#!/usr/bin/env python3
"""Run TelethonListener for on-chain alert Telegram channels.

Usage:
    python scripts/run_listener.py
    python scripts/run_listener.py --dry-run
    TG_CHANNEL=@my_channel python scripts/run_listener.py

Environment variables required (non-dry-run):
    TELETHON_API_ID, TELETHON_API_HASH, TELETHON_SESSION
    TELETHON_PHONE for first local login, or TELETHON_SESSION_STRING for workers
    TG_CHANNEL
    GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON when STORAGE_BACKEND=sheets
    or DATABASE_URL when STORAGE_BACKEND=postgres
Optional:
    ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY for LLM fallback parsing
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import has_llm_provider, load_listener_config
from src.ingestion.telethon_listener import TelethonListener, parse_tg_message
from src.main import _build_router
from src.storage.factory import build_storage_client
from src.utils.logger import get_logger

logger = get_logger("run_listener")


def _should_show_login_hint(exc: RuntimeError) -> bool:
    message = str(exc).lower()
    return any(
        token in message
        for token in (
            "session is not authenticated",
            "invalid telethon_phone",
            "telethon phone",
            "phone number invalid",
        )
    )


async def _dry_run():
    samples = [
        "🚨 1,000,000 #USDT (1,012,450 USD) transferred from #Binance to #unknown",
        "🐳 500 #BTC (30,000,000 USD) transferred from #unknown to #Kraken",
        "150,000,000 #XRP (75,000,000 USD) transferred from #Ripple to #Bitfinex",
    ]
    print("dry-run: testing message parser")
    for msg in samples:
        result = parse_tg_message(msg)
        print(f"  input : {msg[:60]}")
        print(f"  parsed: {result}")
        print()
    print("dry-run OK")


async def _run():
    config = load_listener_config()

    if not config.telethon_api_id or not config.telethon_api_hash:
        logger.error("TELETHON_API_ID / TELETHON_API_HASH not set")
        sys.exit(1)

    channel = os.getenv("TG_CHANNEL", "")
    if not channel:
        logger.error("TG_CHANNEL env var not set (e.g. export TG_CHANNEL=@some_channel)")
        sys.exit(1)

    if config.telethon_phone and not config.telethon_phone.startswith("+"):
        logger.error(
            "TELETHON_PHONE must use international E.164 format, "
            "for example +821012345678. Do not use a leading local 0."
        )
        sys.exit(1)

    sheets = build_storage_client()
    router = _build_router(config) if has_llm_provider(config) else None
    if router is None:
        logger.info("No LLM provider configured; listener will use regex parsing only")

    listener = TelethonListener(
        api_id=config.telethon_api_id,
        api_hash=config.telethon_api_hash,
        session=config.telethon_session,
        storage=sheets,
        router=router,
        channel=channel,
        phone=config.telethon_phone,
        session_string=config.telethon_session_string,
    )

    logger.info(
        "Starting TelethonListener channel=%s session=%s session_string=%s",
        channel,
        config.telethon_session,
        "set" if config.telethon_session_string else "unset",
    )

    async def _heartbeat_loop():
        while True:
            await asyncio.sleep(300)
            status = listener.health_status()
            logger.info("Listener health: %s", status)
            if status["status"] == "stale":
                logger.warning("Listener stale for %ss", status["staleness_seconds"])

    asyncio.get_event_loop().create_task(_heartbeat_loop())
    await listener.run()


def main():
    parser = argparse.ArgumentParser(description="Run Telethon on-chain alert listener")
    parser.add_argument("--dry-run", action="store_true", help="Test parser without connecting")
    args = parser.parse_args()

    try:
        if args.dry_run:
            asyncio.run(_dry_run())
        else:
            asyncio.run(_run())
    except KeyboardInterrupt:
        logger.info("Listener stopped by user")
    except RuntimeError as exc:
        logger.error("%s", exc)
        if _should_show_login_hint(exc):
            logger.error(
                "First local login example: "
                "TELETHON_PHONE=+821012345678 TG_CHANNEL=@whale_alert_io python scripts/run_listener.py"
            )
        sys.exit(1)


if __name__ == "__main__":
    main()
