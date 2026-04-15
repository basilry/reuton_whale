#!/usr/bin/env python3
"""Run TelethonListener for on-chain alert Telegram channels.

Usage:
    python scripts/run_listener.py
    python scripts/run_listener.py --dry-run
    TG_CHANNEL=@my_channel python scripts/run_listener.py

Environment variables required (non-dry-run):
    TELETHON_API_ID, TELETHON_API_HASH, TELETHON_SESSION
    TG_CHANNEL
    One LLM provider key: ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY
    GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON (storage)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import load_config
from src.ingestion.telethon_listener import TelethonListener, parse_tg_message
from src.main import _build_router
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

logger = get_logger("run_listener")


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
    config = load_config()

    if not config.telethon_api_id or not config.telethon_api_hash:
        logger.error("TELETHON_API_ID / TELETHON_API_HASH not set")
        sys.exit(1)

    channel = os.getenv("TG_CHANNEL", "")
    if not channel:
        logger.error("TG_CHANNEL env var not set (e.g. export TG_CHANNEL=@some_channel)")
        sys.exit(1)

    sheets = SheetsClient(config.sheet_id, config.google_credentials)
    router = _build_router(config)  # LLM fallback for NL-intent parsing

    listener = TelethonListener(
        api_id=config.telethon_api_id,
        api_hash=config.telethon_api_hash,
        session=config.telethon_session,
        storage=sheets,
        router=router,
        channel=channel,
    )

    logger.info(
        "Starting TelethonListener channel=%s session=%s",
        channel,
        config.telethon_session,
    )
    await listener.run()


def main():
    parser = argparse.ArgumentParser(description="Run Telethon on-chain alert listener")
    parser.add_argument("--dry-run", action="store_true", help="Test parser without connecting")
    args = parser.parse_args()

    if args.dry_run:
        asyncio.run(_dry_run())
    else:
        asyncio.run(_run())


if __name__ == "__main__":
    main()
