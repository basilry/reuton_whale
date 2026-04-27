from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Mapping

DEFAULT_MARKET_PULSE_MIN_INTERVAL = timedelta(hours=2)


@dataclass(frozen=True)
class CadenceDecision:
    eligible: bool
    reason: str
    last_delivery_at: datetime | None = None
    next_expected_at: datetime | None = None


def parse_log_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def logged_delivery_mode(row: Mapping[str, object]) -> str:
    delivery_mode = str(row.get("delivery_mode") or "").strip().lower()
    if delivery_mode:
        return delivery_mode

    status = str(row.get("status") or "").strip().lower()
    if status == "sent":
        return "live"
    if status == "dry_run":
        return "dry_run"
    return "skipped"


def latest_channel_delivery_at(rows: list[Mapping[str, object]]) -> datetime | None:
    latest: datetime | None = None
    for row in rows:
        if logged_delivery_mode(row) not in {"live", "dry_run"}:
            continue
        row_time = parse_log_datetime(row.get("ts"))
        if row_time is None:
            continue
        if latest is None or row_time > latest:
            latest = row_time
    return latest


def evaluate_market_pulse_cadence(
    *,
    now: datetime,
    broadcast_rows: list[Mapping[str, object]],
    min_interval: timedelta = DEFAULT_MARKET_PULSE_MIN_INTERVAL,
) -> CadenceDecision:
    current = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    last_delivery_at = latest_channel_delivery_at(broadcast_rows)
    if last_delivery_at is None:
        return CadenceDecision(
            eligible=True,
            reason="no_previous_channel_delivery",
            next_expected_at=current,
        )

    next_expected_at = last_delivery_at + min_interval
    if current >= next_expected_at:
        return CadenceDecision(
            eligible=True,
            reason="market_pulse_interval_elapsed",
            last_delivery_at=last_delivery_at,
            next_expected_at=next_expected_at,
        )

    return CadenceDecision(
        eligible=False,
        reason="market_pulse_interval_not_elapsed",
        last_delivery_at=last_delivery_at,
        next_expected_at=next_expected_at,
    )

