from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import requests

from src.utils.logger import get_logger

logger = get_logger("notify.pipeline_events")

_UPSERT_CHANNEL = "whalescope:updates"
_LAST_UPDATE_KEY = "whalescope:last_update"
_ENABLE_VALUES = {"1", "true", "yes", "on"}


def _env_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in _ENABLE_VALUES


def _publisher_config() -> tuple[str, str] | None:
    if not _env_enabled("WHALESCOPE_SSE_ENABLED"):
        return None

    base_url = os.getenv("WHALESCOPE_REDIS_REST_URL", "").strip().rstrip("/")
    token = os.getenv("WHALESCOPE_REDIS_REST_TOKEN", "").strip()
    if not base_url or not token:
        return None

    return base_url, token


def publish_pipeline_event(
    *,
    section: str,
    pipeline: str,
    status: str,
    emitted_at: str,
    summary: str,
    slot_key: str | None = None,
    run_id: str | None = None,
) -> bool:
    config = _publisher_config()
    if config is None:
        return False

    base_url, token = config
    payload = {
        "section": str(section),
        "pipeline": str(pipeline),
        "status": str(status),
        "emitted_at": str(emitted_at),
        "summary": str(summary),
    }
    if slot_key:
        payload["slot_key"] = str(slot_key)
    if run_id:
        payload["run_id"] = str(run_id)
    if "slot_key" not in payload and "run_id" not in payload:
        payload["run_id"] = (
            f"{pipeline}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        )

    message = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    commands = [["SET", _LAST_UPDATE_KEY, message], ["PUBLISH", _UPSERT_CHANNEL, message]]

    try:
        response = requests.post(
            f"{base_url}/pipeline",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=commands,
            timeout=5,
        )
        response.raise_for_status()
        logger.info(
            "pipeline event published section=%s pipeline=%s status=%s key=%s",
            payload["section"],
            payload["pipeline"],
            payload["status"],
            payload.get("slot_key") or payload.get("run_id"),
        )
        return True
    except Exception as exc:
        logger.warning(
            "pipeline event publish failed section=%s pipeline=%s status=%s error=%s",
            payload["section"],
            payload["pipeline"],
            payload["status"],
            exc,
        )
        return False


def publish_success_event(
    *,
    section: str,
    pipeline: str,
    result: dict[str, object] | None,
    slot_key: str | None = None,
) -> bool:
    if not isinstance(result, dict):
        return False

    status = str(result.get("status") or "").strip()
    if status != "completed":
        return False

    summary = str(result.get("details") or "").strip() or f"{pipeline}:{status}"

    return publish_pipeline_event(
        section=section,
        pipeline=pipeline,
        status=status,
        emitted_at=str(
            result.get("finished_at")
            or result.get("started_at")
            or datetime.now(timezone.utc).isoformat()
        ),
        slot_key=slot_key,
        run_id=str(result.get("run_id") or "").strip() or None,
        summary=summary,
    )
