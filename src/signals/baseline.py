"""Baseline builders for anomaly-detection signal rules."""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Iterable

from src.storage.protocol import Storage
from src.utils.datetime_utils import parse_dt
from src.utils.logger import get_logger
from src.utils.number_utils import safe_float

logger = get_logger("signals.baseline")


def _stats(values: Iterable[float]) -> tuple[float, float]:
    series = list(values)
    if not series:
        return 0.0, 1.0
    if len(series) == 1:
        return series[0], 1.0
    return statistics.mean(series), statistics.stdev(series)


def build_chain_baselines(
    storage: Storage,
    as_of: datetime,
    lookback_days: int = 14,
) -> dict[str, dict[str, float]]:
    """Compute daily CEX in/out flow baselines from address_activity rows.

    Returns a mapping compatible with RuleContext.chain_baselines. The current
    rules consume the "default" aggregate; per-chain keys are included for the
    next rule iteration without changing the caller contract.
    """
    since = as_of - timedelta(days=lookback_days)
    rows = storage.list_address_activity(since=since)
    if not isinstance(rows, list):
        return {}

    buckets: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {"in": 0.0, "out": 0.0})
    )
    all_dates: set[str] = set()

    for row in rows:
        if str(row.get("counterparty_category", "")).lower() != "cex":
            continue
        block_time = parse_dt(row.get("block_time") or row.get("collected_at"))
        if block_time is None:
            continue
        if block_time.tzinfo is None and since.tzinfo is not None:
            block_time = block_time.replace(tzinfo=since.tzinfo)
        if block_time < since or block_time > as_of:
            continue
        direction = str(row.get("direction", "")).lower()
        if direction not in ("in", "out"):
            continue

        day = block_time.date().isoformat()
        chain = str(row.get("chain", "default") or "default").lower()
        amount_usd = safe_float(row.get("amount_usd"), field_name="amount_usd", logger=logger)
        all_dates.add(day)

        buckets["default"][day][direction] += amount_usd
        buckets[chain][day][direction] += amount_usd

    if len(all_dates) < 7:
        return {}

    result: dict[str, dict[str, float]] = {}
    for chain, daily in buckets.items():
        chain_dates = sorted(daily)
        if len(chain_dates) < 7:
            continue
        in_mean, in_std = _stats(daily[day]["in"] for day in chain_dates)
        out_mean, out_std = _stats(daily[day]["out"] for day in chain_dates)
        result[chain] = {
            "in_mean_usd": round(in_mean, 6),
            "in_std_usd": round(max(in_std, 1.0), 6),
            "out_mean_usd": round(out_mean, 6),
            "out_std_usd": round(max(out_std, 1.0), 6),
            "n": len(chain_dates),
        }

    return result
