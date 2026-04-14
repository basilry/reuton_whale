"""Tests for SignalEngine.personalize: weight clamping and exclude flag."""
from __future__ import annotations

import dataclasses
from datetime import datetime, timezone

import pytest

from src.signals.engine import SignalEngine
from src.signals.models import Signal

NOW = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

_CFG = {
    "rules": [
        {"name": "cex_outflow_spike", "window_hours": 24, "baseline_days": 7,
         "sigma_threshold": 3.0, "min_usd": 1_000_000, "severity_base": "medium"},
        {"name": "cex_inflow_spike", "window_hours": 24, "baseline_days": 7,
         "sigma_threshold": 3.0, "min_usd": 1_000_000, "severity_base": "medium"},
        {"name": "cold_to_hot_transfer", "min_usd": 5_000_000, "severity_base": "high"},
        {"name": "smart_money_accumulation", "window_hours": 24, "min_addresses": 3,
         "severity_base": "high"},
        {"name": "token_whale_concentration_shift", "top_n": 10, "threshold_pct": 2.0,
         "severity_base": "medium"},
        {"name": "tg_cex_inflow_burst", "window_minutes": 10, "min_events": 3,
         "severity_base": "medium"},
        {"name": "corroborated_move", "match_window_minutes": 3, "usd_tolerance_pct": 5.0,
         "severity_boost": 1},
        {"name": "weekly_net_accumulation", "lookback_weeks": 4, "deviation_sigma": 2.0,
         "severity_base": "low"},
    ]
}


def _sig(rule="cex_outflow_spike", score=6.0, source="chain") -> Signal:
    return Signal(
        signal_id="test000001",
        rule=rule,
        severity="medium",
        score=score,
        confidence="medium",
        source=source,
        evidence_tx_hashes=[],
        window_start=NOW,
        window_end=NOW,
        summary="test",
    )


@pytest.fixture
def engine() -> SignalEngine:
    return SignalEngine(_CFG)


class TestPersonalizeWeight:
    def test_weight_1_unchanged(self, engine):
        sig = _sig(score=6.0)
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "weight": 1.0}])
        assert result[0].score == pytest.approx(6.0)

    def test_weight_increases_score(self, engine):
        sig = _sig(score=6.0)
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "weight": 1.3}])
        assert result[0].score == pytest.approx(6.0 * 1.3)

    def test_weight_above_1_5_clamped(self, engine):
        sig = _sig(score=6.0)
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "weight": 3.0}])
        # max = score * 1.5 = 9.0
        assert result[0].score == pytest.approx(9.0)

    def test_weight_decreases_score(self, engine):
        sig = _sig(score=6.0)
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "weight": 0.9}])
        assert result[0].score == pytest.approx(6.0 * 0.9)

    def test_weight_below_0_7_clamped(self, engine):
        sig = _sig(score=6.0)
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "weight": 0.1}])
        # min = score * 0.7 = 4.2
        assert result[0].score == pytest.approx(4.2)

    def test_no_pref_weight_unchanged(self, engine):
        sig = _sig(score=7.5)
        result = engine.personalize([sig], [])
        assert result[0].score == pytest.approx(7.5)


class TestPersonalizeExclude:
    def test_exclude_removes_signal(self, engine):
        sig = _sig(rule="cex_outflow_spike")
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "exclude": True}])
        assert result == []

    def test_exclude_false_keeps_signal(self, engine):
        sig = _sig(rule="cex_outflow_spike")
        result = engine.personalize([sig], [{"rule": "cex_outflow_spike", "exclude": False}])
        assert len(result) == 1

    def test_exclude_one_keeps_others(self, engine):
        sigs = [_sig(rule="cex_outflow_spike"), _sig(rule="cex_inflow_spike")]
        result = engine.personalize(
            sigs,
            [{"rule": "cex_outflow_spike", "exclude": True}],
        )
        assert len(result) == 1
        assert result[0].rule == "cex_inflow_spike"

    def test_exclude_all_returns_empty(self, engine):
        sigs = [_sig(rule="cex_outflow_spike"), _sig(rule="cex_inflow_spike")]
        result = engine.personalize(
            sigs,
            [
                {"rule": "cex_outflow_spike", "exclude": True},
                {"rule": "cex_inflow_spike", "exclude": True},
            ],
        )
        assert result == []
