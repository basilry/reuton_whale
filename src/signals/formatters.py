"""Signal -> dict conversion helpers for pipeline output."""
from __future__ import annotations

from src.signals.models import Event, Signal


def event_within_signal_window(event: Event, signal: Signal) -> bool:
    return (
        signal.window_start <= event.block_time <= signal.window_end
        or signal.window_start <= event.collected_at <= signal.window_end
    )


def signal_to_top_item(signal: Signal, events: list[Event]) -> dict:
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

    return {
        "hash": hash_value,
        "symbol": symbol,
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


def signal_to_sheet_dict(signal: Signal) -> dict:
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
        "extra": signal.extra,
    }
