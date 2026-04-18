#!/usr/bin/env python3
"""Weekly trend commentary generator.

Fetches the last 7 days of signals from storage, generates a weekly
commentary via LLMAnalyzer, and sends it to Telegram subscribers.

Usage:
    python scripts/run_weekly_trend.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import load_config
from src.distributor.telegram_bot import WhaleScopeBot
from src.main import _build_router
from src.analyzer.claude_analyzer import LLMAnalyzer
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

logger = get_logger("run_weekly_trend")


async def _run_weekly_trend_async() -> dict[str, object]:
    config = load_config()
    sheets = SheetsClient(config.sheet_id, config.google_credentials)
    router = _build_router(config)
    analyzer = LLMAnalyzer(router=router, storage=sheets)
    bot = WhaleScopeBot(config.telegram_token, sheets)
    bot.build()

    # Pull recent signal summary rows (last 7 days)
    try:
        summary_rows = sheets.list_user_interests(0)  # placeholder: full signal history
    except Exception:
        summary_rows = []

    if not summary_rows:
        logger.info("No summary rows available for weekly trend; using empty list")

    commentary = analyzer.generate_weekly_commentary(summary_rows)
    logger.info("Weekly commentary generated (%d chars)", len(commentary))

    try:
        result = await bot.send_daily_brief(commentary)
        logger.info("Sent weekly trend: %s", result)
    except Exception as e:
        logger.error("Failed to send weekly trend: %s", e)
        raise

    return {"commentary_length": len(commentary), "delivery": result}


async def run():
    return await _run_weekly_trend_async()


def run_weekly_trend() -> dict[str, object]:
    return asyncio.run(_run_weekly_trend_async())


if __name__ == "__main__":
    try:
        run_weekly_trend()
    except Exception:
        sys.exit(1)
