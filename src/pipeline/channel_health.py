from __future__ import annotations

import json
import requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.observability.service_health import append_service_heartbeat, pipeline_status_to_health
from src.pipeline.common import build_sheets_client, init_run_result, load_pipeline_env
from src.storage.queries import now_iso
from src.utils.logger import get_logger

logger = get_logger("pipeline.channel_health")
_TELEGRAM_API_BASE = "https://api.telegram.org"
_KST = ZoneInfo("Asia/Seoul")
_TERMINAL_RUN_STATUSES = {
    "completed",
    "completed_with_errors",
    "completed_empty",
    "skipped_window",
    "skipped_budget",
}


def _telegram_get(token: str, method: str, *, params: dict[str, str]) -> dict:
    response = requests.get(
        f"{_TELEGRAM_API_BASE}/bot{token}/{method}",
        params=params,
        timeout=10,
    )
    data = response.json()
    if not response.ok or not data.get("ok"):
        description = data.get("description") or response.text or response.reason
        raise RuntimeError(str(description))
    return data.get("result") or {}


def _channel_health_window(now: datetime) -> tuple[datetime, datetime]:
    current_kst = now.astimezone(_KST)
    slot_minute = (current_kst.minute // 15) * 15
    slot_start_kst = current_kst.replace(minute=slot_minute, second=0, microsecond=0)
    slot_end_kst = slot_start_kst + timedelta(minutes=15)
    return slot_start_kst.astimezone(timezone.utc), slot_end_kst.astimezone(timezone.utc)


def _record_channel_health_heartbeat(sheets, result: dict[str, object], entry: dict[str, object]) -> None:
    append_service_heartbeat(
        sheets,
        service="telegram.channel_health",
        component="channel",
        status=pipeline_status_to_health(result.get("status")),
        run_status=result.get("status"),
        heartbeat_key=str(result.get("run_id", "")),
        details={
            "status": entry.get("status", ""),
            "chat_id": entry.get("chat_id", ""),
            "member_count": entry.get("member_count", ""),
        },
        error=entry.get("error", "") or result.get("errors", ""),
        observed_at=result.get("finished_at") or result.get("started_at") or entry.get("ts"),
        processed_count=1 if entry.get("status") == "ok" else 0,
        source_name="telegram_api",
    )


def run_channel_health() -> dict[str, object]:
    result = init_run_result("channel_health")
    env = load_pipeline_env(require_telegram=True)
    sheets = build_sheets_client(env)
    now = datetime.now(timezone.utc)
    token = env.telegram_broadcast_token or env.telegram_token
    chat_id = env.telegram_broadcast_chat

    entry = {
        "ts": now_iso(),
        "chat_id": chat_id,
        "title": "",
        "username": "",
        "member_count": "",
        "status": "missing_config",
        "error": "",
    }
    errors: list[str] = []

    window_start, window_end = _channel_health_window(now)
    if sheets.has_logged_run_in_window(
        run_type="channel_health",
        window_start=window_start,
        window_end=window_end,
        statuses=_TERMINAL_RUN_STATUSES,
    ):
        result.update(
            status="skipped_duplicate",
            finished_at=now_iso(),
            errors="[]",
            details="Channel health already recorded for current slot",
        )
        sheets.log_run(result)
        _record_channel_health_heartbeat(sheets, result, entry)
        return result

    if not token or not chat_id:
        entry["error"] = "Missing telegram token or broadcast chat"
    else:
        try:
            chat = _telegram_get(token, "getChat", params={"chat_id": chat_id})
            member_count = _telegram_get(
                token, "getChatMemberCount", params={"chat_id": chat_id}
            )
            entry.update(
                {
                    "title": str(chat.get("title", "")),
                    "username": str(chat.get("username", "")),
                    "member_count": str(member_count),
                    "status": "ok",
                }
            )
        except Exception as exc:
            errors.append(f"channel_health:{exc}")
            entry["status"] = "error"
            entry["error"] = str(exc)[:1000]

    sheets.append_channel_health(entry)
    result.update(
        status="completed" if not errors else "completed_with_errors",
        finished_at=now_iso(),
        errors=json.dumps(errors, ensure_ascii=False),
        details=f"status={entry['status']}; chat_id={chat_id}",
    )
    sheets.log_run(result)
    _record_channel_health_heartbeat(sheets, result, entry)
    logger.info("channel health recorded status=%s chat=%s", entry["status"], chat_id)
    return result


def main() -> None:
    run_channel_health()


if __name__ == "__main__":
    main()
