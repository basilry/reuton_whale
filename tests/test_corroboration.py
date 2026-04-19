"""Tests for engine corroboration: TG + chain event matching → source='both'."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.signals.engine import SignalEngine
from src.signals.models import Event

NOW = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

_BASE_CONFIG = {
    "rules": [
        {
            "name": "cex_outflow_spike",
            "window_hours": 24,
            "baseline_days": 7,
            "sigma_threshold": 3.0,
            "min_usd": 1_000_000,
            "severity_base": "medium",
        },
        {
            "name": "cex_inflow_spike",
            "window_hours": 24,
            "baseline_days": 7,
            "sigma_threshold": 3.0,
            "min_usd": 1_000_000,
            "severity_base": "medium",
        },
        {
            "name": "cold_to_hot_transfer",
            "min_usd": 5_000_000,
            "severity_base": "high",
        },
        {
            "name": "smart_money_accumulation",
            "window_hours": 24,
            "min_addresses": 3,
            "severity_base": "high",
        },
        {
            "name": "token_whale_concentration_shift",
            "top_n": 10,
            "threshold_pct": 2.0,
            "severity_base": "medium",
        },
        {
            "name": "tg_cex_inflow_burst",
            "window_minutes": 10,
            "min_events": 3,
            "severity_base": "medium",
        },
        {
            "name": "corroborated_move",
            "match_window_minutes": 3,
            "usd_tolerance_pct": 5.0,
            "severity_boost": 1,
        },
        {
            "name": "weekly_net_accumulation",
            "lookback_weeks": 4,
            "deviation_sigma": 2.0,
            "severity_base": "low",
        },
    ]
}


def _make_engine() -> SignalEngine:
    return SignalEngine(_BASE_CONFIG)


def _evt(
    *,
    source="chain",
    tx_hash="0xabc",
    direction="out",
    amount_usd=1_000_000.0,
    counterparty_category="cex",
    block_time=None,
    collected_at=None,
) -> Event:
    bt = block_time or NOW - timedelta(hours=1)
    return Event(
        source=source,
        chain="eth",
        tx_hash=tx_hash,
        watched_address=None,
        from_addr="0xfrom",
        to_addr="0xto",
        direction=direction,
        token="ETH",
        amount_token=1.0,
        amount_usd=amount_usd,
        counterparty_category=counterparty_category,
        block_time=bt,
        collected_at=collected_at or bt,
    )


class TestCorroborationTxHashPath:
    """Path 1: tx_hash match promotes signal to source='both'."""

    def test_shared_tx_hash_marks_signal_both(self):
        """CEX inflow signal corroborated by matching TG event via tx_hash."""
        engine = _make_engine()
        bt = NOW - timedelta(hours=1)
        shared_hash = "0xmatch123"
        # Chain event creates a cex_inflow_spike candidate
        chain_ev = _evt(
            source="chain", tx_hash=shared_hash, direction="in",
            amount_usd=4_000_000, block_time=bt,
        )
        # TG event with same tx_hash
        tg_ev = _evt(
            source="tg", tx_hash=shared_hash, direction="in",
            amount_usd=4_000_000, block_time=bt,
        )
        tg_ev = Event(
            **{
                **tg_ev.__dict__,
                "observation_source": "tg_mirror",
                "external_channel": "Whale Alert",
                "external_confidence": "high",
            }
        )
        signals = engine.run([chain_ev, tg_ev], NOW)
        # corroborated_move rule should produce a "both" signal
        corr_sigs = [s for s in signals if s.rule == "corroborated_move"]
        assert len(corr_sigs) >= 1
        assert shared_hash in corr_sigs[0].evidence_tx_hashes
        assert corr_sigs[0].extra["cross_checked_by"] == "Whale Alert"

    def test_no_tg_event_signal_stays_chain(self):
        """Without a TG counterpart, signal source remains 'chain'."""
        engine = _make_engine()
        # Enough to trigger cex_inflow_spike (z>3): 2.5M, mean=1M, std=500K → z=3
        chain_ev = _evt(
            source="chain", tx_hash="0xchain_only", direction="in",
            amount_usd=2_500_000,
        )
        signals = engine.run([chain_ev], NOW)
        inflow_sigs = [s for s in signals if s.rule == "cex_inflow_spike"]
        assert all(s.source == "chain" for s in inflow_sigs)


class TestCorroborationHeuristicPath:
    """Path 2: time within window + usd within tolerance promotes source='both'."""

    def test_time_and_usd_match_marks_both(self):
        """TG event and chain event close in time and USD → corroborated_move signal."""
        engine = _make_engine()
        bt_chain = NOW - timedelta(hours=2)
        bt_tg = bt_chain + timedelta(minutes=2)  # 2 min later, within 3 min window
        chain_ev = _evt(
            source="chain", tx_hash="0xonly_chain",
            direction="out", amount_usd=5_000_000, block_time=bt_chain,
        )
        tg_ev = _evt(
            source="tg", tx_hash=None,
            direction="out", amount_usd=5_100_000,  # 2% diff, within 5%
            block_time=bt_tg, collected_at=bt_tg,
        )
        signals = engine.run([chain_ev, tg_ev], NOW)
        corr_sigs = [s for s in signals if s.rule == "corroborated_move"]
        assert len(corr_sigs) >= 1
        assert corr_sigs[0].source == "both"

    def test_outside_time_window_no_corroboration(self):
        """TG event outside match_window_minutes should NOT trigger corroborated_move."""
        engine = _make_engine()
        bt_chain = NOW - timedelta(hours=2)
        bt_tg = bt_chain + timedelta(minutes=10)  # 10 min > 3 min window
        chain_ev = _evt(
            source="chain", tx_hash=None,
            direction="out", amount_usd=5_000_000, block_time=bt_chain,
        )
        tg_ev = _evt(
            source="tg", tx_hash=None,
            direction="out", amount_usd=5_000_000,
            block_time=bt_tg, collected_at=bt_tg,
        )
        signals = engine.run([chain_ev, tg_ev], NOW)
        corr_sigs = [s for s in signals if s.rule == "corroborated_move"]
        assert len(corr_sigs) == 0

    def test_outside_usd_tolerance_no_corroboration(self):
        """TG event with USD diff > tolerance should NOT trigger corroborated_move."""
        engine = _make_engine()
        bt = NOW - timedelta(hours=2)
        chain_ev = _evt(
            source="chain", tx_hash=None,
            direction="out", amount_usd=5_000_000, block_time=bt,
        )
        tg_ev = _evt(
            source="tg", tx_hash=None,
            direction="out", amount_usd=6_000_000,  # 20% diff > 5%
            block_time=bt + timedelta(minutes=1), collected_at=bt + timedelta(minutes=1),
        )
        signals = engine.run([chain_ev, tg_ev], NOW)
        corr_sigs = [s for s in signals if s.rule == "corroborated_move"]
        assert len(corr_sigs) == 0

    def test_tg_event_does_not_trigger_chain_only_cex_rule(self):
        """TG rows merged into raw_events must not masquerade as chain CEX spikes."""
        engine = _make_engine()
        tg_ev = _evt(
            source="tg",
            tx_hash=None,
            direction="in",
            amount_usd=10_000_000,
            counterparty_category="cex",
            block_time=NOW - timedelta(minutes=5),
            collected_at=NOW - timedelta(minutes=5),
        )

        signals = engine.run(
            [tg_ev],
            NOW,
            baselines={"default": {"in_mean_usd": 0.0, "in_std_usd": 1.0}},
        )

        assert [s for s in signals if s.rule == "cex_inflow_spike"] == []


class TestCorroborationEdgeCases:
    """Edge cases for Path 3 filter logic."""

    def test_corroboration_tx_hash_none_skipped(self):
        """chain event with tx_hash=None must not upgrade cold_to_hot_transfer via Path 3.

        With the old `not in (None,)` idiom, ce.tx_hash=None was NOT skipped,
        allowing spurious corroboration. Post-refactor, None-hash events are excluded
        from evidence_chain_events, so the cold_to_hot_transfer signal stays source='chain'.
        """
        engine = _make_engine()
        bt_chain = NOW - timedelta(hours=2)
        bt_tg = bt_chain + timedelta(minutes=2)  # within 3-min window
        chain_ev = _evt(
            source="chain", tx_hash=None,
            direction="out", amount_usd=5_000_000, block_time=bt_chain,
        )
        tg_ev = _evt(
            source="tg", tx_hash=None,
            direction="out", amount_usd=5_000_000,  # 0% diff, within tolerance
            block_time=bt_tg, collected_at=bt_tg,
        )
        signals = engine.run([chain_ev, tg_ev], NOW)
        # cold_to_hot_transfer fires with evidence_tx_hashes=[] (no tx_hash)
        # Engine Path 3 must NOT upgrade it: None not in [] → ce excluded
        cth_sigs = [s for s in signals if s.rule == "cold_to_hot_transfer"]
        assert all(s.source == "chain" for s in cth_sigs)

    def test_corroboration_path_3_time_boundary(self):
        """chain + tg events exactly at match_window_minutes=3 should still corroborate."""
        engine = _make_engine()
        bt_chain = NOW - timedelta(hours=2)
        bt_tg = bt_chain + timedelta(minutes=3)  # exactly at boundary, <= 3 → match
        chain_ev = _evt(
            source="chain", tx_hash="0xboundary",
            direction="out", amount_usd=5_000_000, block_time=bt_chain,
        )
        tg_ev = _evt(
            source="tg", tx_hash=None,
            direction="out", amount_usd=5_000_000,  # 0% diff
            block_time=bt_tg, collected_at=bt_tg,
        )
        signals = engine.run([chain_ev, tg_ev], NOW)
        corr_sigs = [s for s in signals if s.rule == "corroborated_move"]
        assert len(corr_sigs) >= 1
        assert corr_sigs[0].source == "both"
