from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from src.enrich.price_resolver import PriceResolver
from src.analyzer.prompt_loader import load_prompt
from src.main import (
    _build_brief_highlights,
    _build_signal_themes,
    _format_compact_usd,
    _serialize_top_transactions,
)
from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
from src.pipeline.common import (
    build_router_from_env,
    build_sheets_client,
    init_run_result,
    load_pipeline_env,
    safe_float,
    signal_row_to_signal,
    signal_row_to_top_item,
)
from src.router.budget import MonthlyBudgetGuard
from src.storage.queries import now_iso
from src.utils.number_utils import safe_float as numeric_safe_float
from src.utils.logger import get_logger

logger = get_logger("pipeline.brief")


def _record_brief_heartbeat(sheets, result: dict[str, object]) -> None:
    append_service_heartbeat(
        sheets,
        service="pipeline.brief",
        component="pipeline",
        status=pipeline_status_to_health(result.get("status")),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": result.get("status"),
            "details": result.get("details", ""),
        },
        error=result.get("errors", ""),
    )


def _build_brief_request(signals) -> tuple[str, str, str]:
    sys_prompt, sys_ver = load_prompt("daily_brief.system")
    user_tmpl, user_ver = load_prompt("daily_brief.user")
    signals_json = json.dumps(
        [
            {
                "rule": signal.rule,
                "severity": signal.severity,
                "score": signal.score,
                "summary": signal.summary,
                "source": signal.source,
                "confidence": signal.confidence,
            }
            for signal in signals
        ],
        ensure_ascii=False,
    )
    today = datetime.now(timezone.utc).date().isoformat()
    user_content = user_tmpl.replace("{{signals_json}}", signals_json).replace(
        "{{date}}", today
    )
    return sys_prompt, user_content, f"{sys_ver}+{user_ver}"


def _tx_float(value: object) -> float:
    return numeric_safe_float(
        value,
        default=0.0,
        strip_commas=True,
        field_name="brief_fallback",
        logger=logger,
    )


def _format_token_amount(value: float) -> str:
    if value >= 100:
        return f"{value:,.0f}"
    if value >= 1:
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    return f"{value:,.4f}".rstrip("0").rstrip(".")


def _movement_label(row: dict) -> str:
    from_type = str(row.get("from_owner_type") or "").strip().lower()
    to_type = str(row.get("to_owner_type") or "").strip().lower()
    if from_type == "exchange" and to_type == "exchange":
        return "거래소 간 이동"
    if from_type == "exchange":
        return "거래소 유출"
    if to_type == "exchange":
        return "거래소 유입"
    return "지갑 간 이동"


def _fallback_importance_score(amount_usd: float | None) -> float:
    value = safe_float(amount_usd)
    if value >= 100_000_000:
        return 9.0
    if value >= 50_000_000:
        return 8.0
    if value >= 10_000_000:
        return 7.0
    if value >= 1_000_000:
        return 6.0
    return 4.0


def _fallback_highlights(top_items: list[dict]) -> list[str]:
    highlights: list[str] = []
    for item in top_items[:4]:
        symbol = str(item.get("symbol") or "UNKNOWN")
        amount_usd = item.get("amount_usd")
        movement = str(item.get("movement_label") or "온체인 이동")
        if amount_usd not in (None, ""):
            amount_label = _format_compact_usd(safe_float(amount_usd))
        else:
            token_amount = safe_float(item.get("amount_token"))
            amount_label = f"{_format_token_amount(token_amount)} {symbol}"
        highlights.append(f"{symbol} · {amount_label} · {movement}")
    return highlights


def _bounded_score(value: float) -> int:
    return max(-100, min(100, int(round(value))))


def _market_mood_slug(score: int, *, watch_count: int = 0) -> str:
    if score <= -45:
        return "risk_off"
    if score >= 45:
        return "risk_on"
    if watch_count > 0 or score <= -15 or score >= 15:
        return "watch"
    return "neutral"


def _encode_brief_note(
    note_prefix: str,
    *,
    message: str,
    market_mood: dict[str, object],
) -> str:
    payload = {
        "market_mood": market_mood,
    }
    return (
        f"{note_prefix}|message={message}"
        f"||meta:{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"
    )


def _build_fallback_market_mood(
    *,
    now: datetime,
    transaction_count: int,
    total_volume_usd: float,
    top_item: dict[str, object],
) -> dict[str, object]:
    movement = str(top_item.get("movement_label") or "지갑 간 이동")
    symbol = str(top_item.get("symbol") or "UNKNOWN")
    score = 0
    drivers: list[dict[str, str | int]] = [
        {
            "label": "transaction_count",
            "value": transaction_count,
            "direction": "neutral",
        }
    ]

    if "거래소 유입" in movement:
        score -= 32
        drivers.append(
            {
                "label": "exchange_inflow",
                "value": symbol,
                "direction": "bearish",
            }
        )
    elif "거래소 유출" in movement:
        score += 28
        drivers.append(
            {
                "label": "exchange_outflow",
                "value": symbol,
                "direction": "bullish",
            }
        )

    if total_volume_usd >= 100_000_000:
        score += -14 if score < 0 else 12 if score > 0 else 0
        drivers.append(
            {
                "label": "priced_volume_usd",
                "value": _format_compact_usd(total_volume_usd),
                "direction": "bearish" if score < 0 else "bullish" if score > 0 else "neutral",
            }
        )
    elif total_volume_usd > 0:
        drivers.append(
            {
                "label": "priced_volume_usd",
                "value": _format_compact_usd(total_volume_usd),
                "direction": "neutral",
            }
        )

    bounded = _bounded_score(score)
    return {
        "mood": _market_mood_slug(bounded),
        "score": bounded,
        "drivers": drivers[:3],
        "as_of": now.isoformat(),
    }


def _build_signal_market_mood(
    *,
    now: datetime,
    signals,
    top_items: list[dict[str, object]],
    total_volume_usd: float,
) -> dict[str, object]:
    critical_count = 0
    watch_count = 0
    positive_count = 0
    inflow_count = 0
    outflow_count = 0

    for signal in signals:
        severity = str(getattr(signal, "severity", "") or "").lower()
        score = safe_float(getattr(signal, "score", 0))
        rule = str(getattr(signal, "rule", "") or "")

        if severity in {"critical", "high"} or score >= 8:
            critical_count += 1
        elif severity in {"medium", "warn", "warning"} or score >= 5:
            watch_count += 1

        if rule in {"smart_money_accumulation", "weekly_net_accumulation", "cex_outflow_spike"}:
            positive_count += 1
            outflow_count += 1

        if rule in {"cex_inflow_spike", "tg_cex_inflow_burst", "cold_to_hot_transfer"}:
            inflow_count += 1

    score = 0.0
    drivers: list[dict[str, str | int]] = []

    if inflow_count > 0:
        score -= min(54, inflow_count * 18)
        drivers.append(
            {
                "label": "exchange_inflow_signals",
                "value": inflow_count,
                "direction": "bearish",
            }
        )

    if outflow_count > 0:
        score += min(45, outflow_count * 15)
        drivers.append(
            {
                "label": "exchange_outflow_signals",
                "value": outflow_count,
                "direction": "bullish",
            }
        )

    if critical_count > 0:
        score -= min(30, critical_count * 10)
        drivers.append(
            {
                "label": "critical_signals",
                "value": critical_count,
                "direction": "bearish",
            }
        )
    elif watch_count > 0:
        drivers.append(
            {
                "label": "watch_signals",
                "value": watch_count,
                "direction": "neutral",
            }
        )

    if positive_count > 0:
        score += min(24, positive_count * 8)

    if total_volume_usd > 0 and len(drivers) < 3:
        drivers.append(
            {
                "label": "priced_volume_usd",
                "value": _format_compact_usd(total_volume_usd),
                "direction": "neutral",
            }
        )
    elif top_items and len(drivers) < 3:
        drivers.append(
            {
                "label": "top_asset",
                "value": str(top_items[0].get("symbol") or "UNKNOWN"),
                "direction": "neutral",
            }
        )

    bounded = _bounded_score(score)
    return {
        "mood": _market_mood_slug(bounded, watch_count=watch_count),
        "score": bounded,
        "drivers": drivers[:3],
        "as_of": now.isoformat(),
    }


def _fallback_summary(
    *,
    transaction_count: int,
    priced_count: int,
    total_volume_usd: float,
    top_item: dict,
) -> str:
    symbol = str(top_item.get("symbol") or "UNKNOWN")
    direction = str(top_item.get("movement_label") or "온체인 이동")
    amount_usd = top_item.get("amount_usd")
    if amount_usd not in (None, "") and safe_float(amount_usd) > 0:
        return (
            f"최근 60분 온체인 대형 이동 {transaction_count}건 감지. "
            f"USD 환산 가능 {priced_count}건 기준 총 {_format_compact_usd(total_volume_usd)}. "
            f"최대 이동 {symbol} {_format_compact_usd(safe_float(amount_usd))} ({direction})."
        )

    amount_token = _format_token_amount(safe_float(top_item.get("amount_token")))
    return (
        f"최근 60분 온체인 이동 {transaction_count}건 감지. "
        f"대표 이동은 {symbol} {amount_token}건 규모이며 성격은 {direction}입니다. "
        "USD 환산은 현재 가격 응답 지연으로 일부 보류되었습니다."
    )


def _empty_fallback_brief(*, now: datetime) -> dict[str, object]:
    market_mood = {
        "mood": "neutral",
        "score": 0,
        "drivers": [
            {
                "label": "transaction_count",
                "value": 0,
                "direction": "neutral",
            }
        ],
        "as_of": now.isoformat(),
    }
    return {
        "summary": (
            "최근 60분 기준 대형 온체인 이동이 확인되지 않았습니다. "
            "데이터 파이프라인은 정상 작동 중이며 다음 슬롯에서 다시 갱신합니다."
        ),
        "top_transactions": json.dumps([], ensure_ascii=False),
        "total_volume_usd": 0.0,
        "alert_count": 0,
        "highlights": [],
        "signal_themes": ["온체인 대형 이동 모니터링"],
        "note": _encode_brief_note(
            f"fallback_empty|signals=0|window_min=60|generated_at={now.isoformat()}",
            message="최근 60분 대형 이동이 없어 시장 맥락 중심 fallback 브리핑을 생성했습니다.",
            market_mood=market_mood,
        ),
    }


def _build_transaction_fallback_brief(
    *,
    sheets,
    now: datetime,
) -> tuple[dict[str, object] | None, dict[str, int | float | str]]:
    window_start = now - timedelta(minutes=60)
    resolver = PriceResolver()
    transaction_rows = sheets.list_transactions(since=window_start, limit=200)
    if not transaction_rows:
        return None, {
            "transactions": 0,
            "priced": 0,
            "unpriced": 0,
            "total_volume_usd": 0.0,
            "price_sources": "",
        }

    ranked: list[dict[str, object]] = []
    price_sources: dict[str, int] = {}
    priced_count = 0
    total_volume_usd = 0.0

    for row in transaction_rows:
        symbol = str(row.get("symbol") or "UNKNOWN").strip().upper()
        amount_token = _tx_float(row.get("amount"))
        amount_usd = _tx_float(row.get("amount_usd"))
        amount_usd_known = amount_usd > 0
        amount_source = "transaction"

        if not amount_usd_known and amount_token > 0 and symbol:
            quote = resolver.resolve(symbol, at=now)
            if quote is not None:
                amount_usd = amount_token * quote.price_usd
                amount_usd_known = amount_usd > 0
                amount_source = quote.source
        if amount_usd_known:
            priced_count += 1
            total_volume_usd += amount_usd

        price_sources[amount_source] = price_sources.get(amount_source, 0) + 1
        ranked.append(
            {
                "hash": str(row.get("hash") or row.get("raw_response_hash") or ""),
                "symbol": symbol,
                "chain": str(row.get("blockchain") or ""),
                "amount_token": amount_token,
                "amount_usd": amount_usd if amount_usd_known else None,
                "amount_usd_known": amount_usd_known,
                "importance_score": _fallback_importance_score(
                    amount_usd if amount_usd_known else None
                ),
                "interpretation": (
                    f"{_movement_label(row)} · "
                    f"{str(row.get('from_owner') or row.get('from_owner_type') or 'unknown')} → "
                    f"{str(row.get('to_owner') or row.get('to_owner_type') or 'unknown')}"
                ),
                "type": "fallback_transaction",
                "signal_id": "",
                "rule": "fallback_transaction",
                "severity": "info",
                "source": "chain",
                "confidence": "medium",
                "evidence_count": 1,
                "window_start": window_start.isoformat(),
                "window_end": now.isoformat(),
                "movement_label": _movement_label(row),
                "amount_source": amount_source,
            }
        )

    ranked.sort(
        key=lambda item: (
            0 if item.get("amount_usd_known") else 1,
            -safe_float(item.get("amount_usd")),
            -safe_float(item.get("amount_token")),
        )
    )
    top_items = ranked[:5]
    top_item = top_items[0] if top_items else {}
    market_mood = _build_fallback_market_mood(
        now=now,
        transaction_count=len(transaction_rows),
        total_volume_usd=total_volume_usd,
        top_item=top_item,
    )
    payload = {
        "summary": _fallback_summary(
            transaction_count=len(transaction_rows),
            priced_count=priced_count,
            total_volume_usd=total_volume_usd,
            top_item=top_item,
        ),
        "top_transactions": json.dumps(
            _serialize_top_transactions(top_items),
            ensure_ascii=False,
        ),
        "total_volume_usd": total_volume_usd,
        "alert_count": 0,
        "highlights": _fallback_highlights(top_items),
        "signal_themes": ["온체인 대형 이동", "시그널 부족 fallback"],
        "note": _encode_brief_note(
            "fallback_tx_based|signals=0|window_min=60|"
            f"transactions={len(transaction_rows)}|priced={priced_count}|"
            f"unpriced={len(transaction_rows) - priced_count}",
            message="시그널이 없어 최근 60분 온체인 이동 기준으로 브리핑을 구성했습니다.",
            market_mood=market_mood,
        ),
    }
    metadata = {
        "transactions": len(transaction_rows),
        "priced": priced_count,
        "unpriced": len(transaction_rows) - priced_count,
        "total_volume_usd": total_volume_usd,
        "price_sources": ",".join(
            f"{source}:{count}" for source, count in sorted(price_sources.items())
        ),
    }
    return payload, metadata


def run_brief_pipeline() -> dict[str, object]:
    result = init_run_result("brief")
    errors: list[str] = []

    env = load_pipeline_env()
    sheets = build_sheets_client(env)
    guard = MonthlyBudgetGuard(sheets)
    decision = guard.precheck("brief")
    if not decision.allowed:
        guard.log_blocked(pipeline="brief")
        result.update(
            status="skipped_budget",
            finished_at=now_iso(),
            errors="[]",
            details=f"budget_cap_reached spent_usd={decision.spent_usd:.4f} cap_usd={decision.cap_usd:.2f}",
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        return result

    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)
    signal_rows = sheets.list_signals(since=since, limit=50)
    signals = [signal for row in signal_rows if (signal := signal_row_to_signal(row))]
    if not signals:
        fallback_payload, fallback_meta = _build_transaction_fallback_brief(
            sheets=sheets,
            now=now,
        )
        today = now.strftime("%Y-%m-%d")
        if fallback_payload is None:
            sheets.save_daily_brief(today, [_empty_fallback_brief(now=now)])
            result.update(
                status="completed_empty",
                finished_at=now_iso(),
                errors="[]",
                details="mode=fallback_empty; signals=0; transactions=0",
            )
            sheets.log_run(result)
            _record_brief_heartbeat(sheets, result)
            return result

        sheets.save_daily_brief(today, [fallback_payload])
        result.update(
            status="completed",
            finished_at=now_iso(),
            transactions_count=int(fallback_meta["transactions"]),
            errors="[]",
            details=(
                "mode=fallback_tx; signals=0; "
                f"transactions={fallback_meta['transactions']}; "
                f"priced={fallback_meta['priced']}; "
                f"unpriced={fallback_meta['unpriced']}; "
                f"total_volume_usd={fallback_meta['total_volume_usd']:.2f}; "
                f"price_sources={fallback_meta['price_sources']}"
            ),
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        return result

    router = build_router_from_env(env)
    system_prompt, user_content, prompt_version = _build_brief_request(signals)
    try:
        llm_result = router.call_task("daily_brief", system_prompt, user_content)
    except Exception as exc:
        errors.append(f"brief_generation:{exc}")
        result.update(
            status="completed_with_errors",
            finished_at=now_iso(),
            transactions_count=0,
            errors=json.dumps(errors, ensure_ascii=False),
            details="Failed to generate brief text",
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        logger.error("brief pipeline failed: %s", exc)
        return result

    guard.record_usage(
        pipeline="brief",
        model_id=llm_result.model_id,
        tokens_in=llm_result.tokens_in,
        tokens_out=llm_result.tokens_out,
        cost_usd=llm_result.cost_usd,
        decision="generated",
    )
    sheets.save_analysis_log(
        {
            "task": "daily_brief",
            "model_id": llm_result.model_id,
            "prompt_version": prompt_version,
            "tokens_in": llm_result.tokens_in,
            "tokens_out": llm_result.tokens_out,
            "cost_usd": llm_result.cost_usd,
            "latency_ms": llm_result.latency_ms,
            "status": "ok",
        }
    )

    top_items = sorted(
        (signal_row_to_top_item(row) for row in signal_rows),
        key=lambda item: safe_float(item.get("importance_score")),
        reverse=True,
    )[:5]
    transaction_rows = sheets.list_transactions(since=since, limit=200)
    total_volume = sum(safe_float(item.get("amount_usd")) for item in top_items)
    highlights = _build_brief_highlights(top_items)
    signal_themes = _build_signal_themes(signals, top_items)
    market_mood = _build_signal_market_mood(
        now=now,
        signals=signals,
        top_items=top_items,
        total_volume_usd=total_volume,
    )
    note = _encode_brief_note(
        f"signals_based|signals={len(signals)}|transactions={len(transaction_rows)}",
        message=(
            f"최근 저장된 거래 {len(transaction_rows)}건과 시그널 {len(signals)}건을 바탕으로 "
            "일일 브리핑을 생성했습니다."
        ),
        market_mood=market_mood,
    )
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sheets.save_daily_brief(
        today,
        [
            {
                "summary": llm_result.text,
                "top_transactions": json.dumps(
                    _serialize_top_transactions(top_items), ensure_ascii=False
                ),
                "total_volume_usd": total_volume,
                "alert_count": len(top_items),
                "highlights": highlights,
                "signal_themes": signal_themes,
                "note": note,
            }
        ],
    )

    details = (
        f"signals={len(signals)}; top_items={len(top_items)}; "
        f"model={llm_result.model_id}; cost_usd={llm_result.cost_usd:.6f}"
    )
    result.update(
        status="completed",
        finished_at=now_iso(),
        transactions_count=len(transaction_rows),
        errors=json.dumps(errors, ensure_ascii=False),
        details=details,
    )
    sheets.log_run(result)
    _record_brief_heartbeat(sheets, result)
    logger.info("brief pipeline finished details=%s", details)
    return result


def main() -> None:
    run_brief_pipeline()


if __name__ == "__main__":
    main()
