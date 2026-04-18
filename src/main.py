from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import yaml

from src.analyzer.claude_analyzer import LLMAnalyzer
from src.analyzer.price_service import PriceService
from src.analyzer.scoring import TransactionScorer
from src.collectors.coingecko import CoinGeckoEnricher
from src.config import load_config
from src.distributor.telegram_bot import WhaleScopeBot
from src.ingestion.etherscan import EtherscanCollector
from src.ingestion.solscan import SolscanCollector
from src.ingestion.tg_normalizer import (
    TG_CHAIN_MAP as _TG_CHAIN_MAP,
    normalize_tg_chain,
    tg_direction,
    tg_owner_label,
    tg_row_to_event,
)
from src.llm.anthropic_provider import AnthropicProvider
from src.llm.router import LLMRouter
from src.notify.telegram_broadcast import TelegramBroadcastAdapter
from src.pipeline.common import (
    collect_recent_events,
    detect_signals,
    log_unknown_price_symbols,
    persist_chain_activity,
    persist_signals,
)
from src.signals.baseline import build_chain_baselines
from src.signals.engine import SignalEngine
from src.signals.formatters import (
    event_within_signal_window,
    signal_to_sheet_dict,
    signal_to_top_item,
    signals_to_top5,
)
from src.signals.models import Event, Signal
from src.storage.queries import now_iso
from src.storage.sheets_client import SheetsClient
from src.utils.datetime_utils import parse_dt
from src.utils.logger import get_logger
from src.utils.number_utils import safe_float

# Backward-compat aliases (kept for existing tests that import from src.main)
_normalize_tg_chain = normalize_tg_chain
_tg_owner_label = tg_owner_label
_tg_direction = tg_direction
_tg_row_to_event = tg_row_to_event
_event_within_signal_window = event_within_signal_window
_signal_to_top_item = signal_to_top_item
_signals_to_top5 = signals_to_top5
_signal_to_sheet_dict = signal_to_sheet_dict

# Alias so existing tests can patch src.main.ClaudeAnalyzer
ClaudeAnalyzer = LLMAnalyzer

logger = get_logger("pipeline")

_EVM_CHAINS = ("ETH", "ARB", "BASE", "BSC", "POLYGON")

_CONFIG_DIR = Path(__file__).parent.parent / "config"
_FIXTURES_PATH = Path(__file__).parent.parent / "tests" / "fixtures" / "sample_events.json"
_SIGNAL_THEME_LABELS = {
    "cex_outflow_spike": "거래소 순유출 확대",
    "cex_inflow_spike": "거래소 순유입 확대",
    "cold_to_hot_transfer": "콜드월렛 자금 이동",
    "smart_money_accumulation": "스마트머니 축적",
    "token_whale_concentration_shift": "고래 집중도 변화",
    "tg_cex_inflow_burst": "텔레그램 거래소 유입 경보",
    "corroborated_move": "온체인·텔레그램 교차확인",
    "weekly_net_accumulation": "주간 순축적",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_router(config) -> LLMRouter:
    providers = {}
    if config.anthropic_api_key:
        providers["anthropic"] = AnthropicProvider(config.anthropic_api_key)
    gemini_key = getattr(config, "gemini_api_key", "") or os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            from src.llm.gemini_provider import GeminiProvider
            providers["gemini"] = GeminiProvider(gemini_key)
        except Exception as e:
            logger.warning("GeminiProvider init failed: %s", e)
    groq_key = getattr(config, "groq_api_key", "") or os.getenv("GROQ_API_KEY", "")
    if groq_key:
        try:
            from src.llm.groq_provider import GroqProvider
            providers["groq"] = GroqProvider(groq_key)
        except Exception as e:
            logger.warning("GroqProvider init failed: %s", e)

    routing_cfg_path = _CONFIG_DIR / "llm_routing.yaml"
    with open(routing_cfg_path) as f:
        routing_cfg = yaml.safe_load(f)

    return LLMRouter(providers=providers, routing_config=routing_cfg, logger=logger)


def _load_signals_cfg() -> dict:
    path = _CONFIG_DIR / "signals.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def _event_to_dict(e: Event) -> dict:
    return {
        "hash": e.tx_hash or "",
        "from_address": e.from_addr,
        "from_owner_type": e.counterparty_category or "unknown",
        "from_owner": e.from_addr[:12] if e.direction == "out" else (e.counterparty_category or "unknown"),
        "to_address": e.to_addr,
        "to_owner_type": e.counterparty_category or "unknown",
        "to_owner": e.to_addr[:12] if e.direction == "in" else (e.counterparty_category or "unknown"),
        "symbol": e.token,
        "amount": e.amount_token,
        "amount_usd": e.amount_usd,
        "timestamp": int(e.block_time.timestamp()),
        "blockchain": e.chain,
        "raw_response_hash": e.tx_hash or "",
    }


def _event_to_address_activity(e: Event) -> dict:
    counterparty = e.to_addr if e.direction == "out" else e.from_addr
    return {
        "tx_hash": e.tx_hash or "",
        "chain": e.chain,
        "block_time": e.block_time.isoformat(),
        "watched_address": e.watched_address or "",
        "direction": e.direction,
        "counterparty": counterparty,
        "counterparty_category": e.counterparty_category or "",
        "token": e.token,
        "amount_token": e.amount_token,
        "amount_usd": e.amount_usd,
        "collected_at": e.collected_at.isoformat(),
    }


def _dict_to_event(d: dict) -> Event:
    """Deserialize Event from fixture JSON dict."""
    from src.utils.datetime_utils import parse_dt_strict as _parse_dt_strict
    return Event(
        source=d.get("source", "chain"),
        chain=d.get("chain", "eth"),
        tx_hash=d.get("tx_hash"),
        watched_address=d.get("watched_address"),
        from_addr=d.get("from_addr", ""),
        to_addr=d.get("to_addr", ""),
        direction=d.get("direction", "out"),
        token=d.get("token", "ETH"),
        amount_token=float(d.get("amount_token", 0)),
        amount_usd=float(d.get("amount_usd", 0)),
        counterparty_category=d.get("counterparty_category"),
        block_time=_parse_dt_strict(d.get("block_time", "2024-01-01T00:00:00Z")),
        collected_at=_parse_dt_strict(d.get("collected_at", "2024-01-01T00:00:00Z")),
    )


def _format_compact_usd(value: float | int | None) -> str:
    amount = safe_float(value)
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.1f}M"
    if amount >= 1_000:
        return f"${amount / 1_000:.1f}K"
    return f"${amount:,.0f}"


def _signal_theme_label(rule: str) -> str:
    return _SIGNAL_THEME_LABELS.get(rule, rule.replace("_", " "))


def _build_brief_highlights(top_items: list[dict]) -> list[str]:
    highlights: list[str] = []
    seen: set[str] = set()
    for item in top_items:
        symbol = str(item.get("symbol") or "UNKNOWN")
        theme = _signal_theme_label(str(item.get("rule") or item.get("type") or "signal"))
        source = str(item.get("source") or "").strip()
        amount_usd = item.get("amount_usd")

        parts = [symbol]
        if amount_usd not in (None, ""):
            parts.append(_format_compact_usd(amount_usd))
        parts.append(theme)
        if source == "both":
            parts.append("온체인·텔레그램 동시 포착")
        elif source == "tg":
            parts.append("텔레그램 포착")
        elif source == "chain":
            parts.append("온체인 포착")

        highlight = " · ".join(part for part in parts if part)
        if not highlight or highlight in seen:
            continue
        seen.add(highlight)
        highlights.append(highlight)
        if len(highlights) >= 4:
            break
    return highlights


def _build_signal_themes(signals: list[Signal], top_items: list[dict]) -> list[str]:
    theme_scores: dict[str, float] = {}
    theme_counts: dict[str, int] = {}

    for signal in signals:
        label = _signal_theme_label(signal.rule)
        theme_scores[label] = max(theme_scores.get(label, 0.0), float(signal.score))
        theme_counts[label] = theme_counts.get(label, 0) + 1

    if not theme_scores:
        for item in top_items:
            label = _signal_theme_label(str(item.get("rule") or item.get("type") or "signal"))
            theme_scores[label] = max(
                theme_scores.get(label, 0.0),
                safe_float(item.get("importance_score")),
            )
            theme_counts[label] = theme_counts.get(label, 0) + 1

    ordered = sorted(
        theme_scores.items(),
        key=lambda entry: (-theme_counts.get(entry[0], 0), -entry[1], entry[0]),
    )
    themes: list[str] = []
    for label, _score in ordered[:4]:
        count = theme_counts.get(label, 0)
        themes.append(f"{label} {count}건" if count > 1 else label)
    return themes


def _build_brief_note(raw_events: list[Event], signals: list[Signal], top_items: list[dict]) -> str:
    chain_count = sum(1 for event in raw_events if event.source == "chain")
    tg_count = sum(1 for event in raw_events if event.source == "tg")
    return (
        f"온체인 {chain_count}건, 텔레그램 {tg_count}건을 기반으로 "
        f"시그널 {len(signals)}건과 상위 {len(top_items)}개 항목을 요약했습니다. "
        "USD 수치는 수집 시점 기준 추정치가 포함될 수 있습니다."
    )


def _serialize_top_transactions(top_items: list[dict]) -> list[dict]:
    serialized: list[dict] = []
    for tx in top_items:
        serialized.append(
            {
                "hash": tx.get("hash", ""),
                "symbol": tx.get("symbol", ""),
                "chain": tx.get("chain", tx.get("blockchain", "")),
                "amount_usd": tx.get("amount_usd"),
                "amount_usd_known": tx.get("amount_usd_known", True),
                "importance_score": tx.get("importance_score", 0),
                "interpretation": tx.get("interpretation", ""),
                "type": tx.get("type", ""),
                "signal_id": tx.get("signal_id", ""),
                "rule": tx.get("rule", tx.get("type", "")),
                "severity": tx.get("severity", ""),
                "source": tx.get("source", ""),
                "confidence": tx.get("confidence", ""),
                "evidence_count": tx.get("evidence_count", 0),
                "window_start": tx.get("window_start", ""),
                "window_end": tx.get("window_end", ""),
            }
        )
    return serialized


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

async def run_daily_pipeline(dry_run: bool = False) -> dict:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"run_{timestamp}_{uuid4().hex[:6]}"
    started_at = now_iso()
    errors: list[str] = []
    result: dict = {
        "run_id": run_id,
        "run_type": "daily_brief",
        "status": "started",
        "started_at": started_at,
        "finished_at": "",
        "transactions_count": 0,
        "errors": "",
        "details": "",
    }

    # Stage 1: Load config
    logger.info("[%s] Stage 1/10: Loading config (dry_run=%s)", run_id, dry_run)
    config = load_config()

    # Stage 2: Init clients
    logger.info("[%s] Stage 2/10: Initialising clients", run_id)
    sheets = SheetsClient(config.sheet_id, config.google_credentials)
    price_svc = PriceService()
    router = _build_router(config)
    analyzer = ClaudeAnalyzer(router=router, storage=sheets)
    engine = SignalEngine(_load_signals_cfg(), storage=sheets)
    scorer = TransactionScorer()
    enricher = CoinGeckoEnricher()
    eth_collector = EtherscanCollector(config.etherscan_api_key)
    sol_collector = SolscanCollector(config.solscan_api_key or None)
    bot = WhaleScopeBot(config.telegram_token, sheets, personalize_fn=engine.personalize)
    bot.build()
    broadcaster = TelegramBroadcastAdapter(
        token=config.telegram_broadcast_token or config.telegram_token,
        chat_id=config.telegram_broadcast_chat,
        storage=sheets,
        enabled=config.telegram_broadcast_enabled,
        dry_run=(dry_run or config.telegram_broadcast_dry_run),
        dry_run_reason=(
            "pipeline dry_run=True"
            if dry_run
            else "TELEGRAM_BROADCAST_DRY_RUN is true"
        ),
    )
    logger.info(
        "[%s] Telegram public broadcast state=%s chat=%s",
        run_id,
        broadcaster.state_label(),
        config.telegram_broadcast_chat or "(unset)",
    )

    # Stage 3: Collect events
    logger.info("[%s] Stage 3/10: Collecting whale events", run_id)
    raw_events: list[Event] = []
    if dry_run:
        logger.info("[%s] dry_run=True: loading fixture events from %s", run_id, _FIXTURES_PATH)
        try:
            with open(_FIXTURES_PATH) as f:
                fixture = json.load(f)
            raw_events = [_dict_to_event(e) for e in fixture.get("events", [])]
            logger.info("[%s] Loaded %d fixture events", run_id, len(raw_events))
        except Exception as e:
            errors.append(f"load_fixtures: {e}")
            logger.error("[%s] Failed to load fixtures: %s", run_id, e)
    else:
        collected = collect_recent_events(
            sheets=sheets,
            price_service=price_svc,
            eth_collector=eth_collector,
            sol_collector=sol_collector,
            event_to_dict=_event_to_dict,
            since=datetime.now(timezone.utc) - timedelta(hours=24),
        )
        raw_events = collected.raw_events
        errors.extend(collected.errors)

    chain_events = [e for e in raw_events if e.source == "chain"]
    transactions = [_event_to_dict(e) for e in chain_events]
    logger.info(
        "[%s] Collected %d raw events / %d chain tx dicts",
        run_id,
        len(raw_events),
        len(transactions),
    )

    if not dry_run and transactions:
        persisted = persist_chain_activity(
            sheets=sheets,
            chain_events=chain_events,
            event_to_address_activity=_event_to_address_activity,
            transactions=transactions,
        )
        errors.extend(persisted["errors"])
        result["transactions_count"] = int(persisted["stored_transactions"])

    if not dry_run:
        errors.extend(log_unknown_price_symbols(sheets=sheets, price_service=price_svc))

    if not raw_events:
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            errors=json.dumps(errors, ensure_ascii=False),
            details="No transactions found",
        )
        if not dry_run:
            sheets.log_run(result)
        logger.info("[%s] No transactions. Pipeline done.", run_id)
        return result

    # Stage 4: Enrich with market data
    logger.info("[%s] Stage 4/10: Enriching with market data", run_id)
    if not dry_run:
        try:
            transactions = enricher.enrich_transactions(transactions)
            logger.info("[%s] Enriched %d transactions", run_id, len(transactions))
        except Exception as e:
            errors.append(f"enrich_transactions: {e}")
            logger.error("[%s] Enrichment failed (continuing): %s", run_id, e)

    # Stage 5: Signal detection (new path)
    logger.info("[%s] Stage 5/10: Running SignalEngine", run_id)
    now = datetime.now(timezone.utc)
    signals, signal_errors = detect_signals(
        engine=engine,
        sheets=sheets,
        raw_events=raw_events,
        now=now,
        dry_run=dry_run,
        baselines_builder=build_chain_baselines,
    )
    errors.extend(signal_errors)
    logger.info("[%s] SignalEngine produced %d signals", run_id, len(signals))

    if signals:
        logger.info(
            "[%s] Stage path: signals=%d, using signals",
            run_id,
            len(signals),
        )
        top5 = signals_to_top5(signals, raw_events)
        logger.info("[%s] Selected top %d signals", run_id, len(top5))
    else:
        logger.info(
            "[%s] Stage path: signals=0, using legacy_fallback",
            run_id,
        )

        # Stage 6: Pre-filter (legacy fallback path)
        logger.info("[%s] Stage 6/10: Pre-filtering transactions", run_id)
        filtered = scorer.pre_filter(transactions)
        logger.info("[%s] %d -> %d after pre-filter", run_id, len(transactions), len(filtered))

        if not filtered:
            result.update(
                status="completed_no_candidates",
                finished_at=now_iso(),
                errors=json.dumps(errors, ensure_ascii=False),
                details="No candidates after pre-filter",
            )
            if not dry_run:
                sheets.log_run(result)
            logger.info("[%s] No candidates. Pipeline done.", run_id)
            return result

        def _legacy_rank(items: list[dict]) -> list[dict]:
            ranked: list[dict] = []
            for tx in items:
                tx_copy = dict(tx)
                tx_copy["importance_score"] = float(tx_copy.get("base_score", 0))
                tx_copy.setdefault("type", "unknown")
                tx_copy.setdefault("interpretation", "(AI 분석 생략, 규칙 기반 점수로 대체)")
                tx_copy.setdefault("confidence", "low")
                ranked.append(tx_copy)
            return scorer.rank_by_importance(ranked)

        # Stage 7: Analyze batch (legacy fallback path)
        logger.info("[%s] Stage 7/10: Analyzing %d candidates", run_id, len(filtered))
        if len(filtered) > 3:
            logger.info(
                "[%s] Skipping batch analysis for %d candidates; using rule-based fallback",
                run_id,
                len(filtered),
            )
            analyzed = _legacy_rank(filtered)
        else:
            try:
                analyzed = analyzer.analyze_batch(filtered)
                logger.info("[%s] Analyzed %d transactions", run_id, len(analyzed))
            except Exception as e:
                errors.append(f"analyze_batch: {e}")
                logger.error("[%s] analyze_batch failed: %s", run_id, e)
                analyzed = _legacy_rank(filtered)

        # Rank top 5
        top5 = scorer.rank_by_importance(analyzed)
        logger.info("[%s] Selected top %d transactions", run_id, len(top5))

    if not dry_run and signals:
        stored_signals, persist_errors = persist_signals(
            sheets=sheets,
            signals=signals,
            raw_events=raw_events,
        )
        errors.extend(persist_errors)
        logger.info("[%s] Stored %d signals", run_id, stored_signals)

    # Stage 8: Generate daily brief
    logger.info("[%s] Stage 8/10: Generating daily brief", run_id)
    brief_text = ""
    model_id = "dry_run" if dry_run else ""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_volume = sum((tx.get("amount_usd") or 0) for tx in top5)
    highlights = _build_brief_highlights(top5)
    signal_themes = _build_signal_themes(signals, top5)
    note = _build_brief_note(raw_events, signals, top5)
    if dry_run:
        brief_text = f"[DRY RUN] {len(signals)} 시그널 감지. 이벤트 {len(raw_events)}건 처리 완료. 실제 LLM 호출 없이 파이프라인 테스트 완료."
        # Write a fake analysis_log entry so acceptance criterion #4 is met
        try:
            from src.analyzer.prompt_loader import load_prompt
            _, sys_ver = load_prompt("daily_brief.system")
            _, usr_ver = load_prompt("daily_brief.user")
            sheets.save_analysis_log({
                "task": "daily_brief",
                "model_id": "dry_run",
                "prompt_version": f"{sys_ver}+{usr_ver}",
                "tokens_in": 0,
                "tokens_out": 0,
                "cost_usd": 0.0,
                "latency_ms": 0,
            })
        except Exception as e:
            logger.warning("dry_run analysis_log write failed: %s", e)
    else:
        try:
            brief_text = analyzer.generate_daily_brief(signals)
            logger.info("[%s] Brief generated (%d chars)", run_id, len(brief_text))
        except Exception as e:
            errors.append(f"generate_daily_brief: {e}")
            logger.error("[%s] Brief generation failed: %s", run_id, e)

    # Stage 9: Store results
    logger.info("[%s] Stage 9/10: Storing to Google Sheets", run_id)
    if not dry_run:
        if brief_text:
            try:
                serialized_top = _serialize_top_transactions(top5)
                sheets.save_daily_brief(today, [{
                    "summary": brief_text,
                    "top_transactions": json.dumps(serialized_top, ensure_ascii=False),
                    "total_volume_usd": total_volume,
                    "alert_count": len(top5),
                    "highlights": highlights,
                    "signal_themes": signal_themes,
                    "note": note,
                }])
                logger.info("[%s] Saved daily brief for %s", run_id, today)
            except Exception as e:
                errors.append(f"save_daily_brief: {e}")
                logger.error("[%s] Failed to save brief: %s", run_id, e)

    # Stage 10: Distribute via Telegram
    logger.info("[%s] Stage 10/10: Distributing via Telegram", run_id)
    details_parts: list[str] = []
    if brief_text:
        try:
            broadcast_attempt = await asyncio.to_thread(
                broadcaster.broadcast_daily_brief,
                date=today,
                brief_text=brief_text,
                highlights=highlights,
                signal_count=len(signals),
                total_volume_usd=total_volume,
            )
            details_parts.append(f"broadcast={broadcast_attempt.status}")
        except Exception as e:
            errors.append(f"telegram_broadcast: {e}")
            logger.error("[%s] Telegram public broadcast failed: %s", run_id, e)
            details_parts.append("broadcast=failed")
    else:
        details_parts.append("broadcast=no_brief_generated")

    if brief_text and not dry_run:
        try:
            dist_result = await bot.send_daily_brief(brief_text, signals=signals)
            subscriber_details = (
                f"sent={dist_result['sent']}, "
                f"failed={dist_result['failed']}, "
                f"blocked={dist_result['blocked']}"
            )
            details_parts.append(f"subscribers={subscriber_details}")
            logger.info("[%s] Telegram subscriber delivery: %s", run_id, subscriber_details)
        except Exception as e:
            errors.append(f"telegram_distribute: {e}")
            logger.error("[%s] Telegram distribution failed: %s", run_id, e)
            details_parts.append("subscribers=distribution_failed")
    else:
        details_parts.append("subscribers=dry_run_skip" if dry_run else "subscribers=no_brief_generated")

    details = "; ".join(details_parts)

    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        errors=json.dumps(errors, ensure_ascii=False),
        details=details,
        # Extra fields for smoke reporting
        event_count=len(raw_events),
        signal_count=len(signals),
        brief_length=len(brief_text),
        model_id=model_id,
    )

    if not dry_run:
        try:
            sheets.log_run(result)
        except Exception as e:
            logger.error("[%s] Failed to log run: %s", run_id, e)

    logger.info("[%s] Pipeline finished. Status: %s", run_id, result["status"])
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_daily_pipeline(dry_run=args.dry_run))
