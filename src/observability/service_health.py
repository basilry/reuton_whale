from __future__ import annotations

import json
from datetime import datetime

from src.storage.queries import now_iso


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


def append_service_heartbeat(
    sheets,
    *,
    service: str,
    component: str,
    status: str,
    heartbeat_key: str = "",
    details: object = None,
    error: object = None,
    observed_at: datetime | str | None = None,
) -> dict[str, str]:
    ts = observed_at if isinstance(observed_at, str) else now_iso()
    if isinstance(observed_at, datetime):
        ts = observed_at.isoformat()
    entry = {
        "ts": ts,
        "service": str(service),
        "component": str(component),
        "status": str(status),
        "heartbeat_key": str(heartbeat_key),
        "details": _normalize_details(details),
        "error": _truncate(error),
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
