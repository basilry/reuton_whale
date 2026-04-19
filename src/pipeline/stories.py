from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
from src.notify.pipeline_events import publish_success_event
from src.pipeline.common import (
    build_router_from_env,
    build_sheets_client,
    coerce_json_list,
    init_run_result,
    load_pipeline_env,
    safe_float,
    signal_row_to_top_item,
)
from src.router.budget import MonthlyBudgetGuard
from src.storage.queries import now_iso
from src.utils.logger import get_logger

logger = get_logger("pipeline.stories")

_STORY_SYSTEM_PROMPT = """You are a crypto market editor.

Turn the signal context into valid JSON only:
{
  "title": "<short Korean title, max 32 chars>",
  "body_ko": "<one or two Korean sentences explaining what happened and why it matters>",
  "impact_score": <integer 1-100>
}

Rules:
- No markdown fences.
- Do not give investment advice.
- Keep concrete numbers from the input unchanged.
"""


def _record_stories_heartbeat(sheets, result: dict[str, object]) -> None:
    append_service_heartbeat(
        sheets,
        service="pipeline.stories",
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
        source_name="signals+llm",
    )


def _parse_story_json(raw: str) -> dict:
    stripped = raw.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", stripped, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group())


def _story_prompt(signal_row: dict, transaction_row: dict | None) -> str:
    top_item = signal_row_to_top_item(signal_row)
    parts = [
        f"signal_id={signal_row.get('signal_id', '')}",
        f"rule={signal_row.get('rule', '')}",
        f"severity={signal_row.get('severity', '')}",
        f"score={signal_row.get('score', '')}",
        f"source={signal_row.get('source', '')}",
        f"summary={signal_row.get('summary', '')}",
        f"symbol={top_item.get('symbol', '')}",
        f"amount_usd={top_item.get('amount_usd', '')}",
    ]
    if transaction_row:
        parts.extend(
            [
                f"tx_hash={transaction_row.get('hash', '')}",
                f"from_owner={transaction_row.get('from_owner', '')}",
                f"to_owner={transaction_row.get('to_owner', '')}",
                f"blockchain={transaction_row.get('blockchain', '')}",
            ]
        )
    return "\n".join(parts)


def _fallback_story(signal_row: dict) -> dict:
    title = str(signal_row.get("rule", "고래 움직임")).replace("_", " ").strip() or "고래 움직임"
    score = round(safe_float(signal_row.get("score")))
    summary = str(signal_row.get("summary", "")).strip() or "최근 고래 시그널이 감지되었습니다."
    return {
        "title": title[:32],
        "body_ko": summary,
        "impact_score": max(1, min(score or 50, 100)),
    }


def run_stories_pipeline(limit: int = 5) -> dict[str, object]:
    result = init_run_result("stories")
    errors: list[str] = []

    env = load_pipeline_env(require_llm=True)
    sheets = build_sheets_client(env)
    guard = MonthlyBudgetGuard(sheets)
    router = build_router_from_env(env)

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    signal_rows = sheets.list_signals(since=since, limit=max(limit, 1) * 2)
    if not signal_rows:
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            errors="[]",
            details="No recent signals available for story generation",
        )
        sheets.log_run(result)
        _record_stories_heartbeat(sheets, result)
        return result

    transaction_rows = sheets.list_transactions(since=since, limit=200)
    transactions_by_hash = {
        str(row.get("hash", "")).strip().lower(): row
        for row in transaction_rows
        if str(row.get("hash", "")).strip()
    }

    generated = 0
    for signal_row in sorted(
        signal_rows,
        key=lambda row: safe_float(row.get("score")),
        reverse=True,
    ):
        if generated >= limit:
            break

        decision = guard.precheck("stories")
        if not decision.allowed:
            guard.log_blocked(pipeline="stories")
            errors.append("budget_cap_reached")
            break

        evidence_hashes = coerce_json_list(signal_row.get("evidence_tx_hashes"))
        transaction_row = None
        for tx_hash in evidence_hashes:
            transaction_row = transactions_by_hash.get(tx_hash.lower())
            if transaction_row is not None:
                break

        try:
            llm_result = router.call_task(
                "per_signal_narration",
                _STORY_SYSTEM_PROMPT,
                _story_prompt(signal_row, transaction_row),
            )
            guard.record_usage(
                pipeline="stories",
                model_id=llm_result.model_id,
                tokens_in=llm_result.tokens_in,
                tokens_out=llm_result.tokens_out,
                cost_usd=llm_result.cost_usd,
                decision="generated",
            )
            sheets.save_analysis_log(
                {
                    "task": "per_signal_narration",
                    "model_id": llm_result.model_id,
                    "prompt_version": "stories.v1",
                    "tokens_in": llm_result.tokens_in,
                    "tokens_out": llm_result.tokens_out,
                    "cost_usd": llm_result.cost_usd,
                    "latency_ms": llm_result.latency_ms,
                    "status": "ok",
                }
            )
        except Exception as exc:
            errors.append(f"story_generation:{signal_row.get('signal_id', '')}:{exc}")
            logger.error(
                "Story generation failed signal_id=%s: %s",
                signal_row.get("signal_id", ""),
                exc,
            )
            continue

        try:
            payload = _parse_story_json(llm_result.text)
        except json.JSONDecodeError:
            payload = _fallback_story(signal_row)

        sheets.append_whale_story(
            {
                "id": f"story-{signal_row.get('signal_id', '')}",
                "signal_id": signal_row.get("signal_id", ""),
                "wallet_id": "",
                "title": str(payload.get("title") or _fallback_story(signal_row)["title"])[:120],
                "body_ko": str(payload.get("body_ko") or _fallback_story(signal_row)["body_ko"]),
                "body_en": "",
                "impact_score": round(
                    safe_float(payload.get("impact_score") or signal_row.get("score"))
                ),
                "published_at": now_iso(),
                "source_signal_ts": str(signal_row.get("created_at") or signal_row.get("window_end") or ""),
            }
        )
        generated += 1

    status = "completed"
    if generated == 0 and errors:
        status = "completed_with_errors"
    elif errors:
        status = "completed_with_errors"

    result.update(
        status=status if generated > 0 or not signal_rows else "completed_empty",
        finished_at=now_iso(),
        transactions_count=len(transaction_rows),
        errors=json.dumps(errors, ensure_ascii=False),
        details=f"signals={len(signal_rows)}; generated={generated}",
    )
    sheets.log_run(result)
    _record_stories_heartbeat(sheets, result)
    publish_success_event(section="stories", pipeline="stories", result=result)
    logger.info("stories pipeline finished generated=%d errors=%d", generated, len(errors))
    return result


def main() -> None:
    run_stories_pipeline()


if __name__ == "__main__":
    main()
