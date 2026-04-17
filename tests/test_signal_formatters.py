"""Tests for Signal -> dict formatters (W1-A refactor target)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.signals.formatters import (
    event_within_signal_window,
    signal_to_sheet_dict,
    signal_to_top_item,
    signals_to_top5,
)
from src.signals.models import Event, Signal


BASE_TIME = datetime(2026, 4, 17, 12, 0, tzinfo=timezone.utc)


def _make_event(
    *,
    tx_hash: str | None = "0xabc",
    source: str = "chain",
    token: str = "USDT",
    amount_usd: float = 500_000.0,
    block_offset: timedelta = timedelta(minutes=0),
    collected_offset: timedelta | None = None,
) -> Event:
    block_time = BASE_TIME + block_offset
    collected_at = BASE_TIME + (collected_offset if collected_offset is not None else block_offset)
    return Event(
        source=source,  # type: ignore[arg-type]
        chain="ETH",
        tx_hash=tx_hash,
        watched_address=None,
        from_addr="from",
        to_addr="to",
        direction="out",
        token=token,
        amount_token=1.0,
        amount_usd=amount_usd,
        counterparty_category=None,
        block_time=block_time,
        collected_at=collected_at,
    )


def _make_signal(
    *,
    score: float = 10.0,
    evidence: list[str] | None = None,
    source: str = "chain",
    extra: dict | None = None,
    window_offset: timedelta = timedelta(minutes=5),
) -> Signal:
    return Signal(
        signal_id="sig-1",
        rule="cex_outflow",
        severity="high",
        score=score,
        confidence="high",
        source=source,  # type: ignore[arg-type]
        evidence_tx_hashes=evidence or [],
        window_start=BASE_TIME - window_offset,
        window_end=BASE_TIME + window_offset,
        summary="test signal",
        extra=extra or {},
    )


def test_event_within_signal_window_boundaries():
    signal = _make_signal(window_offset=timedelta(minutes=5))
    inside = _make_event(block_offset=timedelta(minutes=0))
    outside = _make_event(
        block_offset=timedelta(minutes=30),
        collected_offset=timedelta(minutes=30),
    )
    assert event_within_signal_window(inside, signal) is True
    assert event_within_signal_window(outside, signal) is False


def test_signal_to_top_item_prefers_evidence_events():
    evidence_event = _make_event(tx_hash="0xevidence", amount_usd=750_000.0)
    unrelated_event = _make_event(tx_hash="0xunrelated", amount_usd=9_999_999.0)
    signal = _make_signal(evidence=["0xevidence"])
    item = signal_to_top_item(signal, [evidence_event, unrelated_event])
    assert item["hash"] == "0xevidence"
    assert item["amount_usd"] == 750_000.0
    assert item["amount_usd_known"] is True
    assert item["symbol"] == "USDT"


def test_signal_to_top_item_zero_sum_falls_back_to_extra_usd():
    # NB2 regression: sum(...) == 0.0 was masking a legitimate zero total.
    # With the fix, zero total now falls through to extra so we don't misreport.
    zero_event = _make_event(tx_hash="0xz", amount_usd=0.0)
    signal = _make_signal(
        evidence=["0xz"],
        extra={"amount_usd": "250000"},
    )
    item = signal_to_top_item(signal, [zero_event])
    assert item["amount_usd"] == 250_000.0
    assert item["amount_usd_known"] is True


def test_signal_to_top_item_reports_unknown_when_no_hints():
    signal = _make_signal(evidence=[], extra={})
    item = signal_to_top_item(signal, [])
    assert item["amount_usd"] is None
    assert item["amount_usd_known"] is False
    assert item["hash"] == ""


def test_signals_to_top5_filters_and_caps():
    events: list[Event] = []
    signals = [
        _make_signal(score=float(i)) for i in range(-1, 8)  # includes 0 and negative
    ]
    result = signals_to_top5(signals, events)
    # score<=0 excluded, top 5 retained, sorted descending
    assert len(result) == 5
    scores = [entry["importance_score"] for entry in result]
    assert scores == sorted(scores, reverse=True)
    assert all(score > 0 for score in scores)


def test_signal_to_sheet_dict_preserves_core_fields():
    signal = _make_signal(extra={"note": "hi"})
    payload = signal_to_sheet_dict(signal)
    assert payload["signal_id"] == signal.signal_id
    assert payload["rule"] == signal.rule
    assert payload["severity"] == signal.severity
    assert payload["score"] == signal.score
    assert payload["extra"] == {"note": "hi"}
    assert payload["window_start"] == signal.window_start.isoformat()
    assert payload["window_end"] == signal.window_end.isoformat()
