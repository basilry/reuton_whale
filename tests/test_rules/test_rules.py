"""Tests for individual signal rules - minimum 2 cases per rule (16+ total)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.signals.models import Event, RuleContext
from src.signals.rules import load_rules

NOW = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)


def _evt(
    *,
    source="chain",
    chain="eth",
    tx_hash="0xabc",
    watched_address=None,
    from_addr="0xfrom",
    to_addr="0xto",
    direction="out",
    token="ETH",
    amount_token=100.0,
    amount_usd=1_000_000.0,
    counterparty_category=None,
    block_time=None,
    collected_at=None,
) -> Event:
    bt = block_time or NOW - timedelta(hours=1)
    return Event(
        source=source,
        chain=chain,
        tx_hash=tx_hash,
        watched_address=watched_address,
        from_addr=from_addr,
        to_addr=to_addr,
        direction=direction,
        token=token,
        amount_token=amount_token,
        amount_usd=amount_usd,
        counterparty_category=counterparty_category,
        block_time=bt,
        collected_at=collected_at or bt,
    )


def _ctx(**overrides) -> RuleContext:
    defaults = dict(
        now=NOW,
        chain_baselines={
            "default": {
                "out_mean_usd": 1_000_000.0,
                "out_std_usd": 500_000.0,
                "in_mean_usd": 1_000_000.0,
                "in_std_usd": 500_000.0,
            }
        },
        watched_index=set(),
        weekly_net_history={"default": [500_000, 600_000, 550_000, 520_000]},
        concentration_history={},
    )
    defaults.update(overrides)
    return RuleContext(**defaults)


def _load(name: str, cfg_overrides: dict | None = None) -> object:
    base_cfg = {
        "cex_outflow_spike": {
            "name": "cex_outflow_spike",
            "window_hours": 24,
            "baseline_days": 7,
            "sigma_threshold": 3.0,
            "min_usd": 1_000_000,
            "severity_base": "medium",
        },
        "cex_inflow_spike": {
            "name": "cex_inflow_spike",
            "window_hours": 24,
            "baseline_days": 7,
            "sigma_threshold": 3.0,
            "min_usd": 1_000_000,
            "severity_base": "medium",
        },
        "cold_to_hot_transfer": {
            "name": "cold_to_hot_transfer",
            "min_usd": 5_000_000,
            "severity_base": "high",
        },
        "smart_money_accumulation": {
            "name": "smart_money_accumulation",
            "window_hours": 24,
            "min_addresses": 3,
            "severity_base": "high",
        },
        "token_whale_concentration_shift": {
            "name": "token_whale_concentration_shift",
            "top_n": 10,
            "threshold_pct": 2.0,
            "severity_base": "medium",
        },
        "tg_cex_inflow_burst": {
            "name": "tg_cex_inflow_burst",
            "window_minutes": 10,
            "min_events": 3,
            "severity_base": "medium",
        },
        "corroborated_move": {
            "name": "corroborated_move",
            "match_window_minutes": 3,
            "usd_tolerance_pct": 5.0,
            "severity_boost": 1,
        },
        "weekly_net_accumulation": {
            "name": "weekly_net_accumulation",
            "lookback_weeks": 4,
            "deviation_sigma": 2.0,
            "severity_base": "low",
        },
    }
    cfg = dict(base_cfg[name])
    if cfg_overrides:
        cfg.update(cfg_overrides)
    rules = load_rules({"rules": [cfg]})
    return rules[0]


# ---------------------------------------------------------------------------
# Rule 1: cex_outflow_spike
# ---------------------------------------------------------------------------
class TestCexOutflowSpike:
    def test_below_min_usd_no_signal(self):
        rule = _load("cex_outflow_spike")
        ev = _evt(direction="out", counterparty_category="cex", amount_usd=500_000)
        assert rule([ev], _ctx()) == []

    def test_below_sigma_no_signal(self):
        rule = _load("cex_outflow_spike")
        # total=1.5M, mean=1M, std=500K → z=1.0 < 3.0
        ev = _evt(direction="out", counterparty_category="cex", amount_usd=1_500_000)
        assert rule([ev], _ctx()) == []

    def test_above_threshold_generates_signal(self):
        rule = _load("cex_outflow_spike")
        # total=3.5M, z=(3.5M-1M)/500K = 5.0 >= 3.0
        ev = _evt(direction="out", counterparty_category="cex", amount_usd=3_500_000)
        signals = rule([ev], _ctx())
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "cex_outflow_spike"
        assert sig.severity == "medium"
        assert sig.score == pytest.approx(7.0)  # 5 + (5-3) = 7

    def test_score_capped_at_10(self):
        rule = _load("cex_outflow_spike")
        # z = (12M-1M)/500K = 22 → score would be > 10, should cap at 10
        ev = _evt(direction="out", counterparty_category="cex", amount_usd=12_000_000)
        signals = rule([ev], _ctx())
        assert signals[0].score == 10.0


# ---------------------------------------------------------------------------
# Rule 2: cex_inflow_spike
# ---------------------------------------------------------------------------
class TestCexInflowSpike:
    def test_below_min_usd_no_signal(self):
        rule = _load("cex_inflow_spike")
        ev = _evt(direction="in", counterparty_category="cex", amount_usd=800_000)
        assert rule([ev], _ctx()) == []

    def test_above_threshold_generates_signal(self):
        rule = _load("cex_inflow_spike")
        # z = (3.5M-1M)/500K = 5.0
        ev = _evt(direction="in", counterparty_category="cex", amount_usd=3_500_000)
        signals = rule([ev], _ctx())
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "cex_inflow_spike"
        assert sig.source == "chain"
        assert sig.score == pytest.approx(7.0)


# ---------------------------------------------------------------------------
# Rule 3: cold_to_hot_transfer
# ---------------------------------------------------------------------------
class TestColdToHotTransfer:
    def test_below_min_usd_no_signal(self):
        rule = _load("cold_to_hot_transfer")
        ev = _evt(direction="out", counterparty_category="hot", amount_usd=1_000_000)
        assert rule([ev], _ctx()) == []

    def test_above_threshold_generates_signal(self):
        rule = _load("cold_to_hot_transfer")
        ev = _evt(direction="out", counterparty_category="hot", amount_usd=6_000_000)
        signals = rule([ev], _ctx())
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "cold_to_hot_transfer"
        assert sig.severity == "high"
        assert sig.score > 5.0

    def test_multiple_events_multiple_signals(self):
        rule = _load("cold_to_hot_transfer")
        evs = [
            _evt(tx_hash="0x1", direction="out", counterparty_category="hot", amount_usd=10_000_000),
            _evt(tx_hash="0x2", direction="out", counterparty_category="hot", amount_usd=20_000_000),
        ]
        signals = rule(evs, _ctx())
        assert len(signals) == 2


# ---------------------------------------------------------------------------
# Rule 4: smart_money_accumulation
# ---------------------------------------------------------------------------
class TestSmartMoneyAccumulation:
    def test_below_min_addresses_no_signal(self):
        rule = _load("smart_money_accumulation")
        ctx = _ctx(watched_index={"0xwA", "0xwB"})
        evs = [
            _evt(tx_hash=f"0x{i}", watched_address=f"0xw{chr(65+i)}", direction="in")
            for i in range(2)
        ]
        assert rule(evs, ctx) == []

    def test_meets_min_addresses_generates_signal(self):
        rule = _load("smart_money_accumulation")
        addrs = {"0xwA", "0xwB", "0xwC"}
        ctx = _ctx(watched_index=addrs)
        evs = [
            _evt(tx_hash=f"0x{i}", watched_address=a, direction="in", amount_usd=1_000_000)
            for i, a in enumerate(["0xwA", "0xwB", "0xwC"])
        ]
        signals = rule(evs, ctx)
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "smart_money_accumulation"
        assert sig.severity == "high"
        assert sig.score == pytest.approx(5.0)

    def test_extra_addresses_increase_score(self):
        rule = _load("smart_money_accumulation")
        addrs = {f"0xw{i}" for i in range(5)}
        ctx = _ctx(watched_index=addrs)
        evs = [
            _evt(tx_hash=f"0x{i}", watched_address=f"0xw{i}", direction="in")
            for i in range(5)
        ]
        signals = rule(evs, ctx)
        assert signals[0].score > 5.0


# ---------------------------------------------------------------------------
# Rule 5: token_whale_concentration_shift
# ---------------------------------------------------------------------------
class TestTokenWhaleConcentrationShift:
    def test_no_history_no_signal(self):
        rule = _load("token_whale_concentration_shift")
        ctx = _ctx(concentration_history={})
        assert rule([], ctx) == []

    def test_below_threshold_no_signal(self):
        rule = _load("token_whale_concentration_shift")
        ctx = _ctx(concentration_history={"eth:ETH": [20.0, 21.0]})  # shift=1.0 < 2.0
        assert rule([], ctx) == []

    def test_above_threshold_generates_signal(self):
        rule = _load("token_whale_concentration_shift")
        ctx = _ctx(concentration_history={"eth:ETH": [20.0, 23.5]})  # shift=3.5 >= 2.0
        signals = rule([], ctx)
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "token_whale_concentration_shift"
        assert sig.score > 5.0


# ---------------------------------------------------------------------------
# Rule 6: tg_cex_inflow_burst
# ---------------------------------------------------------------------------
class TestTgCexInflowBurst:
    def test_below_min_events_no_signal(self):
        rule = _load("tg_cex_inflow_burst")
        evs = [
            _evt(
                source="tg", direction="in", counterparty_category="cex",
                collected_at=NOW - timedelta(minutes=5),
                block_time=NOW - timedelta(minutes=5),
                tx_hash=f"0x{i}",
            )
            for i in range(2)
        ]
        assert rule(evs, _ctx()) == []

    def test_outside_window_no_signal(self):
        rule = _load("tg_cex_inflow_burst")
        evs = [
            _evt(
                source="tg", direction="in", counterparty_category="cex",
                collected_at=NOW - timedelta(minutes=15),
                block_time=NOW - timedelta(minutes=15),
                tx_hash=f"0x{i}",
            )
            for i in range(5)
        ]
        assert rule(evs, _ctx()) == []

    def test_burst_generates_signal(self):
        rule = _load("tg_cex_inflow_burst")
        evs = [
            _evt(
                source="tg", direction="in", counterparty_category="cex",
                collected_at=NOW - timedelta(minutes=2),
                block_time=NOW - timedelta(minutes=2),
                tx_hash=f"0x{i}",
            )
            for i in range(4)
        ]
        signals = rule(evs, _ctx())
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "tg_cex_inflow_burst"
        assert sig.source == "tg"
        assert sig.score == pytest.approx(5.5)  # 5 + (4-3)*0.5


# ---------------------------------------------------------------------------
# Rule 7: corroborated_move
# ---------------------------------------------------------------------------
class TestCorroboratedMove:
    def test_no_match_no_signal(self):
        rule = _load("corroborated_move")
        tg_ev = _evt(source="tg", tx_hash=None, amount_usd=5_000_000,
                     block_time=NOW - timedelta(hours=1))
        chain_ev = _evt(source="chain", tx_hash="0xchain1", amount_usd=10_000_000,
                        block_time=NOW - timedelta(hours=2))
        assert rule([tg_ev, chain_ev], _ctx()) == []

    def test_tx_hash_match_generates_signal(self):
        rule = _load("corroborated_move")
        bt = NOW - timedelta(hours=1)
        tg_ev = _evt(source="tg", tx_hash="0xshared", amount_usd=5_000_000, block_time=bt)
        chain_ev = _evt(source="chain", tx_hash="0xshared", amount_usd=5_000_000, block_time=bt)
        signals = rule([tg_ev, chain_ev], _ctx())
        assert len(signals) == 1
        assert signals[0].source == "both"
        assert "0xshared" in signals[0].evidence_tx_hashes

    def test_heuristic_match_generates_signal(self):
        rule = _load("corroborated_move")
        bt_tg = NOW - timedelta(hours=1)
        bt_chain = bt_tg + timedelta(minutes=2)  # within 3min
        tg_ev = _evt(source="tg", tx_hash=None, amount_usd=5_000_000, block_time=bt_tg)
        chain_ev = _evt(source="chain", tx_hash="0xchain", amount_usd=5_100_000,  # 2% diff < 5%
                        block_time=bt_chain)
        signals = rule([tg_ev, chain_ev], _ctx())
        assert len(signals) == 1
        assert signals[0].source == "both"


# ---------------------------------------------------------------------------
# Rule 8: weekly_net_accumulation
# ---------------------------------------------------------------------------
class TestWeeklyNetAccumulation:
    def test_no_recent_events_no_signal(self):
        rule = _load("weekly_net_accumulation")
        ev = _evt(block_time=NOW - timedelta(weeks=2), direction="in", amount_usd=5_000_000)
        assert rule([ev], _ctx()) == []

    def test_net_negative_no_signal(self):
        rule = _load("weekly_net_accumulation")
        evs = [
            _evt(tx_hash="0xi", direction="in", block_time=NOW - timedelta(days=2), amount_usd=100_000),
            _evt(tx_hash="0xo", direction="out", block_time=NOW - timedelta(days=1), amount_usd=500_000),
        ]
        assert rule(evs, _ctx()) == []

    def test_below_sigma_no_signal(self):
        rule = _load("weekly_net_accumulation")
        # weekly_net_history default: [500K, 600K, 550K, 520K] mean~543K std~43K
        # current net = 600K → z = (600K-543K)/43K ≈ 1.3 < 2.0
        ev = _evt(tx_hash="0xi", direction="in", block_time=NOW - timedelta(days=1),
                  amount_usd=600_000)
        assert rule([ev], _ctx()) == []

    def test_above_sigma_generates_signal(self):
        rule = _load("weekly_net_accumulation")
        # current net = 800K → z = (800K-543K)/43K ≈ 6.0 >= 2.0
        ev = _evt(tx_hash="0xi", direction="in", block_time=NOW - timedelta(days=1),
                  amount_usd=800_000)
        signals = rule([ev], _ctx())
        assert len(signals) == 1
        sig = signals[0]
        assert sig.rule == "weekly_net_accumulation"
        assert sig.severity == "low"
        assert sig.score > 5.0
