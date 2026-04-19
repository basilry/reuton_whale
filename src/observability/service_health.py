from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from src.storage.queries import now_iso

_SUCCESS_RUN_STATUSES = {
    "completed",
    "completed_cached",
    "completed_empty",
    "skipped_window",
    "skipped_budget",
    "skipped_inactive",
    "skipped_empty",
    "skipped_duplicate_content",
}
_DEGRADED_RUN_STATUSES = {
    "completed_with_errors",
}
_FAILURE_RUN_STATUSES = {
    "error",
    "failed",
    "failure",
}
_NEUTRAL_RUN_STATUSES = {
    "skipped_duplicate",
}


def build_heartbeat_key(*parts: object) -> str:
    return ":".join(str(part).strip() for part in parts if str(part).strip())


def _truncate(value: object, limit: int = 1000) -> str:
    return str(value or "")[:limit]


def _normalize_details(details: object) -> str:
    if details is None:
        return ""
    if isinstance(details, str):
        return _truncate(details, limit=4000)
    return _truncate(json.dumps(details, ensure_ascii=False, sort_keys=True, default=str), limit=4000)


def _normalize_timestamp(value: datetime | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value).strip()


def _normalize_optional_int(value: object) -> int | str:
    if value in (None, ""):
        return ""
    try:
        return int(value)
    except (TypeError, ValueError):
        return ""


def _default_job_name(service: object, component: object, job_name: object) -> str:
    explicit = str(job_name or "").strip()
    if explicit:
        return explicit
    service_name = str(service or "").strip()
    if "." in service_name:
        suffix = service_name.rsplit(".", 1)[-1].strip()
        if suffix:
            return suffix
    return str(component or "").strip()


def resolve_instance_id(explicit: object = None) -> str:
    if explicit not in (None, ""):
        return str(explicit).strip()
    for env_name in ("RENDER_INSTANCE_ID", "RENDER_SERVICE_INSTANCE_ID", "HOSTNAME"):
        value = os.getenv(env_name, "").strip()
        if value:
            return value
    return ""


def coalesce_source_names(*parts: object) -> str:
    seen: set[str] = set()
    ordered: list[str] = []
    for part in parts:
        raw = str(part or "").strip()
        if not raw:
            continue
        for token in raw.split(","):
            normalized = token.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
    return ",".join(ordered)


def derive_status_timestamps(
    *,
    observed_at: datetime | str | None = None,
    run_status: object = None,
    health_status: object = None,
) -> tuple[str, str]:
    ts = _normalize_timestamp(observed_at) or now_iso()
    normalized_run_status = str(run_status or "").strip().lower()
    if normalized_run_status in _SUCCESS_RUN_STATUSES:
        return ts, ""
    if normalized_run_status in _DEGRADED_RUN_STATUSES:
        return ts, ts
    if normalized_run_status in _FAILURE_RUN_STATUSES:
        return "", ts
    if normalized_run_status in _NEUTRAL_RUN_STATUSES:
        return "", ""

    normalized_health = str(health_status or "").strip().lower()
    if normalized_health in {"ok", "healthy"}:
        return ts, ""
    if normalized_health == "degraded":
        return ts, ts
    if normalized_health in {"error", "down"}:
        return "", ts
    return "", ""


def append_service_heartbeat(
    sheets,
    *,
    service: str,
    component: str,
    status: str,
    run_status: object = None,
    heartbeat_key: str = "",
    details: object = None,
    error: object = None,
    observed_at: datetime | str | None = None,
    instance_id: str | None = None,
    job_name: str | None = None,
    last_success_at: datetime | str | None = None,
    last_failure_at: datetime | str | None = None,
    processed_count: int | str | None = None,
    lag_seconds: int | str | None = None,
    duration_ms: int | str | None = None,
    source_name: str | None = None,
) -> dict[str, object]:
    ts = _normalize_timestamp(observed_at) or now_iso()
    derived_last_success_at, derived_last_failure_at = derive_status_timestamps(
        observed_at=ts,
        run_status=run_status,
        health_status=status,
    )

    entry = {
        "ts": ts,
        "service": str(service),
        "component": str(component),
        "status": str(status),
        "heartbeat_key": str(heartbeat_key),
        "details": _normalize_details(details),
        "error": _truncate(error),
        "instance_id": resolve_instance_id(instance_id),
        "job_name": _default_job_name(service, component, job_name),
        "last_success_at": _normalize_timestamp(last_success_at) or derived_last_success_at,
        "last_failure_at": _normalize_timestamp(last_failure_at) or derived_last_failure_at,
        "processed_count": _normalize_optional_int(processed_count),
        "lag_seconds": _normalize_optional_int(lag_seconds),
        "duration_ms": _normalize_optional_int(duration_ms),
        "source_name": coalesce_source_names(source_name),
    }
    sheets.append_service_health(entry)
    return entry


def pipeline_status_to_health(run_status: object) -> str:
    normalized = str(run_status or "").strip().lower()
    if normalized in {
        "completed",
        "completed_cached",
        "completed_empty",
        "skipped_window",
        "skipped_budget",
        "skipped_inactive",
        "skipped_empty",
    }:
        return "ok"
    if normalized in {"completed_with_errors", "skipped_duplicate"}:
        return "degraded"
    return "error"
