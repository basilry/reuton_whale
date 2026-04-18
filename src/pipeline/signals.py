from __future__ import annotations

import json

from src.main import _event_to_address_activity, _event_to_dict, _load_signals_cfg
from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
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


def _record_signals_heartbeat(sheets, result: dict[str, object]) -> None:
    append_service_heartbeat(
        sheets,
        service="pipeline.signals",
        component="pipeline",
        status=pipeline_status_to_health(result.get("status")),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": result.get("status"),
            "details": result.get("details", ""),
        },
        error=result.get("errors", ""),
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

    persisted = persist_chain_activity(
        sheets=sheets,
        chain_events=collected.chain_events,
        event_to_address_activity=_event_to_address_activity,
        transactions=collected.transactions,
    )
    errors.extend(persisted["errors"])
    errors.extend(log_unknown_price_symbols(sheets=sheets, price_service=price_service))

    if not collected.raw_events:
        result.update(
            status="completed_empty",
            finished_at=now_iso(),
            transactions_count=persisted["stored_transactions"],
            errors=json.dumps(errors, ensure_ascii=False),
            details="No recent events found",
        )
        sheets.log_run(result)
        _record_signals_heartbeat(sheets, result)
        return result

    signals, signal_errors = detect_signals(
        engine=engine,
        sheets=sheets,
        raw_events=collected.raw_events,
    )
    errors.extend(signal_errors)
    stored_signals, persist_signal_errors = persist_signals(
        sheets=sheets,
        signals=signals,
        raw_events=collected.raw_events,
    )
    errors.extend(persist_signal_errors)

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
    _record_signals_heartbeat(sheets, result)
    logger.info("signals pipeline finished status=%s details=%s", result["status"], details)
    return result


def main() -> None:
    run_signals_pipeline()


if __name__ == "__main__":
    main()
