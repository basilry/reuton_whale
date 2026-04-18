from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import requests

from src.storage.queries import now_iso
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from src.storage.sheets_client import SheetsClient


logger = get_logger("telegram_broadcast")

_TELEGRAM_API_BASE = "https://api.telegram.org"
_MAX_MESSAGE_LENGTH = 3900


@dataclass(frozen=True)
class BroadcastAttempt:
    kind: str
    dedup_key: str
    chat_id: str
    status: str
    message_id: str = ""
    error: str = ""

    def to_sheet_row(self) -> dict[str, str]:
        return {
            "ts": now_iso(),
            "kind": self.kind,
            "dedup_key": self.dedup_key,
            "chat_id": self.chat_id,
            "message_id": self.message_id,
            "status": self.status,
            "error": self.error,
        }


class TelegramBroadcastAdapter:
    def __init__(
        self,
        token: str,
        chat_id: str,
        storage: SheetsClient | None = None,
        *,
        enabled: bool = False,
        dry_run: bool = True,
        dry_run_reason: str = "TELEGRAM_BROADCAST_DRY_RUN is true",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._token = token.strip()
        self._chat_id = chat_id.strip()
        self._storage = storage
        self._enabled = enabled
        self._dry_run = dry_run
        self._dry_run_reason = dry_run_reason
        self._timeout_seconds = timeout_seconds

    def state_label(self) -> str:
        if not self._enabled:
            return "disabled"
        if not self._chat_id:
            return "missing_chat_id"
        if not self._token:
            return "missing_token"
        if self._dry_run:
            return "dry_run"
        return "ready"

    def broadcast_daily_brief(
        self,
        *,
        date: str,
        brief_text: str,
        highlights: list[str] | None = None,
        signal_count: int | None = None,
        total_volume_usd: float | int | None = None,
    ) -> BroadcastAttempt:
        dedup_key = f"daily_brief:{date}"
        message = self._build_daily_brief_message(
            date=date,
            brief_text=brief_text,
            highlights=highlights or [],
            signal_count=signal_count,
            total_volume_usd=total_volume_usd,
        )
        return self.broadcast_text(
            text=message,
            kind="daily_brief",
            dedup_key=dedup_key,
        )

    def broadcast_text(
        self,
        *,
        text: str,
        kind: str,
        dedup_key: str,
    ) -> BroadcastAttempt:
        normalized_text = (text or "").strip()
        if not normalized_text:
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="skipped_empty",
                    error="message text was empty",
                )
            )

        if not self._enabled:
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="skipped_disabled",
                    error="TELEGRAM_BROADCAST_ENABLED is false",
                )
            )

        if not self._chat_id or not self._token:
            missing = []
            if not self._chat_id:
                missing.append("TELEGRAM_BROADCAST_CHAT")
            if not self._token:
                missing.append("TELEGRAM_BROADCAST_BOT_TOKEN/TELEGRAM_BOT_TOKEN")
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="skipped_unconfigured",
                    error=f"missing {', '.join(missing)}",
                )
            )

        if self._dry_run:
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="dry_run",
                    error=self._dry_run_reason,
                )
            )

        payload = {
            "chat_id": self._chat_id,
            "text": self._clip_message(normalized_text),
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        try:
            response = requests.post(
                f"{_TELEGRAM_API_BASE}/bot{self._token}/sendMessage",
                json=payload,
                timeout=self._timeout_seconds,
            )
            body = response.json()
            if not response.ok or not body.get("ok"):
                description = str(body.get("description") or response.text or response.reason)
                return self._finalize_attempt(
                    BroadcastAttempt(
                        kind=kind,
                        dedup_key=dedup_key,
                        chat_id=self._chat_id,
                        status="failed",
                        error=self._clip_error(description),
                    )
                )

            result = body.get("result") or {}
            message_id = str(result.get("message_id") or "")
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="sent",
                    message_id=message_id,
                )
            )
        except requests.RequestException as exc:
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="failed",
                    error=self._clip_error(str(exc)),
                )
            )
        except ValueError as exc:
            return self._finalize_attempt(
                BroadcastAttempt(
                    kind=kind,
                    dedup_key=dedup_key,
                    chat_id=self._chat_id,
                    status="failed",
                    error=self._clip_error(f"invalid telegram response: {exc}"),
                )
            )

    def _build_daily_brief_message(
        self,
        *,
        date: str,
        brief_text: str,
        highlights: list[str],
        signal_count: int | None,
        total_volume_usd: float | int | None,
    ) -> str:
        lines = [
            "<b>WhaleScope Daily Brief</b>",
            f"<i>{date} UTC snapshot</i>",
            "",
            brief_text.strip(),
        ]
        if highlights:
            lines.extend(
                [
                    "",
                    "<b>Highlights</b>",
                    *[f"• {item}" for item in highlights if item],
                ]
            )
        meta = []
        if signal_count is not None:
            meta.append(f"signals={signal_count}")
        if total_volume_usd not in (None, ""):
            try:
                meta.append(f"top5_volume=${float(total_volume_usd):,.0f}")
            except (TypeError, ValueError):
                meta.append(f"top5_volume={total_volume_usd}")
        if meta:
            lines.extend(["", f"<i>{' | '.join(meta)}</i>"])
        return self._clip_message("\n".join(lines))

    def _finalize_attempt(self, attempt: BroadcastAttempt) -> BroadcastAttempt:
        if attempt.status == "sent":
            logger.info(
                "Broadcast sent kind=%s chat=%s message_id=%s dedup_key=%s",
                attempt.kind,
                attempt.chat_id,
                attempt.message_id,
                attempt.dedup_key,
            )
        else:
            logger.info(
                "Broadcast status=%s kind=%s chat=%s detail=%s",
                attempt.status,
                attempt.kind,
                attempt.chat_id,
                attempt.error,
            )
        self._persist_attempt(attempt)
        return attempt

    def _persist_attempt(self, attempt: BroadcastAttempt) -> None:
        if self._storage is None:
            return
        try:
            self._storage.append_broadcast_log(attempt.to_sheet_row())
        except Exception as exc:
            logger.warning(
                "Failed to persist broadcast log kind=%s status=%s: %s",
                attempt.kind,
                attempt.status,
                exc,
            )

    def _clip_message(self, text: str) -> str:
        if len(text) <= _MAX_MESSAGE_LENGTH:
            return text
        return f"{text[: _MAX_MESSAGE_LENGTH - 15].rstrip()}\n\n<i>...(truncated)</i>"

    def _clip_error(self, error: str) -> str:
        return str(error or "")[:1000]
