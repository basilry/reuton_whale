"""Manually trigger a daily brief pipeline run (calls main.py's run_daily_pipeline)."""

import asyncio
import json
import sys

sys.path.insert(0, ".")

from src.main import run_daily_pipeline
from src.utils.logger import get_logger

logger = get_logger("manual_brief")


def main():
    logger.info("Starting manual pipeline run...")
    result = asyncio.run(run_daily_pipeline())

    print("\n" + "=" * 60)
    print("PIPELINE RESULT")
    print("=" * 60)
    print(f"  Run ID:       {result['run_id']}")
    print(f"  Status:       {result['status']}")
    print(f"  Transactions: {result['transactions_count']}")
    print(f"  Started:      {result['started_at']}")
    print(f"  Finished:     {result['finished_at']}")

    errors = result.get("errors", "[]")
    if errors and errors != "[]":
        print(f"  Errors:       {errors}")

    if result.get("details"):
        print(f"  Details:      {result['details']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
