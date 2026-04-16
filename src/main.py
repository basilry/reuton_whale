from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import yaml

from src.analyzer.claude_analyzer import LLMAnalyzer
from src.analyzer.scoring import TransactionScorer
from src.collectors.coingecko import CoinGeckoEnricher
from src.config import load_config
from src.distributor.telegram_bot import WhaleScopeBot
from src.ingestion.etherscan import EtherscanCollector
from src.ingestion.solscan import SolscanCollector
from src.llm.anthropic_provider import AnthropicProvider
from src.llm.router import LLMRouter
from src.signals.baseline import build_chain_baselines
from src.signals.engine import SignalEngine
from src.signals.models import Event, Signal
from src.storage.queries import now_iso
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

from src.analyzer.price_service import PriceService

# Alias so existing tests can patch src.main.ClaudeAnalyzer
ClaudeAnalyzer = LLMAnalyzer

logger = get_logger("pipeline")

_EVM_CHAINS = ("ETH", "ARB", "BASE", "BSC", "POLYGON")

_CONFIG_DIR = Path(__file__).parent.parent / "config"
_FIXTURES_PATH = Path(__file__).parent.parent / "tests" / "fixtures" / "sample_events.json"
_TG_CHAIN_MAP = {
    "bitcoin": "BTC",
    "btc": "BTC",
    "ethereum": "ETH",
    "eth": "ETH",
    "bsc": "BSC",
    "bnb": "BSC",
    "binance smart chain": "BSC",
    "polygon": "POLYGON",
    "matic": "POLYGON",
    "solana": "SOL",
    "sol": "SOL",
    "tron": "TRX",
    "trx": "TRX",
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


def _parse_dt(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _safe_float(value: object) -> float:
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        logger.warning("Failed to parse float value=%r; defaulting to 0.0", value)
        return 0.0


def _normalize_tg_chain(value: object) -> str:
    raw = str(value or "unknown").strip().lower()
    if not raw:
        return "unknown"
    if raw == "unknown":
        return "unknown"
    return _TG_CHAIN_MAP.get(raw, raw.upper())


def _tg_owner_label(value: object, fallback: str = "unknown") -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    return text.lstrip("#")


def _tg_direction(from_owner_type: str, to_owner_type: str) -> tuple[str, str | None]:
    from_type = from_owner_type.lower()
    to_type = to_owner_type.lower()
    if from_type == "exchange" and to_type == "exchange":
        # Exchange-to-exchange moves are treated as exchange outflow signals.
        return "out", "cex"
    if to_type == "exchange" and from_type != "exchange":
        return "in", "cex"
    if from_type == "exchange":
        return "out", None
    return "out", None


def _tg_row_to_event(row: dict) -> Event:
    block_time = _parse_dt(row.get("tg_date")) or _parse_dt(row.get("collected_at")) or datetime.now(timezone.utc)
    collected_at = _parse_dt(row.get("collected_at")) or block_time
    from_owner = _tg_owner_label(row.get("from_owner"))
    to_owner = _tg_owner_label(row.get("to_owner"))
    from_owner_type = str(row.get("from_owner_type") or "unknown").strip().lower() or "unknown"
    to_owner_type = str(row.get("to_owner_type") or "unknown").strip().lower() or "unknown"
    direction, counterparty_category = _tg_direction(from_owner_type, to_owner_type)

    return Event(
        source="tg",
        chain=_normalize_tg_chain(row.get("blockchain")),
        tx_hash=None,
        watched_address=None,
        from_addr=from_owner or from_owner_type or "unknown",
        to_addr=to_owner or to_owner_type or "unknown",
        direction=direction,
        token=str(row.get("symbol") or "UNKNOWN").upper(),
        amount_token=_safe_float(row.get("amount")),
        amount_usd=_safe_float(row.get("amount_usd")),
        counterparty_category=counterparty_category,
        block_time=block_time,
        collected_at=collected_at,
    )


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


def _event_within_signal_window(event: Event, signal: Signal) -> bool:
    return (
        signal.window_start <= event.block_time <= signal.window_end
        or signal.window_start <= event.collected_at <= signal.window_end
    )


def _signal_to_top_item(signal: Signal, events: list[Event]) -> dict:
    events_by_hash = {e.tx_hash: e for e in events if e.tx_hash}
    evidence_events = [
        events_by_hash[h]
        for h in signal.evidence_tx_hashes
        if h in events_by_hash
    ]
    fallback_events = [
        e for e in events
        if _event_within_signal_window(e, signal)
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
    amount_usd: float | None = sum(e.amount_usd for e in deduped_events) or None
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


def _signals_to_top5(signals: list[Signal], events: list[Event]) -> list[dict]:
    top_signals = sorted(signals, key=lambda sig: sig.score, reverse=True)[:5]
    return [_signal_to_top_item(sig, events) for sig in top_signals]


def _signal_to_sheet_dict(signal: Signal) -> dict:
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


def _dict_to_event(d: dict) -> Event:
    """Deserialize Event from fixture JSON dict."""
    from datetime import timezone as tz
    def _parse_dt(s: str) -> datetime:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
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
        block_time=_parse_dt(d.get("block_time", "2024-01-01T00:00:00Z")),
        collected_at=_parse_dt(d.get("collected_at", "2024-01-01T00:00:00Z")),
    )


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
        try:
            watched_index = sheets.list_watched_addresses()
            since_dt = datetime.now(timezone.utc) - timedelta(hours=24)
            since_ts = int(since_dt.timestamp())
            for chain in _EVM_CHAINS:
                addrs = [
                    addr for addr, row in watched_index.items()
                    if row.get("chain", "").upper() in (chain, "EVM", "")
                ]
                if addrs:
                    raw_events.extend(
                        eth_collector.fetch(
                            addrs, chain, since_ts,
                            watched_index=watched_index, price_service=price_svc,
                        )
                    )
            sol_addrs = [
                addr for addr, row in watched_index.items()
                if row.get("chain", "").upper() == "SOL"
            ]
            if sol_addrs:
                raw_events.extend(
                    sol_collector.fetch(
                        sol_addrs, since_ts,
                        watched_index=watched_index, price_service=price_svc,
                    )
                )
            try:
                tg_rows = sheets.list_tg_whale_events(since=since_dt)
                if isinstance(tg_rows, list) and tg_rows:
                    tg_events = [_tg_row_to_event(row) for row in tg_rows if isinstance(row, dict)]
                    raw_events.extend(tg_events)
                    logger.info("[%s] Loaded %d tg events from Sheets", run_id, len(tg_events))
            except Exception as e:
                errors.append(f"list_tg_whale_events: {e}")
                logger.error("[%s] Failed to load TG events: %s", run_id, e)
        except Exception as e:
            errors.append(f"fetch_transactions: {e}")
            logger.error("[%s] Failed to fetch transactions: %s", run_id, e)

    chain_events = [e for e in raw_events if e.source == "chain"]
    transactions = [_event_to_dict(e) for e in chain_events]
    logger.info(
        "[%s] Collected %d raw events / %d chain tx dicts",
        run_id,
        len(raw_events),
        len(transactions),
    )

    if not dry_run and transactions:
        try:
            address_activity_rows = [_event_to_address_activity(e) for e in chain_events]
            if address_activity_rows:
                stored_activity = sheets.append_address_activity(address_activity_rows)
                logger.info("[%s] Stored %d address activity rows", run_id, stored_activity)
        except Exception as e:
            errors.append(f"append_address_activity: {e}")
            logger.error("[%s] Failed to store address activity: %s", run_id, e)

        try:
            stored_count = sheets.append_transactions(transactions)
            result["transactions_count"] = stored_count
            logger.info("[%s] Stored %d transactions", run_id, stored_count)
        except Exception as e:
            errors.append(f"append_transactions: {e}")
            logger.error("[%s] Failed to store transactions: %s", run_id, e)

    unknown_price_symbols = price_svc.drain_unknown_report()
    if not dry_run and isinstance(unknown_price_symbols, list) and unknown_price_symbols:
        try:
            sheets.append_system_log(
                "warning",
                "price_unknown_symbols",
                {
                    "symbols": [
                        {"symbol": symbol, "count": count}
                        for symbol, count in unknown_price_symbols
                    ],
                },
            )
        except Exception as e:
            errors.append(f"price_unknown_symbols: {e}")
            logger.warning("[%s] Failed to log unknown price symbols: %s", run_id, e)

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
    signals = []
    try:
        now = datetime.now(timezone.utc)
        baselines = {}
        if not dry_run:
            baselines = build_chain_baselines(sheets, now)
            logger.info("[%s] Loaded %d baseline bucket(s)", run_id, len(baselines))
        signals = engine.run(raw_events, now, baselines=baselines)
        logger.info("[%s] SignalEngine produced %d signals", run_id, len(signals))
    except Exception as e:
        errors.append(f"signal_engine: {e}")
        logger.error("[%s] SignalEngine failed (continuing with legacy path): %s", run_id, e)

    if signals:
        logger.info(
            "[%s] Stage path: signals=%d, using signals",
            run_id,
            len(signals),
        )
        top5 = _signals_to_top5(signals, raw_events)
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
        try:
            stored_signals = 0
            for signal in signals:
                sheets.append_signal(_signal_to_sheet_dict(signal))
                stored_signals += 1
            logger.info("[%s] Stored %d signals", run_id, stored_signals)
        except Exception as e:
            errors.append(f"append_signal: {e}")
            logger.error("[%s] Failed to store signals: %s", run_id, e)

    # Stage 8: Generate daily brief
    logger.info("[%s] Stage 8/10: Generating daily brief", run_id)
    brief_text = ""
    model_id = "dry_run" if dry_run else ""
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
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if brief_text:
            try:
                total_volume = sum((tx.get("amount_usd") or 0) for tx in top5)
                sheets.save_daily_brief(today, [{
                    "summary": brief_text,
                    "top_transactions": json.dumps(
                        [
                            {
                                "hash": tx.get("hash", ""),
                                "symbol": tx.get("symbol", ""),
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
                            for tx in top5
                        ],
                        ensure_ascii=False,
                    ),
                    "total_volume_usd": total_volume,
                    "alert_count": len(top5),
                }])
                logger.info("[%s] Saved daily brief for %s", run_id, today)
            except Exception as e:
                errors.append(f"save_daily_brief: {e}")
                logger.error("[%s] Failed to save brief: %s", run_id, e)

    # Stage 10: Distribute via Telegram
    logger.info("[%s] Stage 10/10: Distributing via Telegram", run_id)
    details = ""
    if brief_text and not dry_run:
        try:
            dist_result = await bot.send_daily_brief(brief_text, signals=signals)
            details = (
                f"sent={dist_result['sent']}, "
                f"failed={dist_result['failed']}, "
                f"blocked={dist_result['blocked']}"
            )
            logger.info("[%s] Telegram: %s", run_id, details)
        except Exception as e:
            errors.append(f"telegram_distribute: {e}")
            logger.error("[%s] Telegram distribution failed: %s", run_id, e)
            details = "distribution_failed"
    else:
        details = "dry_run_skip" if dry_run else "no_brief_generated"

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
