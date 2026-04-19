"""Rule loader and pure-function signal rules.

Design note — CEX counterparty semantics
----------------------------------------
Rules that target CEX flow (``cex_outflow_spike``, ``cex_inflow_spike``,
``tg_cex_inflow_burst``) compare ``counterparty_category == "cex"`` **exactly**.

Exchange-to-exchange transfers are emitted with
``counterparty_category == "cex_to_cex"`` by ``src.main::_tg_direction`` to
suppress venue-rebalance noise. Do **NOT** widen the comparison to
``in {"cex", "cex_to_cex"}`` — that would defeat the split.

If you need to treat cex-to-cex events as signals, create a dedicated rule
(e.g. ``cex_venue_rebalance``) with its own threshold, instead of merging
categories here.
"""
from __future__ import annotations

import math
import statistics
import uuid
from datetime import datetime, timedelta
from typing import Callable

from src.signals.models import Event, RuleContext, Signal

_SEVERITY_ORDER = ["low", "medium", "high", "critical"]


def _bump_severity(s: str, n: int = 1) -> str:
    idx = _SEVERITY_ORDER.index(s)
    return _SEVERITY_ORDER[min(idx + n, len(_SEVERITY_ORDER) - 1)]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _score_from_z(z: float, sigma: float) -> float:
    """Map z-score to [5.0, 10.0] where z==sigma → 5.0."""
    return min(10.0, 5.0 + (z - sigma))


def _rule_cfg_for_chain(cfg: dict, chain: str | None) -> dict:
    if not chain:
        return cfg
    overrides = cfg.get("per_chain_overrides")
    if not isinstance(overrides, dict):
        return cfg
    chain_override = overrides.get(str(chain).upper())
    if not isinstance(chain_override, dict):
        return cfg
    merged = dict(cfg)
    merged.update(chain_override)
    return merged


def _external_channel_label(event: Event) -> str:
    return event.external_channel or event.external_channel_handle or "Telegram"


def _external_confidence(event: Event) -> str:
    confidence = str(event.external_confidence or "medium").strip().lower()
    if confidence in {"low", "medium", "high"}:
        return confidence
    return "medium"


# ---------------------------------------------------------------------------
# Rule 1: CEX outflow spike
# ---------------------------------------------------------------------------
def _make_cex_outflow_spike(cfg: dict) -> Callable:
    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        window_h = cfg["window_hours"]
        cutoff = ctx.now - timedelta(hours=window_h)
        window_events = [
            e for e in events
            if e.source == "chain"
            and e.direction == "out"
            and e.counterparty_category == "cex"
            and e.block_time >= cutoff
        ]
        if not window_events:
            return []
        by_chain: dict[str, list[Event]] = {}
        for event in window_events:
            by_chain.setdefault(event.chain.upper(), []).append(event)

        signals: list[Signal] = []
        for chain, chain_events in by_chain.items():
            chain_cfg = _rule_cfg_for_chain(cfg, chain)
            sigma = chain_cfg["sigma_threshold"]
            min_usd = chain_cfg["min_usd"]
            severity_base = chain_cfg["severity_base"]
            total_usd = sum(e.amount_usd for e in chain_events)
            if total_usd < min_usd:
                continue
            b = ctx.chain_baselines.get("default", {})
            mean = b.get("out_mean_usd", 0.0)
            std = b.get("out_std_usd", 1.0)
            z = (total_usd - mean) / max(std, 1.0)
            if z < sigma:
                continue
            score = _score_from_z(z, sigma)
            tx_hashes = [e.tx_hash for e in chain_events if e.tx_hash]
            signals.append(Signal(
                signal_id=_new_id(),
                rule="cex_outflow_spike",
                severity=severity_base,
                score=round(score, 2),
                confidence="medium",
                source="chain",
                evidence_tx_hashes=tx_hashes,
                window_start=cutoff,
                window_end=ctx.now,
                summary=f"CEX outflow spike [{chain}]: ${total_usd:,.0f} (z={z:.1f})",
                extra={"chain": chain, "amount_usd": total_usd, "direction": "out"},
            ))
        return signals

    return rule


# ---------------------------------------------------------------------------
# Rule 2: CEX inflow spike
# ---------------------------------------------------------------------------
def _make_cex_inflow_spike(cfg: dict) -> Callable:
    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        window_h = cfg["window_hours"]
        cutoff = ctx.now - timedelta(hours=window_h)
        window_events = [
            e for e in events
            if e.source == "chain"
            and e.direction == "in"
            and e.counterparty_category == "cex"
            and e.block_time >= cutoff
        ]
        if not window_events:
            return []
        by_chain: dict[str, list[Event]] = {}
        for event in window_events:
            by_chain.setdefault(event.chain.upper(), []).append(event)

        signals: list[Signal] = []
        for chain, chain_events in by_chain.items():
            chain_cfg = _rule_cfg_for_chain(cfg, chain)
            sigma = chain_cfg["sigma_threshold"]
            min_usd = chain_cfg["min_usd"]
            severity_base = chain_cfg["severity_base"]
            total_usd = sum(e.amount_usd for e in chain_events)
            if total_usd < min_usd:
                continue
            b = ctx.chain_baselines.get("default", {})
            mean = b.get("in_mean_usd", 0.0)
            std = b.get("in_std_usd", 1.0)
            z = (total_usd - mean) / max(std, 1.0)
            if z < sigma:
                continue
            score = _score_from_z(z, sigma)
            tx_hashes = [e.tx_hash for e in chain_events if e.tx_hash]
            signals.append(Signal(
                signal_id=_new_id(),
                rule="cex_inflow_spike",
                severity=severity_base,
                score=round(score, 2),
                confidence="medium",
                source="chain",
                evidence_tx_hashes=tx_hashes,
                window_start=cutoff,
                window_end=ctx.now,
                summary=f"CEX inflow spike [{chain}]: ${total_usd:,.0f} (z={z:.1f})",
                extra={"chain": chain, "amount_usd": total_usd, "direction": "in"},
            ))
        return signals

    return rule


# ---------------------------------------------------------------------------
# Rule 3: Cold-to-hot transfer
# ---------------------------------------------------------------------------
def _make_cold_to_hot_transfer(cfg: dict) -> Callable:
    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        signals = []
        for e in events:
            if not (
                e.source == "chain"
                and e.counterparty_category == "hot"
                and e.direction == "out"
            ):
                continue
            chain_cfg = _rule_cfg_for_chain(cfg, e.chain.upper())
            min_usd = chain_cfg["min_usd"]
            severity_base = chain_cfg["severity_base"]
            if e.amount_usd < min_usd:
                continue
            ratio = e.amount_usd / min_usd
            score = min(10.0, 5.0 + math.log10(max(ratio, 1.0)) * 2)
            signals.append(Signal(
                signal_id=_new_id(),
                rule="cold_to_hot_transfer",
                severity=severity_base,
                score=round(score, 2),
                confidence="high",
                source="chain",
                evidence_tx_hashes=[e.tx_hash] if e.tx_hash else [],
                window_start=e.block_time,
                window_end=e.block_time,
                summary=f"Cold→hot transfer [{e.chain.upper()}]: ${e.amount_usd:,.0f}",
                extra={"chain": e.chain.upper(), "amount_usd": e.amount_usd, "direction": "out"},
            ))
        return signals

    return rule


# ---------------------------------------------------------------------------
# Rule 4: Smart money accumulation
# ---------------------------------------------------------------------------
def _make_smart_money_accumulation(cfg: dict) -> Callable:
    window_h = cfg["window_hours"]
    min_addresses = cfg["min_addresses"]
    severity_base = cfg["severity_base"]

    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        cutoff = ctx.now - timedelta(hours=window_h)
        accumulating = [
            e for e in events
            if e.source == "chain"
            and e.direction == "in"
            and e.watched_address in ctx.watched_index
            and e.block_time >= cutoff
        ]
        unique_addresses = {e.watched_address for e in accumulating}
        n = len(unique_addresses)
        if n < min_addresses:
            return []
        score = min(10.0, 5.0 + (n - min_addresses) * 0.5)
        tx_hashes = [e.tx_hash for e in accumulating if e.tx_hash]
        return [Signal(
            signal_id=_new_id(),
            rule="smart_money_accumulation",
            severity=severity_base,
            score=round(score, 2),
            confidence="high",
            source="chain",
            evidence_tx_hashes=tx_hashes,
            window_start=cutoff,
            window_end=ctx.now,
            summary=f"Smart money accumulation: {n} watched addresses buying",
            extra={"addresses": list(unique_addresses)},
        )]

    return rule


# ---------------------------------------------------------------------------
# Rule 5: Token whale concentration shift
# ---------------------------------------------------------------------------
def _make_token_whale_concentration_shift(cfg: dict) -> Callable:
    top_n = cfg["top_n"]
    threshold_pct = cfg["threshold_pct"]
    severity_base = cfg["severity_base"]

    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        signals = []
        for key, history in ctx.concentration_history.items():
            if len(history) < 2:
                continue
            prev = history[-2]
            current = history[-1]
            shift = abs(current - prev)
            if shift < threshold_pct:
                continue
            score = min(10.0, 5.0 + (shift - threshold_pct) * 0.5)
            chain, token = key.split(":", 1) if ":" in key else ("unknown", key)
            direction = "up" if current > prev else "down"
            signals.append(Signal(
                signal_id=_new_id(),
                rule="token_whale_concentration_shift",
                severity=severity_base,
                score=round(score, 2),
                confidence="medium",
                source="chain",
                evidence_tx_hashes=[],
                window_start=ctx.now,
                window_end=ctx.now,
                summary=f"Top-{top_n} whale concentration {direction} {shift:.1f}% on {chain}:{token}",
                extra={"chain": chain, "token": token, "shift_pct": shift},
            ))
        return signals

    return rule


# ---------------------------------------------------------------------------
# Rule 6: TG CEX inflow burst
# ---------------------------------------------------------------------------
def _make_tg_cex_inflow_burst(cfg: dict) -> Callable:
    window_min = cfg["window_minutes"]
    min_events = cfg["min_events"]
    severity_base = cfg["severity_base"]

    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        cutoff = ctx.now - timedelta(minutes=window_min)
        burst = [
            e for e in events
            if e.source == "tg"
            and e.direction == "in"
            and e.counterparty_category == "cex"
            and e.collected_at >= cutoff
        ]
        n = len(burst)
        if n < min_events:
            return []
        score = min(10.0, 5.0 + (n - min_events) * 0.5)
        tx_hashes = [e.tx_hash for e in burst if e.tx_hash]
        return [Signal(
            signal_id=_new_id(),
            rule="tg_cex_inflow_burst",
            severity=severity_base,
            score=round(score, 2),
            confidence="medium",
            source="tg",
            evidence_tx_hashes=tx_hashes,
            window_start=cutoff,
            window_end=ctx.now,
            summary=f"TG CEX inflow burst: {n} events in {window_min}min",
        )]

    return rule


# ---------------------------------------------------------------------------
# Rule 7: External-only observation
# ---------------------------------------------------------------------------
def _make_external_only_observation(cfg: dict) -> Callable:
    min_usd = cfg["min_usd"]
    severity_base = cfg["severity_base"]
    allowed_chains = {str(chain).strip().upper() for chain in cfg.get("chains_allowed", [])}

    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        signals = []
        for event in events:
            if event.source != "tg" or event.observation_source != "tg_mirror":
                continue
            if allowed_chains and event.chain.upper() not in allowed_chains:
                continue
            if event.amount_usd < min_usd:
                continue

            confidence = _external_confidence(event)
            if confidence == "low":
                continue

            severity = severity_base
            if severity == "low" and confidence == "high" and event.amount_usd >= (min_usd * 2):
                severity = "medium"

            channel = _external_channel_label(event)
            score = min(10.0, 5.0 + math.log10(max(event.amount_usd / min_usd, 1.0)) * 1.5)
            signals.append(Signal(
                signal_id=_new_id(),
                rule="external_only_observation",
                severity=severity,
                score=round(score, 2),
                confidence=confidence,  # type: ignore[arg-type]
                source="tg",
                evidence_tx_hashes=[event.tx_hash] if event.tx_hash else [],
                window_start=event.block_time,
                window_end=event.block_time,
                summary=(
                    f"External observation: {channel} reported "
                    f"${event.amount_usd:,.0f} on {event.chain}"
                ),
                extra={
                    "observation_source": "tg_mirror",
                    "external_channel": event.external_channel,
                    "external_channel_handle": event.external_channel_handle,
                    "external_confidence": confidence,
                    "chain": event.chain,
                    "token": event.token,
                    "amount_usd": event.amount_usd,
                    "direction": event.direction,
                },
            ))
        return signals

    return rule


# ---------------------------------------------------------------------------
# Rule 8: Corroborated move
# ---------------------------------------------------------------------------
def _make_corroborated_move(cfg: dict) -> Callable:
    match_window_min = cfg["match_window_minutes"]
    usd_tol_pct = cfg["usd_tolerance_pct"] / 100.0
    severity_boost = cfg["severity_boost"]

    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        tg_events = [e for e in events if e.source == "tg"]
        chain_events = [e for e in events if e.source == "chain"]
        signals = []
        used_chain_ids = set()

        for te in tg_events:
            # Path 1: tx_hash match
            matched = None
            if te.tx_hash:
                for ce in chain_events:
                    if ce.tx_hash == te.tx_hash:
                        matched = ce
                        break
            # Path 2: time + usd heuristic
            if matched is None:
                for ce in chain_events:
                    if id(ce) in used_chain_ids:
                        continue
                    time_diff = abs((te.block_time - ce.block_time).total_seconds() / 60)
                    usd_diff = abs(te.amount_usd - ce.amount_usd) / max(ce.amount_usd, 1.0)
                    if time_diff <= match_window_min and usd_diff <= usd_tol_pct:
                        matched = ce
                        break
            if matched is None:
                continue
            used_chain_ids.add(id(matched))
            tx_hashes = list({h for h in [te.tx_hash, matched.tx_hash] if h})
            severity = _bump_severity("medium", severity_boost)
            channel = _external_channel_label(te)
            signals.append(Signal(
                signal_id=_new_id(),
                rule="corroborated_move",
                severity=severity,
                score=7.0,
                confidence="high",
                source="both",
                evidence_tx_hashes=tx_hashes,
                window_start=min(te.block_time, matched.block_time),
                window_end=max(te.block_time, matched.block_time),
                summary=(
                    f"Corroborated move: direct chain + {channel} both report "
                    f"${te.amount_usd:,.0f}"
                ),
                extra={
                    "observation_source": "direct_chain",
                    "cross_checked_by": channel,
                    "external_channel": te.external_channel,
                    "external_channel_handle": te.external_channel_handle,
                    "external_confidence": _external_confidence(te),
                    "chain": matched.chain,
                    "token": matched.token,
                    "amount_usd": matched.amount_usd or te.amount_usd,
                    "direction": matched.direction,
                },
            ))
        return signals

    return rule


# ---------------------------------------------------------------------------
# Rule 9: Weekly net accumulation
# ---------------------------------------------------------------------------
def _make_weekly_net_accumulation(cfg: dict) -> Callable:
    lookback_weeks = cfg["lookback_weeks"]
    deviation_sigma = cfg["deviation_sigma"]
    severity_base = cfg["severity_base"]

    def rule(events: list[Event], ctx: RuleContext) -> list[Signal]:
        cutoff = ctx.now - timedelta(weeks=1)
        week_events = [e for e in events if e.block_time >= cutoff]
        if not week_events:
            return []
        current_net = sum(
            e.amount_usd if e.direction == "in" else -e.amount_usd
            for e in week_events
            if e.source == "chain"
        )
        if current_net <= 0:
            return []
        history = ctx.weekly_net_history.get("default", [])
        if len(history) < 2:
            return []
        mean = statistics.mean(history[-lookback_weeks:])
        std = statistics.stdev(history[-lookback_weeks:]) if len(history[-lookback_weeks:]) > 1 else 1.0
        z = (current_net - mean) / max(std, 1.0)
        if z < deviation_sigma:
            return []
        score = min(10.0, 5.0 + (z - deviation_sigma) * 0.5)
        tx_hashes = [e.tx_hash for e in week_events if e.tx_hash]
        return [Signal(
            signal_id=_new_id(),
            rule="weekly_net_accumulation",
            severity=severity_base,
            score=round(score, 2),
            confidence="low",
            source="chain",
            evidence_tx_hashes=tx_hashes,
            window_start=cutoff,
            window_end=ctx.now,
            summary=f"Weekly net accumulation: ${current_net:,.0f} (z={z:.1f})",
        )]

    return rule


# ---------------------------------------------------------------------------
# Registry + loader
# ---------------------------------------------------------------------------
_MAKERS = {
    "cex_outflow_spike": _make_cex_outflow_spike,
    "cex_inflow_spike": _make_cex_inflow_spike,
    "cold_to_hot_transfer": _make_cold_to_hot_transfer,
    "smart_money_accumulation": _make_smart_money_accumulation,
    "token_whale_concentration_shift": _make_token_whale_concentration_shift,
    "tg_cex_inflow_burst": _make_tg_cex_inflow_burst,
    "external_only_observation": _make_external_only_observation,
    "corroborated_move": _make_corroborated_move,
    "weekly_net_accumulation": _make_weekly_net_accumulation,
}


def load_rules(config: dict) -> list[Callable]:
    """Return a list of rule callables from the config dict."""
    rules = []
    for rule_cfg in config.get("rules", []):
        name = rule_cfg["name"]
        maker = _MAKERS.get(name)
        if maker is None:
            raise ValueError(f"Unknown rule: {name}")
        rules.append(maker(rule_cfg))
    return rules
