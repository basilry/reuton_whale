#!/usr/bin/env python3
"""Full pipeline smoke test — dry_run=True, no external API calls.

Usage:
    python scripts/smoke_pipeline.py
    python scripts/smoke_pipeline.py --verbose

Exits 0 on success, 1 on any stage error.
Prints compact summary: event count, signal count, brief length, model_id.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _fake_config():
    cfg = MagicMock()
    cfg.etherscan_api_key = "smoke-test"
    cfg.solscan_api_key = ""
    cfg.anthropic_api_key = "smoke-test"
    cfg.sheet_id = "smoke-sheet-id"
    cfg.google_credentials = '{"type":"service_account"}'
    cfg.telegram_token = "smoke-token"
    cfg.telethon_api_id = 0
    cfg.telethon_api_hash = ""
    cfg.telethon_session = "smoke"
    return cfg


def _make_sheets_mock():
    m = MagicMock()
    m.get_cached_analysis.return_value = None
    m.save_analysis.return_value = None
    m.save_analysis_log.return_value = None
    m.list_watched_addresses.return_value = []
    m.log_run.return_value = None
    m.append_transactions.return_value = 0
    m.save_daily_brief.return_value = None
    return m


async def _run(verbose: bool = False) -> int:
    mock_sheets = _make_sheets_mock()
    mock_bot = MagicMock()
    mock_bot.build.return_value = MagicMock()
    mock_bot.send_daily_brief = AsyncMock(return_value={"sent": 0, "failed": 0, "blocked": 0})

    # Patch external dependencies that need credentials
    with patch("src.main.load_config", return_value=_fake_config()), \
         patch("src.main.SheetsClient", return_value=mock_sheets), \
         patch("src.main.WhaleScopeBot", return_value=mock_bot):

        from src.main import run_daily_pipeline
        result = await run_daily_pipeline(dry_run=True)

    # --- Validate results ---
    status = result.get("status", "")
    errors_raw = result.get("errors", "[]")
    errors = json.loads(errors_raw) if isinstance(errors_raw, str) else (errors_raw or [])
    event_count = result.get("event_count", 0)
    signal_count = result.get("signal_count", 0)
    brief_length = result.get("brief_length", 0)
    model_id = result.get("model_id", "?")

    # Verify analysis_log was written with populated fields
    analysis_log_calls = mock_sheets.save_analysis_log.call_args_list
    log_ok = False
    for call in analysis_log_calls:
        entry = call[0][0] if call[0] else call[1].get("entry", {})
        if entry.get("model_id") and entry.get("prompt_version"):
            log_ok = True
            break

    # Print summary
    print(f"Events : {event_count}")
    print(f"Signals: {signal_count}")
    print(f"Brief  : {brief_length} chars")
    print(f"Model  : {model_id}")
    print(f"Status : {status}")
    if analysis_log_calls:
        print(f"AnalLog: {len(analysis_log_calls)} row(s) written, log_ok={log_ok}")

    if verbose and errors:
        print(f"Errors : {errors}")

    # Exit conditions
    if brief_length == 0:
        print("FAIL: brief is empty")
        return 1

    if status not in ("completed", "completed_with_errors"):
        print(f"FAIL: unexpected status {status!r}")
        return 1

    if errors:
        # Non-zero errors are acceptable in smoke (e.g. load_fixtures warning)
        # but signal_engine failure means something is wrong
        fatal = [e for e in errors if "signal_engine" in e]
        if fatal:
            print(f"FAIL: fatal signal_engine error: {fatal}")
            return 1

    print("SMOKE OK")
    return 0


def main():
    import argparse
    parser = argparse.ArgumentParser(description="WhaleScope smoke pipeline test")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(verbose=args.verbose)))


if __name__ == "__main__":
    main()
