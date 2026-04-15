"""SignalEngine: orchestrates rule execution, corroboration, and personalization."""
from __future__ import annotations

import dataclasses
import uuid
from datetime import datetime, timedelta

from src.signals.models import Event, RuleContext, Signal
from src.signals.rules import load_rules

_SEVERITY_ORDER = ["low", "medium", "high", "critical"]


def _bump_severity(s: str, n: int = 1) -> str:
    idx = _SEVERITY_ORDER.index(s)
    return _SEVERITY_ORDER[min(idx + n, len(_SEVERITY_ORDER) - 1)]


def _corr_cfg(rules_config: dict) -> dict:
    for r in rules_config.get("rules", []):
        if r["name"] == "corroborated_move":
            return r
    return {"match_window_minutes": 3, "usd_tolerance_pct": 5.0}


class SignalEngine:
    def __init__(self, rules_config: dict, storage=None):
        self.rules = load_rules(rules_config)
        self.storage = storage
        self._corr_cfg = _corr_cfg(rules_config)

    def run(
        self,
        events: list[Event],
        now: datetime,
        baselines: dict | None = None,
    ) -> list[Signal]:
        ctx = RuleContext(now=now, chain_baselines=baselines or {})

        # Step 1: run all rules, collect raw signals
        raw: list[Signal] = []
        for rule_fn in self.rules:
            raw.extend(rule_fn(events, ctx))

        # Step 2: corroboration - mark signals source="both" when evidence
        # spans both TG and chain events
        match_min = self._corr_cfg.get("match_window_minutes", 3)
        usd_tol = self._corr_cfg.get("usd_tolerance_pct", 5.0) / 100.0

        # Build lookup: tx_hash -> sources present in events
        tx_sources: dict[str, set[str]] = {}
        for e in events:
            if e.tx_hash:
                tx_sources.setdefault(e.tx_hash, set()).add(e.source)

        # For heuristic matching: (tg_events, chain_events)
        tg_ev = [e for e in events if e.source == "tg"]
        chain_ev = [e for e in events if e.source == "chain"]

        def _is_corroborated(sig: Signal) -> bool:
            # Path 1: signal already has source="both"
            if sig.source == "both":
                return True
            # Path 2: tx_hash present in both sources
            for h in sig.evidence_tx_hashes:
                srcs = tx_sources.get(h, set())
                if "tg" in srcs and "chain" in srcs:
                    return True
            # Path 3: heuristic — find a matching event in the opposite source
            if sig.source == "chain":
                evidence_chain_events = [
                    ce for ce in chain_ev if ce.tx_hash in sig.evidence_tx_hashes
                ]
                for ce in evidence_chain_events:
                    for te in tg_ev:
                        time_diff = abs((te.block_time - ce.block_time).total_seconds() / 60)
                        usd_diff_pct = abs(te.amount_usd - ce.amount_usd) / max(ce.amount_usd, 1.0)
                        if time_diff <= match_min and usd_diff_pct <= usd_tol:
                            return True
            return False

        corroborated: list[Signal] = []
        for sig in raw:
            if _is_corroborated(sig) and sig.source != "both":
                sig = dataclasses.replace(sig, source="both")
            corroborated.append(sig)

        # Step 3: assign final signal_ids
        return [
            dataclasses.replace(sig, signal_id=uuid.uuid4().hex[:12])
            for sig in corroborated
        ]

    def personalize(self, signals: list[Signal], interests: list[dict]) -> list[Signal]:
        """Apply per-rule weight and exclude flags from user interests config."""
        # Build lookup: rule_name -> {weight, exclude}
        prefs: dict[str, dict] = {}
        for item in interests:
            rule = item.get("rule")
            if rule:
                prefs[rule] = item

        result = []
        for sig in signals:
            pref = prefs.get(sig.rule, {})
            if pref.get("exclude", False):
                continue
            weight = float(pref.get("weight", 1.0))
            new_score = sig.score * weight
            # Clamp to [score * 0.7, score * 1.5]
            new_score = max(sig.score * 0.7, min(sig.score * 1.5, new_score))
            result.append(dataclasses.replace(sig, score=round(new_score, 2)))
        return result
