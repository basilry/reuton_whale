"""Telegram 채널 메트릭 스냅샷.

Usage:
    python scripts/snapshot_telegram_metrics.py \\
        > docs/metrics/tg_snapshot_$(date +%Y%m%d).md

환경 변수:
    TELEGRAM_BOT_TOKEN            (필수) @BotFather 발급 토큰.
    TELEGRAM_CHANNEL_USERNAME     (택 1) 예: @whalescope_alertz
    TELEGRAM_CHANNEL_ID           (택 1) 수치형 채널 id.

`TELEGRAM_CHANNEL_USERNAME`이 우선이며 없을 때만 `TELEGRAM_CHANNEL_ID` 사용.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sys
import urllib.error
import urllib.request


def _tg(method: str, bot_token: str, **params: object) -> dict[str, object]:
    url = f"https://api.telegram.org/bot{bot_token}/{method}"
    data = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"telegram {method} failed: HTTP {exc.code} — {body}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"telegram {method} failed: {exc.reason}") from exc

    if not payload.get("ok"):
        raise SystemExit(f"telegram {method} returned not-ok: {payload!r}")
    return payload["result"]  # type: ignore[return-value]


def main() -> int:
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    channel = (
        os.environ.get("TELEGRAM_CHANNEL_USERNAME", "").strip()
        or os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()
    )

    if not bot_token:
        print("error: TELEGRAM_BOT_TOKEN not set", file=sys.stderr)
        return 2
    if not channel:
        print(
            "error: TELEGRAM_CHANNEL_USERNAME or TELEGRAM_CHANNEL_ID required",
            file=sys.stderr,
        )
        return 2

    count = _tg("getChatMemberCount", bot_token, chat_id=channel)
    chat = _tg("getChat", bot_token, chat_id=channel)

    now = _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    title = chat.get("title", "—") if isinstance(chat, dict) else "—"

    out = [
        f"# Telegram 채널 스냅샷 — {now}",
        "",
        "| 지표 | 값 |",
        "|------|----:|",
        f"| 채널 | `{channel}` |",
        f"| 채널 타이틀 | {title} |",
        f"| 구독자 수 | **{count}** |",
        f"| 스냅샷 시각 | {now} |",
        "",
        "> 발송 건수·view count는 Google Sheets `tg_whale_events` 및 `broadcast_log` 시트의 최근 N건 집계로 보완한다.",
    ]
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
