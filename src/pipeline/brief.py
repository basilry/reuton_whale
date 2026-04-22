from __future__ import annotations

from collections import Counter
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from src.enrich.price_resolver import PriceResolver
from src.analyzer.prompt_loader import load_prompt
from src.main import (
    _build_brief_highlights,
    _build_signal_themes,
    _format_compact_usd,
    _serialize_top_transactions,
)
from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
from src.notify.pipeline_events import publish_success_event
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

def _load_brief_schedule() -> frozenset[int]:
    path = Path(__file__).resolve().parent.parent.parent / "config" / "brief_schedule.json"
    try:
        with path.open("r", encoding="utf-8") as fp:
            data = json.load(fp)
        hours = data.get("fullBriefHoursKst")
        if not isinstance(hours, list) or not all(isinstance(h, int) and 0 <= h <= 23 for h in hours):
            raise ValueError(f"invalid fullBriefHoursKst in {path}: {hours!r}")
        return frozenset(hours)
    except FileNotFoundError:
        # 로컬 dev 환경에서 config 누락 시 기존 기본값으로 폴백.
        return frozenset({9, 15, 21})


# KST 기준 full 브리핑 실행 슬롯 (09/15/21시) — config/brief_schedule.json 단일 소스
_FULL_BRIEF_HOURS_KST = _load_brief_schedule()
_KST = ZoneInfo("Asia/Seoul")

BriefMode = Literal["full", "incremental"]

# 환경변수로 조정 가능한 뉴스 상위 N건
_RSS_NEWS_TOP_N = int(os.environ.get("RSS_NEWS_TOP_N", "20"))

# full 브리핑 로그 저장 경로 루트
_BRIEF_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "brief_logs"


def _build_input_fingerprint(*, prompt_version: str, user_content: str) -> str:
    payload = json.dumps(
        {
            "prompt_version": prompt_version,
            "user_content": user_content,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _serialize_brief_signals(signals) -> str:
    return json.dumps(
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


def _signals_preview(signals, *, limit: int = 3, max_chars: int = 320) -> str:
    preview = _serialize_brief_signals(signals[:limit])
    if len(signals) > limit:
        preview = f"{preview} ... (+{len(signals) - limit} more)"
    if len(preview) > max_chars:
        return f"{preview[: max_chars - 3]}..."
    return preview


def _signal_rule_summary(signals, *, limit: int = 5) -> str:
    counts = Counter(str(getattr(signal, "rule", "") or "unknown") for signal in signals)
    if not counts:
        return "none"
    return ",".join(f"{rule}:{count}" for rule, count in counts.most_common(limit))


def _record_brief_heartbeat(sheets, result: dict[str, object]) -> None:
    append_service_heartbeat(
        sheets,
        service="pipeline.brief",
        component="pipeline",
        status=pipeline_status_to_health(result.get("status")),
        run_status=result.get("status"),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": result.get("status"),
            "details": result.get("details", ""),
        },
        error=result.get("errors", ""),
        observed_at=result.get("finished_at") or result.get("started_at"),
        processed_count=result.get("transactions_count"),
        source_name="signals+transactions+llm",
    )


def _is_full_slot(now: datetime) -> bool:
    """KST 기준 09/15/21시 대이면 True (full briefing 슬롯)."""
    kst_hour = now.astimezone(_KST).hour
    return kst_hour in _FULL_BRIEF_HOURS_KST


def _full_brief_log_path(now: datetime) -> Path:
    """당일 KST 날짜 + 슬롯 번호 기반 JSONL 경로."""
    kst = now.astimezone(_KST)
    date_str = kst.strftime("%Y-%m-%d")
    hour = kst.hour
    # 슬롯 번호: 09->1, 15->2, 21->3
    slot_map = {9: 1, 15: 2, 21: 3}
    slot = slot_map.get(hour, 0)
    return _BRIEF_LOG_DIR / f"{date_str}-slot{slot}.jsonl"


def _save_full_brief_log(now: datetime, payload: dict[str, object]) -> None:
    """full 브리핑 결과를 JSONL에 append."""
    try:
        log_path = _full_brief_log_path(now)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": now.isoformat(),
            "slot_key": _brief_slot_key(now),
            **{k: v for k, v in payload.items() if k in ("summary", "highlights", "signal_themes", "note", "input_fingerprint")},
        }
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.warning("full brief log write failed: %s", exc)


def _load_latest_full_brief_log(now: datetime) -> dict[str, object] | None:
    """당일 가장 최근 full 브리핑 로그를 반환. 없으면 None."""
    kst = now.astimezone(_KST)
    date_str = kst.strftime("%Y-%m-%d")
    log_dir = _BRIEF_LOG_DIR
    # 슬롯 역순(3->2->1->0) 탐색
    for slot in (3, 2, 1, 0):
        path = log_dir / f"{date_str}-slot{slot}.jsonl"
        if not path.exists():
            continue
        try:
            last_line = ""
            with path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    stripped = line.strip()
                    if stripped:
                        last_line = stripped
            if last_line:
                return json.loads(last_line)
        except Exception as exc:
            logger.warning("full brief log read failed path=%s: %s", path, exc)
    return None


def _build_news_context(news_rows: list[dict], *, top_n: int = _RSS_NEWS_TOP_N) -> str:
    """뉴스 피드 행 목록에서 LLM 주입용 텍스트 블록 생성."""
    if not news_rows:
        return "(없음)"
    selected = news_rows[:top_n]
    lines: list[str] = []
    for i, row in enumerate(selected, 1):
        title = str(row.get("title") or "").strip()
        summary = str(row.get("summary") or "").strip()
        source = str(row.get("source") or "").strip()
        published = str(row.get("published_at") or "").strip()[:16]  # YYYY-MM-DDTHH:MM
        if not title:
            continue
        line = f"{i}. [{source}] {title}"
        if summary:
            line += f" — {summary[:120]}"
        if published:
            line += f" ({published})"
        lines.append(line)
    return "\n".join(lines) if lines else "(없음)"


def _build_curated_context(curated_rows: list[dict]) -> str:
    """큐레이션 지갑 목록에서 LLM 주입용 텍스트 블록 생성."""
    if not curated_rows:
        return "(없음)"
    lines: list[str] = []
    for row in curated_rows[:30]:  # 최대 30개
        label = str(row.get("owner_label") or "").strip()
        category = str(row.get("owner_category") or "").strip()
        tags = str(row.get("narrative_tags") or "").strip()
        tier = str(row.get("tier") or "").strip()
        chain = str(row.get("chain") or "").strip()
        balance = str(row.get("approx_balance") or "").strip()
        if not label:
            continue
        line = f"- {label} ({category}, {chain}"
        if tier:
            line += f", tier={tier}"
        if balance:
            line += f", approx={balance}"
        if tags:
            line += f", tags=[{tags}]"
        line += ")"
        lines.append(line)
    return "\n".join(lines) if lines else "(없음)"


def _build_brief_request(
    signals,
    *,
    mode: BriefMode = "full",
    news_rows: list[dict] | None = None,
    curated_rows: list[dict] | None = None,
    prior_brief: dict[str, object] | None = None,
) -> tuple[str, str, str]:
    """시스템/유저 프롬프트와 버전 해시를 반환한다.

    mode에 따라 full/incremental 프롬프트를 선택. 없으면 기존 daily_brief.*로 폴백.
    """
    sys_prompt, sys_ver = load_prompt("daily_brief.system", mode=mode)
    user_tmpl, user_ver = load_prompt("daily_brief.user", mode=mode)
    signals_json = _serialize_brief_signals(signals)
    today = datetime.now(timezone.utc).date().isoformat()

    if mode == "incremental":
        prior_summary = str(prior_brief.get("summary") or "") if prior_brief else ""
        user_content = (
            user_tmpl
            .replace("{{date}}", today)
            .replace("{{prior_brief_summary}}", prior_summary or "(이전 브리핑 없음)")
            .replace("{{delta_signals_json}}", signals_json)
        )
    else:
        news_context = _build_news_context(news_rows or [], top_n=_RSS_NEWS_TOP_N)
        curated_context = _build_curated_context(curated_rows or [])
        user_content = (
            user_tmpl
            .replace("{{signals_json}}", signals_json)
            .replace("{{date}}", today)
            .replace("{{news_count}}", str(min(len(news_rows or []), _RSS_NEWS_TOP_N)))
            .replace("{{news_context}}", news_context)
            .replace("{{curated_context}}", curated_context)
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


def _brief_slot_key(now: datetime) -> str:
    slot = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return slot.strftime("%Y%m%dT%H00Z")


def _append_brief_cost_ledger(
    sheets,
    *,
    now: datetime,
    decision: str,
    llm_called: bool,
    model_id: str = "",
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_usd: float = 0.0,
    cumulative_cost_usd: float = 0.0,
    signal_count: int = 0,
    transaction_count: int = 0,
    input_fingerprint: str = "",
    reason: str = "",
) -> None:
    sheets.append_brief_cost_ledger(
        {
            "ts": now.isoformat(),
            "slot_key": _brief_slot_key(now),
            "decision": decision,
            "llm_called": "true" if llm_called else "false",
            "model_id": model_id,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "cumulative_cost_usd": cumulative_cost_usd,
            "signal_count": signal_count,
            "transaction_count": transaction_count,
            "input_fingerprint": input_fingerprint,
            "reason": reason,
        }
    )


def run_brief_pipeline() -> dict[str, object]:
    result = init_run_result("brief")
    errors: list[str] = []

    env = load_pipeline_env()
    sheets = build_sheets_client(env)
    guard = MonthlyBudgetGuard(sheets)
    now = datetime.now(timezone.utc)

    def record_ledger(
        *,
        decision: str,
        llm_called: bool,
        model_id: str = "",
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_usd: float = 0.0,
        cumulative_cost_usd: float | None = None,
        signal_count: int = 0,
        transaction_count: int = 0,
        input_fingerprint: str = "",
        reason: str = "",
    ) -> None:
        if cumulative_cost_usd is None:
            _, cumulative_cost_usd = guard.monthly_spend(now=now)
        _append_brief_cost_ledger(
            sheets,
            now=now,
            decision=decision,
            llm_called=llm_called,
            model_id=model_id,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
            cumulative_cost_usd=cumulative_cost_usd,
            signal_count=signal_count,
            transaction_count=transaction_count,
            input_fingerprint=input_fingerprint,
            reason=reason,
        )

    recent_since = now - timedelta(hours=1)
    recent_signal_rows = sheets.list_signals(since=recent_since, limit=50)
    recent_transaction_rows = sheets.list_transactions(since=recent_since, limit=200)
    if not recent_signal_rows and not recent_transaction_rows:
        logger.info(
            "brief generation skipped reason=inactivity recent_signals=0 recent_transactions=0 window_start=%s",
            recent_since.isoformat(),
        )
        result.update(
            status="skipped_inactive",
            finished_at=now_iso(),
            errors="[]",
            details="inactive_window=60m; signals=0; transactions=0",
        )
        record_ledger(
            decision="skipped_inactive",
            llm_called=False,
            signal_count=0,
            transaction_count=0,
            reason="inactive_window",
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        return result

    since = now - timedelta(hours=24)
    signal_rows = sheets.list_signals(since=since, limit=50)
    signals = [signal for row in signal_rows if (signal := signal_row_to_signal(row))]
    logger.info(
        "brief inputs loaded since=%s signal_rows=%d signals=%d rules=%s",
        since.isoformat(),
        len(signal_rows),
        len(signals),
        _signal_rule_summary(signals),
    )
    if not signals:
        fallback_payload, fallback_meta = _build_transaction_fallback_brief(
            sheets=sheets,
            now=now,
        )
        today = now.strftime("%Y-%m-%d")
        if fallback_payload is None:
            logger.info("brief llm call skipped reason=no_signals fallback_mode=empty")
            sheets.save_daily_brief(today, [_empty_fallback_brief(now=now)])
            result.update(
                status="completed_empty",
                finished_at=now_iso(),
                errors="[]",
                details="mode=fallback_empty; signals=0; transactions=0",
            )
            record_ledger(
                decision="completed_empty",
                llm_called=False,
                signal_count=0,
                transaction_count=0,
                reason="fallback_empty",
            )
            sheets.log_run(result)
            _record_brief_heartbeat(sheets, result)
            return result

        logger.info(
            "brief llm call skipped reason=no_signals fallback_mode=transaction transactions=%s priced=%s unpriced=%s",
            fallback_meta["transactions"],
            fallback_meta["priced"],
            fallback_meta["unpriced"],
        )
        fallback_payload["input_fingerprint"] = _build_input_fingerprint(
            prompt_version="fallback_tx",
            user_content=json.dumps(
                {
                    "transactions": fallback_meta["transactions"],
                    "priced": fallback_meta["priced"],
                    "unpriced": fallback_meta["unpriced"],
                    "total_volume_usd": round(float(fallback_meta["total_volume_usd"]), 2),
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
        )
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
        record_ledger(
            decision="transaction_fallback",
            llm_called=False,
            signal_count=0,
            transaction_count=int(fallback_meta["transactions"]),
            input_fingerprint=fallback_payload["input_fingerprint"],
            reason=(
                "no_signals_transaction_fallback;"
                f"priced={fallback_meta['priced']};unpriced={fallback_meta['unpriced']}"
            ),
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        publish_success_event(section="brief", pipeline="brief", result=result)
        return result

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

    # --- 브리핑 모드 결정 ---
    # KST 09/15/21시 슬롯이거나 당일 full 로그가 없으면 full 실행
    prior_brief = _load_latest_full_brief_log(now)
    brief_mode: BriefMode = "full" if (_is_full_slot(now) or prior_brief is None) else "incremental"
    logger.info("brief mode=%s is_full_slot=%s has_prior=%s", brief_mode, _is_full_slot(now), prior_brief is not None)

    # --- 컨텍스트 로드 (full 모드에서만) ---
    news_rows: list[dict] = []
    curated_rows: list[dict] = []
    if brief_mode == "full":
        news_since = now - timedelta(hours=24)
        try:
            news_rows = sheets.list_news_feed(since=news_since, limit=_RSS_NEWS_TOP_N * 3)
            # published_at 최신순 정렬 후 상위 N
            news_rows.sort(
                key=lambda r: str(r.get("published_at") or r.get("fetched_at") or ""),
                reverse=True,
            )
            news_rows = news_rows[:_RSS_NEWS_TOP_N]
            logger.info("brief news context loaded count=%d", len(news_rows))
        except Exception as exc:
            logger.warning("brief news context load failed: %s", exc)
        try:
            curated_rows = sheets.list_curated_wallets(active_only=True)
            logger.info("brief curated wallets loaded count=%d", len(curated_rows))
        except Exception as exc:
            logger.warning("brief curated wallets load failed: %s", exc)

    note = _encode_brief_note(
        f"signals_based|mode={brief_mode}|signals={len(signals)}|transactions={len(transaction_rows)}",
        message=(
            f"최근 저장된 거래 {len(transaction_rows)}건과 시그널 {len(signals)}건을 바탕으로 "
            f"{brief_mode} 브리핑을 생성했습니다."
        ),
        market_mood=market_mood,
    )
    today = now.strftime("%Y-%m-%d")
    budget_decision = guard.precheck("brief")
    if not budget_decision.allowed:
        logger.info(
            "brief llm call skipped reason=budget_cap spent_usd=%.4f cap_usd=%.2f",
            budget_decision.spent_usd,
            budget_decision.cap_usd,
        )
        blocked_decision = guard.log_blocked(pipeline="brief")
        result.update(
            status="skipped_budget",
            finished_at=now_iso(),
            errors="[]",
            details=(
                "budget_cap_reached "
                f"spent_usd={budget_decision.spent_usd:.4f} cap_usd={budget_decision.cap_usd:.2f}"
            ),
        )
        record_ledger(
            decision="skipped_budget",
            llm_called=False,
            cumulative_cost_usd=blocked_decision.spent_usd,
            signal_count=len(signals),
            transaction_count=len(transaction_rows),
            reason="budget_cap",
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        return result

    system_prompt, user_content, prompt_version = _build_brief_request(
        signals,
        mode=brief_mode,
        news_rows=news_rows,
        curated_rows=curated_rows,
        prior_brief=prior_brief,
    )
    input_fingerprint = _build_input_fingerprint(
        prompt_version=prompt_version,
        user_content=user_content,
    )
    cached_brief = sheets.find_daily_brief_by_fingerprint(input_fingerprint)
    if cached_brief and str(cached_brief.get("summary", "")).strip():
        logger.info(
            "brief llm call skipped reason=cache_hit input_fingerprint=%s",
            input_fingerprint[:12],
        )
        cached_summary = str(cached_brief.get("summary", "")).strip()
        cached_note = _encode_brief_note(
            (
                f"signals_based_cached|mode={brief_mode}|signals={len(signals)}|"
                f"transactions={len(transaction_rows)}|fingerprint={input_fingerprint[:12]}"
            ),
            message="동일 입력 fingerprint가 확인되어 기존 브리핑 문안을 재사용했습니다.",
            market_mood=market_mood,
        )
        sheets.save_daily_brief(
            today,
            [
                {
                    "summary": cached_summary,
                    "top_transactions": json.dumps(
                        _serialize_top_transactions(top_items), ensure_ascii=False
                    ),
                    "total_volume_usd": total_volume,
                    "alert_count": len(top_items),
                    "highlights": highlights,
                    "signal_themes": signal_themes,
                    "note": cached_note,
                    "input_fingerprint": input_fingerprint,
                }
            ],
        )
        details = (
            f"mode=cached; brief_mode={brief_mode}; signals={len(signals)}; "
            f"top_items={len(top_items)}; input_fingerprint={input_fingerprint[:12]}"
        )
        result.update(
            status="completed",
            finished_at=now_iso(),
            transactions_count=len(transaction_rows),
            errors="[]",
            details=details,
        )
        record_ledger(
            decision="cached",
            llm_called=False,
            cumulative_cost_usd=budget_decision.spent_usd,
            signal_count=len(signals),
            transaction_count=len(transaction_rows),
            input_fingerprint=input_fingerprint,
            reason="cache_hit",
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        publish_success_event(section="brief", pipeline="brief", result=result)
        logger.info("brief pipeline finished details=%s", details)
        return result

    router = build_router_from_env(env)
    signals_preview = _signals_preview(signals)
    logger.info("brief signals_json preview=%s", signals_preview)
    logger.info(
        "brief llm call attempted task=daily_brief mode=%s signals=%d news=%d prompt_version=%s preview=%s",
        brief_mode,
        len(signals),
        len(news_rows),
        prompt_version,
        signals_preview,
    )
    try:
        llm_result = router.call_task("daily_brief", system_prompt, user_content)
    except Exception as exc:
        errors.append(f"brief_generation:{exc}")
        result.update(
            status="completed_with_errors",
            finished_at=now_iso(),
            transactions_count=len(transaction_rows),
            errors=json.dumps(errors, ensure_ascii=False),
            details="Failed to generate brief text",
        )
        record_ledger(
            decision="completed_with_errors",
            llm_called=False,
            cumulative_cost_usd=budget_decision.spent_usd,
            signal_count=len(signals),
            transaction_count=len(transaction_rows),
            input_fingerprint=input_fingerprint,
            reason=str(exc),
        )
        sheets.log_run(result)
        _record_brief_heartbeat(sheets, result)
        logger.error("brief pipeline failed: %s", exc)
        return result

    logger.info(
        "brief llm call succeeded model=%s tokens_in=%d tokens_out=%d cost_usd=%.6f latency_ms=%s",
        llm_result.model_id,
        llm_result.tokens_in,
        llm_result.tokens_out,
        llm_result.cost_usd,
        llm_result.latency_ms,
    )
    usage_decision = guard.record_usage(
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

    brief_payload = {
        "summary": llm_result.text,
        "top_transactions": json.dumps(
            _serialize_top_transactions(top_items), ensure_ascii=False
        ),
        "total_volume_usd": total_volume,
        "alert_count": len(top_items),
        "highlights": highlights,
        "signal_themes": signal_themes,
        "note": note,
        "input_fingerprint": input_fingerprint,
    }
    sheets.save_daily_brief(today, [brief_payload])

    # full 브리핑은 로컬 JSONL에도 기록해 incremental 사이클의 prior 컨텍스트로 활용
    if brief_mode == "full":
        _save_full_brief_log(now, brief_payload)

    details = (
        f"brief_mode={brief_mode}; signals={len(signals)}; top_items={len(top_items)}; "
        f"news={len(news_rows)}; model={llm_result.model_id}; cost_usd={llm_result.cost_usd:.6f}"
    )
    result.update(
        status="completed",
        finished_at=now_iso(),
        transactions_count=len(transaction_rows),
        errors=json.dumps(errors, ensure_ascii=False),
        details=details,
    )
    record_ledger(
        decision="generated",
        llm_called=True,
        model_id=llm_result.model_id,
        tokens_in=llm_result.tokens_in,
        tokens_out=llm_result.tokens_out,
        cost_usd=llm_result.cost_usd,
        cumulative_cost_usd=usage_decision.spent_usd,
        signal_count=len(signals),
        transaction_count=len(transaction_rows),
        input_fingerprint=input_fingerprint,
        reason=f"generated;brief_mode={brief_mode}",
    )
    sheets.log_run(result)
    _record_brief_heartbeat(sheets, result)
    publish_success_event(section="brief", pipeline="brief", result=result)
    logger.info("brief pipeline finished details=%s", details)
    return result


def main() -> None:
    run_brief_pipeline()


if __name__ == "__main__":
    main()
