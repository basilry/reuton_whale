"""Signal -> dict conversion helpers for pipeline output."""
from __future__ import annotations

from collections import Counter

from src.signals.models import Event, Signal


def event_within_signal_window(event: Event, signal: Signal) -> bool:
    return (
        signal.window_start <= event.block_time <= signal.window_end
        or signal.window_start <= event.collected_at <= signal.window_end
    )


def _candidate_events_for_signal(signal: Signal, events: list[Event]) -> list[Event]:
    events_by_hash = {e.tx_hash: e for e in events if e.tx_hash}
    evidence_events = [
        events_by_hash[h]
        for h in signal.evidence_tx_hashes
        if h in events_by_hash
    ]
    fallback_events = [
        e for e in events
        if event_within_signal_window(e, signal)
        and (
            signal.source == "both"
            or e.source == signal.source
            or (signal.source == "chain" and e.source == "chain")
            or (signal.source == "tg" and e.source == "tg")
        )
    ]
    candidate_events = evidence_events or fallback_events

    seen: set[tuple[str, str, str, str]] = set()
    deduped_events: list[Event] = []
    for event in candidate_events:
        key = (
            event.tx_hash or "",
            event.source,
            event.block_time.isoformat(),
            event.collected_at.isoformat(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped_events.append(event)
    return deduped_events


def _first_non_empty(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _looks_like_address(value: str) -> bool:
    stripped = value.strip()
    return stripped.startswith("0x") and len(stripped) >= 10


def _infer_exchange_from_event(event: Event | None) -> str | None:
    if event is None or event.counterparty_category not in {"cex", "cex_to_cex", "hot"}:
        return None
    preferred: list[str] = []
    if event.source == "tg":
        preferred.append(event.to_addr if event.direction == "in" else event.from_addr)
    preferred.extend(
        [
            event.to_addr if event.direction == "out" else event.from_addr,
            event.to_addr,
            event.from_addr,
        ]
    )
    seen: set[str] = set()
    for candidate in preferred:
        if candidate in seen:
            continue
        seen.add(candidate)
        if not candidate or candidate.lower() == "unknown" or _looks_like_address(candidate):
            continue
        return candidate
    return None


def _infer_quote_basis(signal: Signal, events: list[Event], extra: dict) -> str | None:
    explicit = _first_non_empty(
        getattr(signal, "quote_basis", None),
        extra.get("quote_basis"),
    )
    if explicit:
        return str(explicit)
    if any(e.amount_usd > 0 for e in events):
        return "usd_notional"
    amount_hint = _first_non_empty(
        extra.get("amount_usd"),
        extra.get("total_usd"),
        extra.get("notional_usd"),
    )
    if amount_hint not in (None, ""):
        return "usd_notional"
    return None


def _enrich_signal_extra(signal: Signal, events: list[Event] | None = None) -> dict:
    candidate_events = _candidate_events_for_signal(signal, events or [])
    first_event = candidate_events[0] if candidate_events else None
    extra = dict(signal.extra or {})

    asset = _first_non_empty(
        getattr(signal, "asset", None),
        extra.get("asset"),
        extra.get("symbol"),
        extra.get("token"),
        first_event.token if first_event else None,
    )
    exchange = _first_non_empty(
        getattr(signal, "exchange", None),
        extra.get("exchange"),
        extra.get("venue"),
        _infer_exchange_from_event(first_event),
    )
    direction = _first_non_empty(
        getattr(signal, "flow_direction", None),
        extra.get("flow_direction"),
        extra.get("direction"),
        first_event.direction if first_event else None,
    )
    quote_basis = _infer_quote_basis(signal, candidate_events, extra)
    chain = _first_non_empty(extra.get("chain"), first_event.chain if first_event else None)

    if asset:
        extra.setdefault("asset", str(asset))
    if exchange:
        extra.setdefault("exchange", str(exchange))
    if direction:
        extra.setdefault("direction", str(direction))
    if quote_basis:
        extra.setdefault("quote_basis", str(quote_basis))
    if chain:
        extra.setdefault("chain", str(chain))
    if candidate_events:
        extra.setdefault("event_count", len(candidate_events))
    if signal.source == "both":
        source_counts = Counter(event.source for event in candidate_events)
        extra.setdefault("source_breakdown", dict(source_counts))

    return extra


def signal_to_top_item(signal: Signal, events: list[Event]) -> dict:
    deduped_events = _candidate_events_for_signal(signal, events)

    first_event = deduped_events[0] if deduped_events else None
    # NB2 fix: ``sum(...) or None`` masked a legitimate 0.0 as missing.
    # Require a strictly positive total before using it; otherwise fall
    # through to the signal.extra hints so the summary path stays accurate.
    total_usd = sum(e.amount_usd for e in deduped_events)
    amount_usd: float | None = total_usd if total_usd > 0 else None
    if amount_usd is None:
        raw_amount = (
            signal.extra.get("amount_usd")
            or signal.extra.get("total_usd")
            or signal.extra.get("notional_usd")
        )
        amount_usd = float(raw_amount) if raw_amount not in (None, "") else None

    symbol = ""
    if first_event and first_event.token:
        symbol = first_event.token
    else:
        symbol = (
            str(signal.extra.get("token") or signal.extra.get("symbol") or "")
            or signal.source.upper()
            or signal.rule
        )

    hash_value = next((h for h in signal.evidence_tx_hashes if h), "")
    if not hash_value and first_event and first_event.tx_hash:
        hash_value = first_event.tx_hash

    chain = ""
    if first_event and first_event.chain:
        chain = first_event.chain
    else:
        chain = str(signal.extra.get("chain") or "")

    return {
        "hash": hash_value,
        "symbol": symbol,
        "chain": chain,
        "amount_usd": amount_usd,
        "amount_usd_known": amount_usd is not None,
        "importance_score": signal.score,
        "interpretation": signal.summary,
        "type": signal.rule,
        "signal_id": signal.signal_id,
        "rule": signal.rule,
        "severity": signal.severity,
        "source": signal.source,
        "confidence": signal.confidence,
        "evidence_count": len(signal.evidence_tx_hashes),
        "window_start": signal.window_start.isoformat(),
        "window_end": signal.window_end.isoformat(),
        "summary": signal.summary,
    }


def signals_to_top5(signals: list[Signal], events: list[Event]) -> list[dict]:
    valid = [sig for sig in signals if sig.score > 0]
    top_signals = sorted(valid, key=lambda sig: sig.score, reverse=True)[:5]
    return [signal_to_top_item(sig, events) for sig in top_signals]


def signal_to_sheet_dict(signal: Signal, events: list[Event] | None = None) -> dict:
    return {
        "signal_id": signal.signal_id,
        "rule": signal.rule,
        "severity": signal.severity,
        "score": signal.score,
        "confidence": signal.confidence,
        "source": signal.source,
        "evidence_tx_hashes": signal.evidence_tx_hashes,
        "window_start": signal.window_start.isoformat(),
        "window_end": signal.window_end.isoformat(),
        "summary": signal.summary,
        "extra": _enrich_signal_extra(signal, events),
    }
