from __future__ import annotations

import json
import requests

from src.pipeline.common import build_sheets_client, init_run_result, load_pipeline_env
from src.storage.queries import now_iso
from src.utils.logger import get_logger

logger = get_logger("pipeline.channel_health")
_TELEGRAM_API_BASE = "https://api.telegram.org"


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


def run_channel_health() -> dict[str, object]:
    result = init_run_result("channel_health")
    env = load_pipeline_env(require_telegram=True)
    sheets = build_sheets_client(env)
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
    logger.info("channel health recorded status=%s chat=%s", entry["status"], chat_id)
    return result


def main() -> None:
    run_channel_health()


if __name__ == "__main__":
    main()
