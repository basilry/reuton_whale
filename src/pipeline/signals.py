from __future__ import annotations

import json

from src.main import _event_to_address_activity, _event_to_dict, _load_signals_cfg
from src.observability.service_health import (
    append_service_heartbeat,
    coalesce_source_names,
    pipeline_status_to_health,
)
from src.pipeline.common import (
    build_price_services,
    build_sheets_client,
    collect_recent_events,
    detect_signals,
    init_run_result,
    load_pipeline_env,
    log_unknown_price_symbols,
    persist_chain_activity,
    persist_signals,
)
from src.signals.engine import SignalEngine
from src.storage.queries import now_iso
from src.utils.logger import get_logger

logger = get_logger("pipeline.signals")


def _error_preview(errors: list[str], *, limit: int = 3) -> str:
    if not errors:
        return "none"
    preview = errors[:limit]
    remaining = len(errors) - len(preview)
    suffix = f" ... (+{remaining} more)" if remaining > 0 else ""
    return " | ".join(preview) + suffix


def _record_signals_heartbeat(
    sheets,
    result: dict[str, object],
    *,
    processed_count: int | None = None,
    source_name: str = "",
    coverage: dict[str, object] | None = None,
) -> None:
    coverage = coverage or {}
    append_service_heartbeat(
        sheets,
        service="pipeline.signals",
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
        processed_count=processed_count if processed_count is not None else result.get("transactions_count"),
        source_name=source_name,
        supported_chains=str(coverage.get("supported_chains", "")),
        unsupported_chain_count=coverage.get("unsupported_chain_count"),
        unsupported_chain_names=str(coverage.get("unsupported_chain_names", "")),
        per_chain_event_count=str(coverage.get("per_chain_event_count", "")),
    )


def run_signals_pipeline() -> dict[str, object]:
    result = init_run_result("signals")
    errors: list[str] = []

    env = load_pipeline_env(require_chain_api=True)
    sheets = build_sheets_client(env)
    price_service, eth_collector, sol_collector = build_price_services(env)
    engine = SignalEngine(_load_signals_cfg(), storage=sheets)

    collected = collect_recent_events(
        sheets=sheets,
        price_service=price_service,
        eth_collector=eth_collector,
        sol_collector=sol_collector,
        event_to_dict=_event_to_dict,
    )
    errors.extend(collected.errors)
    logger.info(
        "signals collected raw_events=%d chain_events=%d tg_events=%d transactions=%d collect_errors=%d",
        len(collected.raw_events),
        len(collected.chain_events),
        max(0, len(collected.raw_events) - len(collected.chain_events)),
        len(collected.transactions),
        len(collected.errors),
    )
    heartbeat_source_name = coalesce_source_names(
        *(getattr(event, "source", "") for event in collected.raw_events)
    )

    persisted = persist_chain_activity(
        sheets=sheets,
        chain_events=collected.chain_events,
        event_to_address_activity=_event_to_address_activity,
        transactions=collected.transactions,
    )
    errors.extend(persisted["errors"])
    logger.info(
        "signals persisted address_activity=%d stored_transactions=%d persist_errors=%d",
        int(persisted["stored_activity"]),
        int(persisted["stored_transactions"]),
        len(persisted["errors"]),
    )
    price_log_errors = log_unknown_price_symbols(sheets=sheets, price_service=price_service)
    errors.extend(price_log_errors)
    logger.info(
        "signals price diagnostics unknown_symbol_log_errors=%d cumulative_errors=%d",
        len(price_log_errors),
        len(errors),
    )

    if not collected.raw_events:
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            transactions_count=persisted["stored_transactions"],
            errors=json.dumps(errors, ensure_ascii=False),
            details="No recent events found",
        )
        sheets.log_run(result)
        _record_signals_heartbeat(
            sheets,
            result,
            processed_count=len(collected.raw_events),
            source_name=heartbeat_source_name,
            coverage=collected.coverage,
        )
        logger.info(
            "signals pipeline finished status=%s details=%s error_count=%d error_preview=%s",
            result["status"],
            result["details"],
            len(errors),
            _error_preview(errors),
        )
        return result

    signals, signal_errors = detect_signals(
        engine=engine,
        sheets=sheets,
        raw_events=collected.raw_events,
    )
    errors.extend(signal_errors)
    logger.info(
        "signals detected signals=%d detect_errors=%d raw_events=%d",
        len(signals),
        len(signal_errors),
        len(collected.raw_events),
    )
    stored_signals, persist_signal_errors = persist_signals(
        sheets=sheets,
        signals=signals,
        raw_events=collected.raw_events,
    )
    errors.extend(persist_signal_errors)
    logger.info(
        "signals stored stored_signals=%d persist_signal_errors=%d cumulative_errors=%d",
        stored_signals,
        len(persist_signal_errors),
        len(errors),
    )

    details = (
        f"raw_events={len(collected.raw_events)}; "
        f"chain_events={len(collected.chain_events)}; "
        f"stored_transactions={persisted['stored_transactions']}; "
        f"signals={len(signals)}; "
        f"stored_signals={stored_signals}"
    )
    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        transactions_count=persisted["stored_transactions"],
        errors=json.dumps(errors, ensure_ascii=False),
        details=details,
    )
    sheets.log_run(result)
    _record_signals_heartbeat(
        sheets,
        result,
        processed_count=len(collected.raw_events),
        source_name=heartbeat_source_name,
        coverage=collected.coverage,
    )
    logger.info(
        "signals pipeline finished status=%s details=%s error_count=%d error_preview=%s",
        result["status"],
        details,
        len(errors),
        _error_preview(errors),
    )
    return result


def main() -> None:
    run_signals_pipeline()


if __name__ == "__main__":
    main()
