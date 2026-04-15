from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_router(config) -> LLMRouter:
    providers = {}
    if config.anthropic_api_key:
        providers["anthropic"] = AnthropicProvider(config.anthropic_api_key)
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            from src.llm.gemini_provider import GeminiProvider
            providers["gemini"] = GeminiProvider(gemini_key)
        except Exception as e:
            logger.warning("GeminiProvider init failed: %s", e)
    groq_key = os.getenv("GROQ_API_KEY", "")
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


def _signals_to_top5(signals: list[Signal], events: list[Event]) -> list[dict]:
    events_by_hash = {e.tx_hash: e for e in events if e.tx_hash}
    top_signals = sorted(signals, key=lambda sig: sig.score, reverse=True)[:5]
    rows: list[dict] = []

    for sig in top_signals:
        evidence_events = [
            events_by_hash[h]
            for h in sig.evidence_tx_hashes
            if h in events_by_hash
        ]
        first_event = evidence_events[0] if evidence_events else None
        amount_usd = sum(e.amount_usd for e in evidence_events)
        rows.append({
            "hash": sig.evidence_tx_hashes[0] if sig.evidence_tx_hashes else "",
            "symbol": first_event.token if first_event else sig.extra.get("token", ""),
            "amount_usd": amount_usd,
            "importance_score": sig.score,
            "interpretation": sig.summary,
            "type": sig.rule,
            "severity": sig.severity,
            "confidence": sig.confidence,
            "source": sig.source,
        })

    return rows


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
            since_ts = int(datetime.now(timezone.utc).timestamp()) - 24 * 3600
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
        except Exception as e:
            errors.append(f"fetch_transactions: {e}")
            logger.error("[%s] Failed to fetch transactions: %s", run_id, e)

    transactions = [_event_to_dict(e) for e in raw_events]
    logger.info("[%s] Collected %d events / %d tx dicts", run_id, len(raw_events), len(transactions))

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

    if not transactions:
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

        # Stage 7: Analyze batch (legacy fallback path)
        logger.info("[%s] Stage 7/10: Analyzing %d candidates", run_id, len(filtered))
        try:
            analyzed = analyzer.analyze_batch(filtered)
            logger.info("[%s] Analyzed %d transactions", run_id, len(analyzed))
        except Exception as e:
            errors.append(f"analyze_batch: {e}")
            logger.error("[%s] analyze_batch failed: %s", run_id, e)
            analyzed = []
            for tx in filtered:
                tx_copy = dict(tx)
                tx_copy["importance_score"] = int(tx.get("base_score", 0))
                tx_copy["type"] = "unknown"
                tx_copy["interpretation"] = "(AI 분석 실패, 규칙 기반 점수로 대체)"
                tx_copy["confidence"] = "low"
                analyzed.append(tx_copy)

        # Rank top 5
        top5 = scorer.rank_by_importance(analyzed)
        logger.info("[%s] Selected top %d transactions", run_id, len(top5))

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
        try:
            stored_count = sheets.append_transactions(transactions)
            result["transactions_count"] = stored_count
            logger.info("[%s] Stored %d transactions", run_id, stored_count)
        except Exception as e:
            errors.append(f"append_transactions: {e}")
            logger.error("[%s] Failed to store transactions: %s", run_id, e)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if brief_text:
            try:
                total_volume = sum(tx.get("amount_usd", 0) for tx in top5)
                sheets.save_daily_brief(today, [{
                    "summary": brief_text,
                    "top_transactions": json.dumps(
                        [
                            {
                                "hash": tx.get("hash", ""),
                                "symbol": tx.get("symbol", ""),
                                "amount_usd": tx.get("amount_usd", 0),
                                "importance_score": tx.get("importance_score", 0),
                                "interpretation": tx.get("interpretation", ""),
                                "type": tx.get("type", ""),
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
