import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from src.analyzer.claude_analyzer import ClaudeAnalyzer
from src.analyzer.scoring import TransactionScorer
from src.collectors.coingecko import CoinGeckoEnricher
from src.collectors.whale_alert import WhaleAlertCollector
from src.config import load_config
from src.distributor.telegram_bot import WhaleScopeBot
from src.storage.queries import now_iso
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

logger = get_logger("pipeline")


async def run_daily_pipeline() -> dict:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_id = f"run_{timestamp}_{uuid4().hex[:6]}"
    started_at = now_iso()
    errors: list[str] = []
    result = {
        "run_id": run_id,
        "run_type": "daily_brief",
        "status": "started",
        "started_at": started_at,
        "finished_at": "",
        "transactions_count": 0,
        "errors": "",
        "details": "",
    }

    # Step 1: Load config
    logger.info("[%s] Step 1/10: Loading config", run_id)
    config = load_config()

    # Step 2: Initialize clients
    logger.info("[%s] Step 2/10: Initializing clients", run_id)
    sheets = SheetsClient(config.sheet_id, config.google_credentials)
    collector = WhaleAlertCollector(config.whale_alert_api_key)
    enricher = CoinGeckoEnricher()
    analyzer = ClaudeAnalyzer(config.anthropic_api_key, sheets=sheets)
    scorer = TransactionScorer()
    bot = WhaleScopeBot(config.telegram_token, sheets)
    bot.build()

    # Step 3: Fetch whale transactions
    logger.info("[%s] Step 3/10: Fetching whale transactions", run_id)
    try:
        transactions = collector.fetch_transactions(hours=24)
        logger.info("[%s] Fetched %d transactions", run_id, len(transactions))
    except Exception as e:
        errors.append(f"fetch_transactions: {e}")
        logger.error("[%s] Failed to fetch transactions: %s", run_id, e)
        transactions = []

    if not transactions:
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            errors=json.dumps(errors, ensure_ascii=False),
            details="No transactions found",
        )
        sheets.log_run(result)
        logger.info("[%s] No transactions. Pipeline done.", run_id)
        return result

    # Step 4: Enrich with market data
    logger.info("[%s] Step 4/10: Enriching with CoinGecko market data", run_id)
    try:
        transactions = enricher.enrich_transactions(transactions)
        logger.info("[%s] Enriched %d transactions", run_id, len(transactions))
    except Exception as e:
        errors.append(f"enrich_transactions: {e}")
        logger.error("[%s] Enrichment failed (continuing): %s", run_id, e)

    # Step 5: Pre-filter and score
    logger.info("[%s] Step 5/10: Pre-filtering transactions", run_id)
    filtered = scorer.pre_filter(transactions)
    logger.info("[%s] %d -> %d after pre-filter", run_id, len(transactions), len(filtered))

    if not filtered:
        result.update(
            status="completed_no_candidates",
            finished_at=now_iso(),
            errors=json.dumps(errors, ensure_ascii=False),
            details="No candidates after pre-filter",
        )
        sheets.log_run(result)
        logger.info("[%s] No candidates. Pipeline done.", run_id)
        return result

    # Step 6: Claude AI analysis
    logger.info("[%s] Step 6/10: Analyzing %d candidates with Claude", run_id, len(filtered))
    try:
        analyzed = analyzer.analyze_batch(filtered)
        logger.info("[%s] Analyzed %d transactions", run_id, len(analyzed))
    except Exception as e:
        errors.append(f"analyze_batch: {e}")
        logger.error("[%s] Analysis failed: %s", run_id, e)
        analyzed = []
        for tx in filtered:
            tx_copy = dict(tx)
            tx_copy["importance_score"] = int(tx.get("base_score", 0))
            tx_copy["type"] = "unknown"
            tx_copy["interpretation"] = "(AI 분석 실패, 규칙 기반 점수로 대체)"
            tx_copy["confidence"] = "low"
            analyzed.append(tx_copy)

    # Step 7: Rank and select top 5
    logger.info("[%s] Step 7/10: Ranking top transactions", run_id)
    top5 = scorer.rank_by_importance(analyzed)
    logger.info("[%s] Selected top %d transactions", run_id, len(top5))

    # Step 8: Generate daily brief
    logger.info("[%s] Step 8/10: Generating daily brief", run_id)
    brief_text = ""
    try:
        brief_text = analyzer.generate_daily_brief(top5)
        logger.info("[%s] Brief generated (%d chars)", run_id, len(brief_text))
    except Exception as e:
        errors.append(f"generate_daily_brief: {e}")
        logger.error("[%s] Brief generation failed: %s", run_id, e)

    # Step 9: Store to Google Sheets
    logger.info("[%s] Step 9/10: Storing to Google Sheets", run_id)
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

    # Step 10: Distribute via Telegram
    logger.info("[%s] Step 10/10: Distributing via Telegram", run_id)
    details = ""
    if brief_text:
        try:
            dist_result = await bot.send_daily_brief(brief_text)
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
        details = "no_brief_generated"

    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        errors=json.dumps(errors, ensure_ascii=False),
        details=details,
    )

    try:
        sheets.log_run(result)
    except Exception as e:
        logger.error("[%s] Failed to log run: %s", run_id, e)

    logger.info("[%s] Pipeline finished. Status: %s", run_id, result["status"])
    return result


if __name__ == "__main__":
    asyncio.run(run_daily_pipeline())
