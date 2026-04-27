from __future__ import annotations

from datetime import datetime
from typing import Mapping

from src.channel.message_planner import FallbackSnapshot
from src.pipeline.common import coerce_json_list, safe_float


def _format_compact_usd(value: float) -> str:
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:,.2f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.0f}"


def _owner_label(row: Mapping[str, object], prefix: str) -> str:
    return str(
        row.get(f"{prefix}_owner")
        or row.get(f"{prefix}_owner_type")
        or row.get(f"{prefix}_address")
        or "unknown"
    ).strip()


def _movement_label(row: Mapping[str, object]) -> str:
    from_type = str(row.get("from_owner_type") or "").strip().lower()
    to_type = str(row.get("to_owner_type") or "").strip().lower()
    if from_type == "exchange" and to_type == "exchange":
        return "거래소 간 이동"
    if from_type == "exchange":
        return "거래소 유출"
    if to_type == "exchange":
        return "거래소 유입"
    return "지갑 간 이동"


def _transaction_sort_key(row: Mapping[str, object]) -> tuple[float, float]:
    amount_usd = safe_float(row.get("amount_usd"))
    amount_token = safe_float(row.get("amount"))
    return (amount_usd, amount_token)


def _format_transaction_line(row: Mapping[str, object]) -> str:
    symbol = str(row.get("symbol") or "UNKNOWN").strip().upper()
    amount_usd = safe_float(row.get("amount_usd"))
    if amount_usd > 0:
        amount_label = _format_compact_usd(amount_usd)
    else:
        amount_token = safe_float(row.get("amount"))
        if amount_token >= 100:
            amount_label = f"{amount_token:,.0f} {symbol}"
        else:
            amount_label = f"{amount_token:,.2f}".rstrip("0").rstrip(".")
            amount_label = f"{amount_label} {symbol}"
    return (
        f"• {symbol} · {amount_label} · {_movement_label(row)} · "
        f"{_owner_label(row, 'from')} → {_owner_label(row, 'to')}"
    )


def _format_signal_line(row: Mapping[str, object]) -> str:
    severity = str(row.get("severity") or "info").strip().upper()
    summary = str(row.get("summary") or "").strip() or "시그널 요약 없음"
    rule = str(row.get("rule") or "signal").strip()
    source = str(row.get("source") or "").strip()
    meta = " · ".join(part for part in [severity, rule, source] if part)
    return f"• {summary}" if not meta else f"• {summary} ({meta})"


def format_event_alert_message(
    *,
    slot_start_kst: datetime,
    signal_rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...],
    transaction_rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...],
) -> str:
    lines = [
        "<b>WhaleScope Periodic Update</b>",
        f"<i>{slot_start_kst.strftime('%Y-%m-%d %H:%M')} KST · recent 15m</i>",
    ]

    if signal_rows:
        lines.extend(["", "<b>Signals</b>"])
        for row in signal_rows[:5]:
            lines.append(_format_signal_line(row))

    if transaction_rows:
        lines.extend(["", "<b>Transactions</b>"])
        ranked_rows = sorted(transaction_rows, key=_transaction_sort_key, reverse=True)[:5]
        for row in ranked_rows:
            lines.append(_format_transaction_line(row))

    total_volume = sum(safe_float(row.get("amount_usd")) for row in transaction_rows)
    lines.extend(
        [
            "",
            (
                f"<i>signals={len(signal_rows)} | tx={len(transaction_rows)} | "
                f"volume={_format_compact_usd(total_volume)}</i>"
            ),
        ]
    )
    return "\n".join(lines).strip()


def _clip_inline(text: object, *, limit: int = 420) -> str:
    normalized = " ".join(str(text or "").split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: max(0, limit - 1)].rstrip()}…"


def _format_daily_brief_section(brief: Mapping[str, object] | None) -> list[str]:
    if not brief:
        return []

    summary = _clip_inline(brief.get("summary"))
    highlights = coerce_json_list(brief.get("highlights"))
    lines: list[str] = []
    if summary:
        lines.extend(["<b>Daily Brief</b>", summary])
    if highlights:
        if not lines:
            lines.append("<b>Daily Brief</b>")
        for item in highlights[:3]:
            lines.append(f"• {_clip_inline(item, limit=180)}")

    meta: list[str] = []
    alert_count = str(brief.get("alert_count") or "").strip()
    if alert_count:
        meta.append(f"signals={alert_count}")
    total_volume = safe_float(brief.get("total_volume_usd"))
    if total_volume > 0:
        meta.append(f"top_volume={_format_compact_usd(total_volume)}")
    if meta and lines:
        lines.append(f"<i>{' | '.join(meta)}</i>")
    return lines


def _format_news_section(news_rows: tuple[Mapping[str, object], ...]) -> list[str]:
    lines: list[str] = []
    for row in news_rows:
        title = _clip_inline(row.get("title"), limit=180)
        if not title:
            continue
        source = str(row.get("source") or "").strip()
        suffix = f" ({source})" if source else ""
        lines.append(f"• {title}{suffix}")
        if len(lines) >= 3:
            break
    if not lines:
        return []
    return ["<b>News Watch</b>", *lines]


def _format_market_snapshot_section(snapshot: Mapping[str, object] | None) -> list[str]:
    if not snapshot:
        return []

    symbol = str(snapshot.get("symbol") or "market").strip().upper()
    parts: list[str] = []
    binance_usd = safe_float(snapshot.get("binance_usd"))
    if binance_usd > 0:
        parts.append(f"Binance {_format_compact_usd(binance_usd)}")
    for key, label in (
        ("krw_premium_pct", "KRW premium"),
        ("jpy_premium_pct", "JPY premium"),
        ("eur_premium_pct", "EUR premium"),
    ):
        value = safe_float(snapshot.get(key))
        if value:
            parts.append(f"{label} {value:+.2f}%")
    if not parts:
        return []
    return ["<b>Market Snapshot</b>", f"• {symbol} · {' · '.join(parts)}"]


def format_market_pulse_message(
    *,
    now_kst: datetime,
    fallback: FallbackSnapshot,
) -> str:
    lines = [
        "<b>WhaleScope Market Pulse</b>",
        f"<i>{now_kst.strftime('%Y-%m-%d %H:%M')} KST · no new event alert</i>",
    ]

    sections = [
        _format_daily_brief_section(fallback.daily_brief),
        _format_news_section(fallback.news_rows),
        _format_market_snapshot_section(fallback.market_snapshot),
    ]
    for section in sections:
        if section:
            lines.extend(["", *section])

    lines.extend(["", f"<i>fallback={fallback.source_label or 'none'} | signals=0 | tx=0</i>"])
    return "\n".join(lines).strip()

