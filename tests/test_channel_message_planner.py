from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.channel.message_planner import FallbackSnapshot, plan_periodic_channel_message


def test_plan_periodic_channel_message_returns_event_alert_for_candidates():
    now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)

    plan = plan_periodic_channel_message(
        now=now,
        signal_rows=[{"summary": "대형 유입", "severity": "high"}],
        transaction_rows=[{"symbol": "BTC", "amount_usd": "1500000"}],
    )

    assert plan.decision == "event_alert"
    assert plan.reason == "signals_or_transactions_available"
    assert plan.candidate_signal_count == 1
    assert plan.candidate_transaction_count == 1
    assert plan.should_broadcast is True


def test_plan_periodic_channel_message_returns_market_pulse_after_interval():
    now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    last_delivery = now - timedelta(hours=3)

    plan = plan_periodic_channel_message(
        now=now,
        signal_rows=[],
        transaction_rows=[],
        fallback_snapshot=FallbackSnapshot.from_parts(daily_brief={"summary": "관망세"}),
        recent_broadcast_rows=[
            {
                "ts": last_delivery.isoformat(),
                "status": "dry_run",
                "delivery_mode": "dry_run",
            }
        ],
    )

    assert plan.decision == "market_pulse"
    assert plan.reason == "market_pulse_interval_elapsed"
    assert plan.fallback_source == "daily_brief"
    assert plan.last_delivery_at == last_delivery
    assert plan.next_expected_at == now - timedelta(hours=1)
    assert plan.should_broadcast is True


def test_plan_periodic_channel_message_returns_quiet_skip_before_interval():
    now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    last_delivery = now - timedelta(minutes=30)

    plan = plan_periodic_channel_message(
        now=now,
        signal_rows=[],
        transaction_rows=[],
        fallback_snapshot=FallbackSnapshot.from_parts(daily_brief={"summary": "관망세"}),
        recent_broadcast_rows=[
            {
                "ts": last_delivery.isoformat(),
                "status": "sent",
                "delivery_mode": "live",
            }
        ],
    )

    assert plan.decision == "quiet_skip"
    assert plan.reason == "market_pulse_interval_not_elapsed"
    assert plan.fallback_source == "daily_brief"
    assert plan.last_delivery_at == last_delivery
    assert plan.next_expected_at == now + timedelta(minutes=90)
    assert plan.should_broadcast is False

