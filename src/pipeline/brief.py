from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from src.analyzer.prompt_loader import load_prompt
from src.main import _build_brief_highlights, _build_signal_themes, _serialize_top_transactions
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
from src.utils.logger import get_logger

logger = get_logger("pipeline.brief")


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


def run_brief_pipeline() -> dict[str, object]:
    result = init_run_result("brief")
    errors: list[str] = []

    env = load_pipeline_env(require_llm=True)
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
        return result

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    signal_rows = sheets.list_signals(since=since, limit=50)
    signals = [signal for row in signal_rows if (signal := signal_row_to_signal(row))]
    if not signals:
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            errors="[]",
            details="No recent signals available for brief generation",
        )
        sheets.log_run(result)
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
    note = (
        f"최근 저장된 거래 {len(transaction_rows)}건과 시그널 {len(signals)}건을 바탕으로 "
        "일일 브리핑을 생성했습니다."
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
    logger.info("brief pipeline finished details=%s", details)
    return result


def main() -> None:
    run_brief_pipeline()


if __name__ == "__main__":
    main()
