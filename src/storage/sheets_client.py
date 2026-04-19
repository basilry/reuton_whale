import hashlib
import json
import threading
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

from src.storage.queries import dict_to_row, now_iso, row_to_dict
from src.storage.schema import (
    ADDRESS_ACTIVITY_HEADERS,
    BRIEF_COST_LEDGER_HEADERS,
    BROADCAST_LOG_HEADERS,
    CHANNEL_HEALTH_HEADERS,
    CURATED_WALLET_BALANCES_HEADERS,
    CURATED_WALLETS_HEADERS,
    LLM_BUDGET_LOG_HEADERS,
    NEWS_FEED_HEADERS,
    ALL_TABS,
    ANALYSIS_LOG_HEADERS,
    DAILY_BRIEF_HEADERS,
    SIGNALS_HEADERS,
    SUBSCRIBERS_HEADERS,
    SYSTEM_LOG_HEADERS,
    TAB_ADDRESS_ACTIVITY,
    TAB_ANALYSIS_LOG,
    TAB_BRIEF_COST_LEDGER,
    TAB_BROADCAST_LOG,
    TAB_CHANNEL_HEALTH,
    TAB_CURATED_WALLET_BALANCES,
    TAB_CURATED_WALLETS,
    TAB_DAILY_BRIEF,
    TAB_HEADERS,
    TAB_LLM_BUDGET_LOG,
    TAB_NEWS_FEED,
    TAB_SIGNALS,
    TAB_SERVICE_HEALTH,
    TAB_SUBSCRIBERS,
    TAB_SYSTEM_LOG,
    TAB_TG_WHALE_EVENTS,
    TAB_TRANSACTIONS,
    TAB_USER_INTERESTS,
    TAB_WATCHED_ADDRESSES,
    TAB_WEEKLY_TREND,
    TAB_WHALE_STORIES,
    TG_WHALE_EVENTS_HEADERS,
    TRANSACTIONS_HEADERS,
    USER_INTERESTS_HEADERS,
    WATCHED_ADDRESSES_HEADERS,
    WEEKLY_TREND_HEADERS,
    WHALE_STORIES_HEADERS,
    SERVICE_HEALTH_HEADERS,
)
from src.utils.errors import StorageError
from src.utils.logger import get_logger
from src.utils.retry import retry

logger = get_logger("sheets_client")

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

# Shared subscriber schema now carries churn-related timestamps. The optional
# language column remains a local extension so older readers can keep using the
# shared header layout.
SUBSCRIBERS_HEADERS_EXT = [*SUBSCRIBERS_HEADERS, "language"]
SUBSCRIBER_STATUSES = {"active", "paused", "blocked", "deactivated"}


def _parse_coins(raw: str) -> list[str]:
    if not raw:
        return []
    return [c.strip().upper() for c in raw.split(",") if c.strip()]


def _serialize_coins(coins: list[str]) -> str:
    return ",".join(c.strip().upper() for c in coins if c and c.strip())


def _normalize_subscriber(row_dict: dict) -> dict:
    chat_id_raw = row_dict.get("chat_id", "")
    try:
        chat_id = int(chat_id_raw) if chat_id_raw != "" else None
    except (TypeError, ValueError):
        chat_id = chat_id_raw
    language = row_dict.get("language", "")
    result = {
        "chat_id": chat_id,
        "username": row_dict.get("username", ""),
        "status": row_dict.get("status", ""),
        "watchlist": _parse_coins(row_dict.get("watchlist_coins", "")),
        "created_at": row_dict.get("created_at", ""),
        "updated_at": row_dict.get("updated_at", ""),
        "last_brief_at": row_dict.get("last_brief_at", ""),
        "status_changed_at": row_dict.get("status_changed_at", ""),
    }
    if language:
        result["language"] = language
    return result


from src.utils.datetime_utils import parse_dt as _parse_dt  # noqa: E302


def _normalize_event_time(row: dict) -> datetime | None:
    return _parse_dt(row.get("tg_date") or row.get("collected_at"))


def _parse_row_time(value: str) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.isdigit():
            return datetime.fromtimestamp(int(raw), tz=timezone.utc)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None


def _json_loads_safe(value: str) -> dict | list | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _column_letter(index_1based: int) -> str:
    """Convert a 1-based column index to A1 notation (1 -> A, 27 -> AA)."""
    if index_1based <= 0:
        raise ValueError(f"column index must be >= 1, got {index_1based}")
    letters = ""
    n = index_1based
    while n > 0:
        n, rem = divmod(n - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return letters


class SheetsClient:
    def __init__(self, sheet_id: str, credentials_json: str):
        try:
            creds_dict = json.loads(credentials_json)
            creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
            self._gc = gspread.authorize(creds)
            self._spreadsheet = self._gc.open_by_key(sheet_id)
        except Exception as e:
            raise StorageError(f"Failed to initialize SheetsClient: {e}") from e
        self._worksheet_cache: dict[str, gspread.Worksheet] = {}
        self._append_only_schema_verified: set[str] = set()
        self._system_log_cache: list[dict] | None = None
        self._ensure_worksheets()
        # Serializes gspread mutations across threads (async callers via
        # asyncio.to_thread may schedule multiple writes concurrently).
        self._write_lock = threading.Lock()

    def _ensure_worksheets(self) -> None:
        worksheets = self._spreadsheet.worksheets()
        existing = {ws.title for ws in worksheets}
        for tab_name in ALL_TABS:
            if tab_name not in existing:
                ws = self._spreadsheet.add_worksheet(
                    title=tab_name, rows=1000, cols=len(TAB_HEADERS[tab_name])
                )
                ws.append_row(TAB_HEADERS[tab_name])
                self._worksheet_cache[tab_name] = ws
                logger.info("Created worksheet: %s", tab_name)

    def _worksheet(self, tab_name: str) -> gspread.Worksheet:
        cached = self._worksheet_cache.get(tab_name)
        if cached is not None:
            return cached
        ws = self._spreadsheet.worksheet(tab_name)
        self._worksheet_cache[tab_name] = ws
        return ws

    def _ensure_append_only_schema_once(
        self,
        ws: "gspread.Worksheet",
        expected_headers: list[str],
        *,
        tab_name: str,
    ) -> None:
        if tab_name in self._append_only_schema_verified:
            return
        all_values = ws.get_all_values()
        self._ensure_append_only_header_schema(
            ws,
            all_values,
            expected_headers,
            tab_name=tab_name,
        )
        self._append_only_schema_verified.add(tab_name)

    @staticmethod
    def _normalize_entry(entry: dict, headers: list[str]) -> dict:
        return row_to_dict(dict_to_row(entry, headers), headers)

    def _append_system_log_cache_entry(self, entry: dict) -> None:
        if self._system_log_cache is None:
            return
        self._system_log_cache.append(self._normalize_entry(entry, SYSTEM_LOG_HEADERS))

    # --- transactions ---

    @retry(max_retries=3, base_delay=2.0)
    def append_transactions(self, transactions: list[dict]) -> int:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_TRANSACTIONS)
                existing_hashes = set()
                all_values = ws.get_all_values()
                if len(all_values) > 1:
                    hash_col = TRANSACTIONS_HEADERS.index("raw_response_hash")
                    existing_hashes = {row[hash_col] for row in all_values[1:]}

                new_rows = []
                for tx in transactions:
                    if tx.get("raw_response_hash") in existing_hashes:
                        continue
                    tx.setdefault("created_at", now_iso())
                    new_rows.append(dict_to_row(tx, TRANSACTIONS_HEADERS))

                if new_rows:
                    ws.append_rows(new_rows, value_input_option="RAW")
                logger.info("Appended %d transactions (%d duplicates skipped)",
                            len(new_rows), len(transactions) - len(new_rows))
                return len(new_rows)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append transactions: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_transactions(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        try:
            ws = self._worksheet(TAB_TRANSACTIONS)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []

            rows = [row_to_dict(row, TRANSACTIONS_HEADERS) for row in all_values[1:]]
            if since is not None:
                filtered: list[dict] = []
                for row in rows:
                    row_time = _parse_row_time(row.get("created_at") or row.get("timestamp", ""))
                    if row_time is None:
                        continue
                    if row_time.tzinfo is None and since.tzinfo is not None:
                        row_time = row_time.replace(tzinfo=since.tzinfo)
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered

            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list transactions: {e}") from e

    # --- daily_brief ---

    @retry(max_retries=3, base_delay=2.0)
    def save_daily_brief(self, date: str, briefs: list[dict]) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_DAILY_BRIEF)
                all_values = ws.get_all_values()
                self._ensure_daily_brief_schema(ws, all_values)

                rows = []
                for brief in briefs:
                    normalized = dict(brief)
                    if "signal_themes" not in normalized and "signalThemes" in normalized:
                        normalized["signal_themes"] = normalized.pop("signalThemes")
                    if "input_fingerprint" not in normalized and "inputFingerprint" in normalized:
                        normalized["input_fingerprint"] = normalized.pop("inputFingerprint")
                    normalized["date"] = date
                    normalized.setdefault("created_at", now_iso())
                    rows.append(dict_to_row(normalized, DAILY_BRIEF_HEADERS))
                if rows:
                    ws.append_rows(rows, value_input_option="RAW")
                logger.info("Saved %d daily brief entries for %s", len(rows), date)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to save daily brief: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def get_daily_brief(self, date: str) -> list[dict]:
        try:
            ws = self._worksheet(TAB_DAILY_BRIEF)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            date_col = DAILY_BRIEF_HEADERS.index("date")
            return [
                row_to_dict(row, DAILY_BRIEF_HEADERS)
                for row in all_values[1:]
                if row[date_col] == date
            ]
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get daily brief: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def get_latest_daily_brief(self) -> dict | None:
        try:
            ws = self._worksheet(TAB_DAILY_BRIEF)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return None
            return row_to_dict(all_values[-1], DAILY_BRIEF_HEADERS)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get latest daily brief: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def find_daily_brief_by_fingerprint(self, fingerprint: str) -> dict | None:
        target = str(fingerprint or "").strip()
        if not target:
            return None
        try:
            ws = self._worksheet(TAB_DAILY_BRIEF)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return None

            fingerprint_col = DAILY_BRIEF_HEADERS.index("input_fingerprint")
            for row in reversed(all_values[1:]):
                if fingerprint_col < len(row) and str(row[fingerprint_col]).strip() == target:
                    return row_to_dict(row, DAILY_BRIEF_HEADERS)
            return None
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to find daily brief by fingerprint: {e}") from e

    # --- subscribers ---

    def _find_subscriber_row(self, all_values: list[list[str]], chat_id: int) -> int | None:
        if len(all_values) <= 1:
            return None
        col = SUBSCRIBERS_HEADERS_EXT.index("chat_id")
        target = str(chat_id)
        for i, row in enumerate(all_values[1:], start=2):
            if i - 2 < len(all_values) - 1 and col < len(row) and row[col] == target:
                return i
        return None

    def _ensure_subscribers_schema(
        self,
        ws: "gspread.Worksheet",
        all_values: list[list[str]],
    ) -> None:
        self._ensure_append_only_header_schema(
            ws,
            all_values,
            SUBSCRIBERS_HEADERS,
            tab_name=TAB_SUBSCRIBERS,
        )

    def _resolve_status_changed_at(
        self,
        existing: dict | None,
        status: str,
        now: str,
    ) -> str:
        normalized_status = str(status or "").strip().lower()
        if not normalized_status:
            return str((existing or {}).get("status_changed_at", "") or "")

        if existing is None:
            return now

        previous_status = str(existing.get("status", "") or "").strip().lower()
        if previous_status != normalized_status:
            return now
        return str(existing.get("status_changed_at", "") or "")

    @retry(max_retries=3, base_delay=2.0)
    def list_subscribers(self, statuses: list[str] | None = None) -> list[dict]:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []

            allowed = {
                str(status or "").strip().lower()
                for status in (statuses or [])
                if str(status or "").strip()
            }
            rows = [
                _normalize_subscriber(row_to_dict(row, SUBSCRIBERS_HEADERS_EXT))
                for row in all_values[1:]
            ]
            if allowed:
                rows = [
                    row for row in rows
                    if str(row.get("status", "")).strip().lower() in allowed
                ]
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list subscribers: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def get_active_subscribers(self) -> list[dict]:
        return self.list_subscribers(statuses=["active"])

    @retry(max_retries=3, base_delay=2.0)
    def get_subscriber_info(self, chat_id: int) -> dict | None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            row_idx = self._find_subscriber_row(all_values, chat_id)
            if row_idx is None:
                return None
            return _normalize_subscriber(
                row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS_EXT)
            )
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get subscriber info: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def add_subscriber(self, chat_id: int, username: str) -> None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            self._ensure_subscribers_schema(ws, all_values)
            row_idx = self._find_subscriber_row(all_values, chat_id)
            now = now_iso()

            if row_idx is not None:
                existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS_EXT)
                status = "active"
                entry = {
                    "chat_id": chat_id,
                    "username": username or existing.get("username", ""),
                    "status": status,
                    "watchlist_coins": existing.get("watchlist_coins", ""),
                    "created_at": existing.get("created_at", "") or now,
                    "updated_at": now,
                    "last_brief_at": existing.get("last_brief_at", ""),
                    "status_changed_at": self._resolve_status_changed_at(existing, status, now),
                    "language": existing.get("language", ""),
                }
                self._write_subscriber_row(ws, row_idx, entry)
                logger.info("Reactivated subscriber %d", chat_id)
            else:
                status = "active"
                entry = {
                    "chat_id": chat_id,
                    "username": username,
                    "status": status,
                    "watchlist_coins": "",
                    "created_at": now,
                    "updated_at": now,
                    "last_brief_at": "",
                    "status_changed_at": now,
                    "language": "",
                }
                ws.append_row(
                    dict_to_row(entry, SUBSCRIBERS_HEADERS_EXT),
                    value_input_option="RAW",
                )
                logger.info("Added subscriber %d", chat_id)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to add subscriber: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def get_watchlist(self, chat_id: int) -> list[str]:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            row_idx = self._find_subscriber_row(all_values, chat_id)
            if row_idx is None:
                return []
            entry = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS_EXT)
            return _parse_coins(entry.get("watchlist_coins", ""))
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get watchlist: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def set_watchlist(self, chat_id: int, coins: list[str]) -> None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            self._ensure_subscribers_schema(ws, all_values)
            row_idx = self._find_subscriber_row(all_values, chat_id)
            now = now_iso()
            serialized = _serialize_coins(coins)

            if row_idx is not None:
                existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS_EXT)
                entry = {
                    **existing,
                    "chat_id": chat_id,
                    "watchlist_coins": serialized,
                    "updated_at": now,
                }
                self._write_subscriber_row(ws, row_idx, entry)
                logger.info("Updated watchlist for subscriber %d", chat_id)
            else:
                entry = {
                    "chat_id": chat_id,
                    "username": "",
                    "status": "active",
                    "watchlist_coins": serialized,
                    "created_at": now,
                    "updated_at": now,
                    "last_brief_at": "",
                    "status_changed_at": now,
                    "language": "",
                }
                ws.append_row(
                    dict_to_row(entry, SUBSCRIBERS_HEADERS_EXT),
                    value_input_option="RAW",
                )
                logger.info("Created subscriber %d via set_watchlist", chat_id)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to set watchlist: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def set_status(self, chat_id: int, status: str) -> None:
        normalized_status = str(status or "").strip().lower()
        if normalized_status not in SUBSCRIBER_STATUSES:
            raise StorageError(f"Invalid status: {status}")
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            self._ensure_subscribers_schema(ws, all_values)
            row_idx = self._find_subscriber_row(all_values, chat_id)
            if row_idx is None:
                raise StorageError(f"Subscriber {chat_id} not found")
            existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS_EXT)
            now = now_iso()
            entry = {
                **existing,
                "chat_id": chat_id,
                "status": normalized_status,
                "updated_at": now,
                "status_changed_at": self._resolve_status_changed_at(
                    existing,
                    normalized_status,
                    now,
                ),
            }
            self._write_subscriber_row(ws, row_idx, entry)
            logger.info("Set subscriber %d status=%s", chat_id, normalized_status)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to set status: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def update_subscriber_language(self, chat_id: int, language: str) -> None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            self._ensure_subscribers_schema(ws, all_values)
            row_idx = self._find_subscriber_row(all_values, chat_id)
            now = now_iso()

            if row_idx is not None:
                existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS_EXT)
                entry = {
                    **existing,
                    "chat_id": chat_id,
                    "language": language,
                    "updated_at": now,
                }
                self._write_subscriber_row(ws, row_idx, entry)
                logger.info("Updated subscriber %d language=%s", chat_id, language)
            else:
                entry = {
                    "chat_id": chat_id,
                    "username": "",
                    "status": "active",
                    "watchlist_coins": "",
                    "created_at": now,
                    "updated_at": now,
                    "last_brief_at": "",
                    "status_changed_at": now,
                    "language": language,
                }
                ws.append_row(
                    dict_to_row(entry, SUBSCRIBERS_HEADERS_EXT),
                    value_input_option="RAW",
                )
                logger.info(
                    "Created subscriber %d with language=%s", chat_id, language
                )
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to update subscriber language: {e}") from e

    def _write_subscriber_row(
        self, ws: gspread.Worksheet, row_idx: int, entry: dict
    ) -> None:
        row_data = dict_to_row(entry, SUBSCRIBERS_HEADERS_EXT)
        last_col_idx = len(SUBSCRIBERS_HEADERS_EXT) - 1
        # Handle column names beyond 'Z' (not needed for 8 columns, but safe).
        if last_col_idx < 26:
            last_col = chr(ord("A") + last_col_idx)
        else:
            first = chr(ord("A") + (last_col_idx // 26) - 1)
            second = chr(ord("A") + (last_col_idx % 26))
            last_col = f"{first}{second}"
        cell_range = f"A{row_idx}:{last_col}{row_idx}"
        ws.update(cell_range, [row_data], value_input_option="RAW")

    # --- legacy watchlist API (reimplemented on subscribers) ---

    def get_active_watchlists(self) -> list[dict]:
        """Deprecated: use list_watched_addresses / get_active_subscribers instead."""
        return [
            {
                "user_id": sub["chat_id"],
                "username": sub["username"],
                "coins": sub["watchlist"],
                "active": "true",
                "updated_at": sub["updated_at"],
            }
            for sub in self.get_active_subscribers()
        ]

    def upsert_watchlist(self, user_id: int, username: str, coins: list[str]) -> None:
        """Deprecated: use upsert_watched_address / list_watched_addresses instead."""
        with self._write_lock:
            self.add_subscriber(chat_id=user_id, username=username)
            self.set_watchlist(chat_id=user_id, coins=coins)

    # --- analysis_log ---

    @retry(max_retries=3, base_delay=2.0)
    def get_cached_analysis(self, prompt_hash: str) -> dict | None:
        try:
            ws = self._worksheet(TAB_ANALYSIS_LOG)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return None
            hash_col = ANALYSIS_LOG_HEADERS.index("prompt_hash")
            for row in reversed(all_values[1:]):
                if row[hash_col] == prompt_hash:
                    return row_to_dict(row, ANALYSIS_LOG_HEADERS)
            return None
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get cached analysis: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def save_analysis(self, log_entry: dict) -> None:
        try:
            ws = self._worksheet(TAB_ANALYSIS_LOG)
            log_entry.setdefault("created_at", now_iso())
            ws.append_row(
                dict_to_row(log_entry, ANALYSIS_LOG_HEADERS),
                value_input_option="RAW",
            )
            logger.info("Saved analysis log: %s", log_entry.get("prompt_hash", "?"))
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to save analysis: {e}") from e

    # --- system_log ---

    @retry(max_retries=3, base_delay=2.0)
    def log_run(self, run_data: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_SYSTEM_LOG)
                ws.append_row(
                    dict_to_row(run_data, SYSTEM_LOG_HEADERS),
                    value_input_option="RAW",
                )
                self._append_system_log_cache_entry(run_data)
                logger.info("Logged run: %s", run_data.get("run_id", "?"))
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to log run: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def append_system_log(self, level: str, category: str, payload: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_SYSTEM_LOG)
                entry = self._build_system_log_entry(level, category, payload)
                ws.append_row(
                    dict_to_row(entry, SYSTEM_LOG_HEADERS),
                    value_input_option="RAW",
                )
                self._append_system_log_cache_entry(entry)
                logger.info("Appended system log level=%s category=%s", level, category)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append system log: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_system_log(
        self,
        *,
        run_type: str | None = None,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        try:
            if self._system_log_cache is None:
                ws = self._worksheet(TAB_SYSTEM_LOG)
                all_values = ws.get_all_values()
                if len(all_values) <= 1:
                    self._system_log_cache = []
                else:
                    self._system_log_cache = [
                        row_to_dict(row, SYSTEM_LOG_HEADERS) for row in all_values[1:]
                    ]

            rows = list(self._system_log_cache)
            if run_type:
                rows = [row for row in rows if str(row.get("run_type", "")).strip() == run_type]

            if since is not None:
                filtered: list[dict] = []
                for row in rows:
                    row_time = _parse_row_time(row.get("started_at") or row.get("finished_at", ""))
                    if row_time is None:
                        continue
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered

            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list system log: {e}") from e

    def has_logged_run_in_window(
        self,
        *,
        run_type: str,
        window_start: datetime,
        window_end: datetime,
        statuses: set[str] | None = None,
    ) -> bool:
        rows = self.list_system_log(run_type=run_type, since=window_start)
        for row in reversed(rows):
            row_time = _parse_row_time(row.get("started_at") or row.get("finished_at", ""))
            if row_time is None:
                continue
            if row_time < window_start or row_time >= window_end:
                continue
            status = str(row.get("status", "")).strip().lower()
            if statuses is not None and status not in statuses:
                continue
            return True
        return False

    @retry(max_retries=3, base_delay=2.0)
    def append_broadcast_log(self, entry: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_BROADCAST_LOG)
                self._ensure_append_only_schema_once(
                    ws,
                    BROADCAST_LOG_HEADERS,
                    tab_name=TAB_BROADCAST_LOG,
                )
                normalized = {
                    "ts": entry.get("ts", now_iso()),
                    "kind": str(entry.get("kind", "")),
                    "dedup_key": str(entry.get("dedup_key", "")),
                    "chat_id": str(entry.get("chat_id", "")),
                    "message_id": str(entry.get("message_id", "")),
                    "status": str(entry.get("status", "")),
                    "error": str(entry.get("error", ""))[:1000],
                    "message_length": self._int_value(entry.get("message_length")),
                    "content_hash": str(entry.get("content_hash", "")),
                    "signal_count": self._int_value(entry.get("signal_count")),
                    "transaction_count": self._int_value(entry.get("transaction_count")),
                    "slot_key": str(entry.get("slot_key", "")),
                    "delivery_mode": str(entry.get("delivery_mode", "")),
                }
                ws.append_row(
                    dict_to_row(normalized, BROADCAST_LOG_HEADERS),
                    value_input_option="RAW",
                )
                logger.info(
                    "Appended broadcast log kind=%s status=%s dedup_key=%s",
                    normalized["kind"],
                    normalized["status"],
                    normalized["dedup_key"],
                )
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append broadcast log: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_broadcast_log(
        self,
        *,
        kind: str | None = None,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        try:
            ws = self._worksheet(TAB_BROADCAST_LOG)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            rows = [row_to_dict(row, BROADCAST_LOG_HEADERS) for row in all_values[1:]]
            if kind:
                rows = [row for row in rows if str(row.get("kind", "")).strip() == kind]
            if since is not None:
                filtered: list[dict] = []
                for row in rows:
                    row_time = _parse_row_time(row.get("ts", ""))
                    if row_time is None:
                        continue
                    if row_time.tzinfo is None and since.tzinfo is not None:
                        row_time = row_time.replace(tzinfo=since.tzinfo)
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered
            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list broadcast log: {e}") from e

    # --- watched_addresses ---

    @retry(max_retries=3, base_delay=2.0)
    def upsert_watched_address(self, addr: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_WATCHED_ADDRESSES)
                all_values = ws.get_all_values()
                addr_col = WATCHED_ADDRESSES_HEADERS.index("address")
                target = str(addr.get("address", ""))
                for i, row in enumerate(all_values[1:], start=2):
                    if addr_col < len(row) and row[addr_col] == target:
                        existing = row_to_dict(row, WATCHED_ADDRESSES_HEADERS)
                        existing["label"] = addr.get("label", existing.get("label", ""))
                        existing["enabled"] = str(addr.get("enabled", existing.get("enabled", "true")))
                        self._write_row(ws, i, existing, WATCHED_ADDRESSES_HEADERS)
                        logger.info("Updated watched address: %s", target)
                        return
                addr.setdefault("added_at", now_iso())
                ws.append_row(dict_to_row(addr, WATCHED_ADDRESSES_HEADERS), value_input_option="RAW")
                logger.info("Added watched address: %s", target)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to upsert watched address: {e}") from e

    def _normalize_curated_wallet_address(self, address: str, chain: str) -> str:
        value = str(address or "").strip()
        if not value:
            return ""
        if chain.lower() in self._EVM_CHAINS or value.startswith("0x"):
            return value.lower()
        return value

    @retry(max_retries=3, base_delay=2.0)
    def upsert_curated_wallets(self, wallets: list[dict]) -> dict[str, int]:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_CURATED_WALLETS)
                all_values = ws.get_all_values()
                id_col = CURATED_WALLETS_HEADERS.index("id")
                address_col = CURATED_WALLETS_HEADERS.index("address")
                chain_col = CURATED_WALLETS_HEADERS.index("chain")

                existing_by_id: dict[str, tuple[int, dict]] = {}
                existing_by_address: dict[str, tuple[int, dict]] = {}
                for row_idx, row in enumerate(all_values[1:], start=2):
                    entry = row_to_dict(row, CURATED_WALLETS_HEADERS)
                    wallet_id = str(entry.get("id", "")).strip().lower()
                    address = self._normalize_curated_wallet_address(
                        entry.get("address", ""), entry.get("chain", "")
                    )
                    if wallet_id:
                        existing_by_id[wallet_id] = (row_idx, entry)
                    if address:
                        existing_by_address[address] = (row_idx, entry)

                now = now_iso()
                inserted = 0
                updated = 0
                invalid = 0
                seen_ids = set(existing_by_id.keys())
                seen_addresses = set(existing_by_address.keys())

                for wallet in wallets:
                    entry = dict(wallet)
                    wallet_id = str(entry.get("id", "")).strip()
                    address = str(entry.get("address", "")).strip()
                    chain = str(entry.get("chain", "")).strip()

                    if not wallet_id or not address:
                        invalid += 1
                        continue

                    normalized_id = wallet_id.lower()
                    normalized_address = self._normalize_curated_wallet_address(
                        address, chain
                    )
                    if not normalized_address:
                        invalid += 1
                        continue

                    if normalized_id in seen_ids or normalized_address in seen_addresses:
                        row_match = existing_by_id.get(normalized_id)
                        if row_match is None:
                            row_match = existing_by_address.get(normalized_address)
                        if row_match is not None:
                            row_idx, existing = row_match
                            merged = {**existing, **entry}
                            merged["id"] = wallet_id
                            merged["address"] = address
                            merged["created_at"] = existing.get("created_at", "") or now
                            merged["updated_at"] = now
                            self._write_row(ws, row_idx, merged, CURATED_WALLETS_HEADERS)
                            updated += 1
                        continue

                    entry["id"] = wallet_id
                    entry["address"] = address
                    entry["chain"] = chain
                    entry.setdefault("created_at", now)
                    entry["updated_at"] = now
                    ws.append_row(
                        dict_to_row(entry, CURATED_WALLETS_HEADERS),
                        value_input_option="RAW",
                    )
                    inserted += 1
                    seen_ids.add(normalized_id)
                    seen_addresses.add(normalized_address)

                logger.info(
                    "Upserted curated wallets: %d inserted, %d updated, %d invalid",
                    inserted,
                    updated,
                    invalid,
                )
                return {"inserted": inserted, "updated": updated, "invalid": invalid}
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to upsert curated wallets: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_curated_wallets(self, active_only: bool = True) -> list[dict]:
        try:
            ws = self._worksheet(TAB_CURATED_WALLETS)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            rows = [row_to_dict(row, CURATED_WALLETS_HEADERS) for row in all_values[1:]]
            if not active_only:
                return rows
            return [
                row for row in rows
                if str(row.get("is_active", "true")).strip().lower() not in {"false", "0", "no"}
            ]
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list curated wallets: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def upsert_curated_wallet_balances(self, balances: list[dict]) -> dict[str, int]:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_CURATED_WALLET_BALANCES)
                all_values = ws.get_all_values()
                id_col = CURATED_WALLET_BALANCES_HEADERS.index("wallet_id")
                chain_col = CURATED_WALLET_BALANCES_HEADERS.index("chain")
                address_col = CURATED_WALLET_BALANCES_HEADERS.index("address")

                existing_by_id: dict[str, tuple[int, dict]] = {}
                existing_by_address: dict[tuple[str, str], tuple[int, dict]] = {}
                for row_idx, row in enumerate(all_values[1:], start=2):
                    entry = row_to_dict(row, CURATED_WALLET_BALANCES_HEADERS)
                    wallet_id = str(entry.get("wallet_id", "")).strip().lower()
                    chain = str(entry.get("chain", "")).strip().lower()
                    address = self._normalize_curated_wallet_address(
                        entry.get("address", ""), chain
                    )
                    if wallet_id:
                        existing_by_id[wallet_id] = (row_idx, entry)
                    if chain and address:
                        existing_by_address[(chain, address)] = (row_idx, entry)

                now = now_iso()
                inserted = 0
                updated = 0
                invalid = 0
                for balance in balances:
                    entry = dict(balance)
                    wallet_id = str(entry.get("wallet_id", "")).strip()
                    chain = str(entry.get("chain", "")).strip()
                    address = str(entry.get("address", "")).strip()
                    if not wallet_id or not chain or not address:
                        invalid += 1
                        continue

                    key_by_id = wallet_id.lower()
                    key_by_address = (
                        chain.lower(),
                        self._normalize_curated_wallet_address(address, chain),
                    )
                    existing = existing_by_id.get(key_by_id) or existing_by_address.get(key_by_address)

                    entry["wallet_id"] = wallet_id
                    entry["chain"] = chain
                    entry["address"] = address
                    entry["updated_at"] = entry.get("updated_at") or now
                    entry.setdefault("is_active", "true")

                    if existing is not None:
                        row_idx, current = existing
                        merged = {**current, **entry}
                        self._write_row(ws, row_idx, merged, CURATED_WALLET_BALANCES_HEADERS)
                        updated += 1
                        continue

                    ws.append_row(
                        dict_to_row(entry, CURATED_WALLET_BALANCES_HEADERS),
                        value_input_option="RAW",
                    )
                    inserted += 1
                    existing_by_id[key_by_id] = (-1, entry)
                    existing_by_address[key_by_address] = (-1, entry)

                logger.info(
                    "Upserted curated wallet balances: %d inserted, %d updated, %d invalid",
                    inserted,
                    updated,
                    invalid,
                )
                return {"inserted": inserted, "updated": updated, "invalid": invalid}
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to upsert curated wallet balances: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def append_missing_watched_addresses(self, addresses: list[dict]) -> dict[str, int]:
        """Append missing watched addresses with one read and one batch write."""
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_WATCHED_ADDRESSES)
                all_values = ws.get_all_values()
                addr_col = WATCHED_ADDRESSES_HEADERS.index("address")
                existing = {
                    row[addr_col]
                    for row in all_values[1:]
                    if addr_col < len(row) and row[addr_col]
                }

                now = now_iso()
                new_rows = []
                skipped = 0
                invalid = 0
                for addr in addresses:
                    target = str(addr.get("address", "")).strip()
                    if not target:
                        invalid += 1
                        continue
                    if target in existing:
                        skipped += 1
                        continue
                    entry = dict(addr)
                    entry["address"] = target
                    entry.setdefault("added_at", now)
                    new_rows.append(dict_to_row(entry, WATCHED_ADDRESSES_HEADERS))
                    existing.add(target)

                if new_rows:
                    ws.append_rows(new_rows, value_input_option="RAW")
                logger.info(
                    "Appended %d missing watched addresses (%d existing skipped, %d invalid skipped)",
                    len(new_rows),
                    skipped,
                    invalid,
                )
                return {"inserted": len(new_rows), "skipped": skipped, "invalid": invalid}
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append missing watched addresses: {e}") from e

    _EVM_CHAINS = {"eth", "ethereum", "arbitrum", "base", "bsc", "polygon"}

    @retry(max_retries=3, base_delay=2.0)
    def list_watched_addresses(self) -> dict[str, dict]:
        try:
            ws = self._worksheet(TAB_WATCHED_ADDRESSES)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return {}
            result = {}
            for row in all_values[1:]:
                d = row_to_dict(row, WATCHED_ADDRESSES_HEADERS)
                addr = d.get("address", "")
                chain = d.get("chain", "").lower()
                key = addr.lower() if chain in self._EVM_CHAINS else addr
                result[key] = d
            return result
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list watched addresses: {e}") from e

    # --- address_activity ---

    @retry(max_retries=3, base_delay=2.0)
    def append_address_activity(self, events: list[dict]) -> int:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_ADDRESS_ACTIVITY)
                all_values = ws.get_all_values()
                tx_col = ADDRESS_ACTIVITY_HEADERS.index("tx_hash")
                wa_col = ADDRESS_ACTIVITY_HEADERS.index("watched_address")
                dir_col = ADDRESS_ACTIVITY_HEADERS.index("direction")
                existing_keys: set[tuple] = set()
                if len(all_values) > 1:
                    for row in all_values[1:]:
                        key = (
                            row[tx_col] if tx_col < len(row) else "",
                            row[wa_col] if wa_col < len(row) else "",
                            row[dir_col] if dir_col < len(row) else "",
                        )
                        existing_keys.add(key)
                new_rows = []
                for ev in events:
                    key = (
                        str(ev.get("tx_hash", "")),
                        str(ev.get("watched_address", "")),
                        str(ev.get("direction", "")),
                    )
                    if key in existing_keys:
                        continue
                    ev.setdefault("collected_at", now_iso())
                    new_rows.append(dict_to_row(ev, ADDRESS_ACTIVITY_HEADERS))
                    existing_keys.add(key)
                if new_rows:
                    ws.append_rows(new_rows, value_input_option="RAW")
                logger.info("Appended %d address activity events", len(new_rows))
                return len(new_rows)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append address activity: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_address_activity(self, since: datetime | None = None) -> list[dict]:
        try:
            ws = self._worksheet(TAB_ADDRESS_ACTIVITY)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            rows = [row_to_dict(row, ADDRESS_ACTIVITY_HEADERS) for row in all_values[1:]]
            if since is None:
                return rows

            filtered = []
            for row in rows:
                raw_time = row.get("block_time") or row.get("collected_at")
                try:
                    row_time = datetime.fromisoformat(str(raw_time).replace("Z", "+00:00"))
                except (TypeError, ValueError):
                    continue
                if row_time.tzinfo is None and since.tzinfo is not None:
                    row_time = row_time.replace(tzinfo=since.tzinfo)
                if row_time >= since:
                    filtered.append(row)
            return filtered
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list address activity: {e}") from e

    # --- tg_whale_events ---

    @retry(max_retries=3, base_delay=2.0)
    def append_tg_whale_event(self, event: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_TG_WHALE_EVENTS)
                self._ensure_append_only_schema_once(
                    ws,
                    list(TG_WHALE_EVENTS_HEADERS),
                    tab_name=TAB_TG_WHALE_EVENTS,
                )
                all_values = ws.get_all_values()
                msg_col = TG_WHALE_EVENTS_HEADERS.index("tg_msg_id")
                target = str(event.get("tg_msg_id", ""))
                if len(all_values) > 1:
                    for row in all_values[1:]:
                        if msg_col < len(row) and row[msg_col] == target:
                            logger.debug("Duplicate tg_whale_event skipped: %s", target)
                            return
                event.setdefault("collected_at", now_iso())
                ws.append_row(dict_to_row(event, TG_WHALE_EVENTS_HEADERS), value_input_option="RAW")
                logger.info("Appended tg_whale_event: %s", target)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append tg_whale_event: {e}") from e

    def _ensure_daily_brief_schema(
        self,
        ws: "gspread.Worksheet",
        all_values: list[list[str]],
    ) -> None:
        expected = list(DAILY_BRIEF_HEADERS)
        if not all_values:
            if ws.col_count < len(expected):
                ws.resize(cols=len(expected))
                logger.info("Resized daily_brief worksheet grid to %d cols", len(expected))
            ws.append_row(expected)
            return

        header = all_values[0]
        if header == expected:
            return

        if len(header) > len(expected):
            logger.warning(
                "daily_brief header has unexpected extra columns (%d vs %d), "
                "skipping auto-extension. Manual review required: %s",
                len(header),
                len(expected),
                header,
            )
            return

        if expected[: len(header)] != header:
            logger.warning(
                "daily_brief header layout unexpected, skipping auto-extension: %s",
                header,
            )
            return

        missing = expected[len(header) :]
        if not missing:
            return

        if ws.col_count < len(expected):
            ws.resize(cols=len(expected))
            logger.info("Resized daily_brief worksheet grid to %d cols", len(expected))

        start_col = _column_letter(len(header) + 1)
        end_col = _column_letter(len(expected))
        ws.update(f"{start_col}1:{end_col}1", [missing], value_input_option="RAW")
        logger.info(
            "Extended daily_brief header with columns: %s",
            ",".join(missing),
        )

    # --- news_feed ---

    @retry(max_retries=3, base_delay=2.0)
    def append_news_feed(self, items: list[dict]) -> int:
        """Insert new news_feed rows and refresh last_seen_at for dedup hits.

        Behavior:
            * Pre-existing rows whose hash is seen again get their ``last_seen_at``
              column set to ``now``. This lets the dashboard distinguish
              "pipeline is polling" from "new article arrived".
            * Brand-new rows are appended with both ``fetched_at`` and
              ``last_seen_at`` set to ``now``.
            * If the physical sheet header row is missing ``last_seen_at`` (older
              deployments predating this migration), the header cell is extended
              in place before any writes. Downstream readers key by header
              position, so this self-heals without a separate migration step.

        Returns:
            Count of NEW rows inserted (not including refreshed dedup hits).
        """
        with self._write_lock:
            try:
                if not items:
                    return 0

                ws = self._worksheet(TAB_NEWS_FEED)
                all_values = ws.get_all_values()
                self._ensure_news_feed_schema(ws, all_values)

                hash_col = NEWS_FEED_HEADERS.index("hash")
                last_seen_col = NEWS_FEED_HEADERS.index("last_seen_at")
                existing: dict[str, int] = {}
                # Row index in sheet = data row index + 2 (1 for header, 1 for 1-based).
                for offset, row in enumerate(all_values[1:]):
                    if hash_col < len(row) and row[hash_col]:
                        existing[row[hash_col]] = offset + 2

                now = now_iso()
                new_rows: list[list[str]] = []
                refresh_rows: list[int] = []

                for item in items:
                    entry = dict(item)
                    title = str(entry.get("title", "")).strip()
                    if not title:
                        continue

                    url = str(entry.get("url", "")).strip()
                    source = str(entry.get("source", "")).strip()
                    published_at = str(entry.get("published_at", "")).strip()
                    digest = str(entry.get("hash", "")).strip()
                    if not digest:
                        digest = hashlib.sha256(
                            f"{source}|{url}|{title}|{published_at}".encode("utf-8")
                        ).hexdigest()

                    if digest in existing:
                        refresh_rows.append(existing[digest])
                        continue

                    entry.setdefault("id", digest[:16])
                    entry["hash"] = digest
                    entry.setdefault("summary", "")
                    entry.setdefault("language", "en")
                    entry.setdefault("tags", "")
                    entry.setdefault("fetched_at", now)
                    entry["last_seen_at"] = now
                    new_rows.append(dict_to_row(entry, NEWS_FEED_HEADERS))
                    # reserve the slot so duplicate hashes within this batch dedup
                    existing[digest] = -1

                if refresh_rows:
                    last_seen_letter = _column_letter(last_seen_col + 1)
                    # One batch request instead of N cell updates.
                    update_payload = [
                        {
                            "range": f"{last_seen_letter}{row_idx}",
                            "values": [[now]],
                        }
                        for row_idx in sorted(set(refresh_rows))
                    ]
                    ws.batch_update(update_payload, value_input_option="RAW")
                    logger.info(
                        "Refreshed last_seen_at on %d existing news_feed rows",
                        len(update_payload),
                    )

                if new_rows:
                    ws.append_rows(new_rows, value_input_option="RAW")
                logger.info("Appended %d news_feed rows", len(new_rows))
                return len(new_rows)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append news_feed: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_news_feed(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        """최근 뉴스 피드 행 반환. since 기준 published_at 필터 적용."""
        try:
            ws = self._worksheet(TAB_NEWS_FEED)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []

            headers = all_values[0] if all_values else NEWS_FEED_HEADERS
            # 실제 시트 헤더가 NEWS_FEED_HEADERS와 다를 수 있으므로 실제 헤더 사용
            rows = [row_to_dict(row, headers) for row in all_values[1:]]
            if since is not None:
                filtered: list[dict] = []
                for row in rows:
                    raw = str(row.get("published_at") or row.get("fetched_at") or "").strip()
                    if not raw:
                        continue
                    try:
                        row_time = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    if row_time.tzinfo is None and since.tzinfo is not None:
                        row_time = row_time.replace(tzinfo=since.tzinfo)
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered

            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list news_feed: {e}") from e

    def _ensure_news_feed_schema(
        self,
        ws: "gspread.Worksheet",
        all_values: list[list[str]],
    ) -> None:
        """Add missing tail columns (e.g. last_seen_at) to an existing sheet.

        Only appends — never reorders or removes columns. Safe to call every run.
        """
        expected = list(NEWS_FEED_HEADERS)
        if not all_values:
            if ws.col_count < len(expected):
                ws.resize(cols=len(expected))
                logger.info("Resized news_feed worksheet grid to %d cols", len(expected))
            ws.append_row(expected)
            return

        header = all_values[0]
        if header == expected:
            return

        if len(header) > len(expected):
            logger.warning(
                "news_feed header has unexpected extra columns (%d vs %d), "
                "skipping auto-extension. Manual review required: %s",
                len(header),
                len(expected),
                header,
            )
            return

        # Only extend if the existing header is a PREFIX of expected. Anything
        # else (reordered / renamed columns) means manual review is needed.
        if expected[: len(header)] != header:
            logger.warning(
                "news_feed header layout unexpected, skipping auto-extension: %s",
                header,
            )
            return

        missing = expected[len(header) :]
        if not missing:
            return

        if ws.col_count < len(expected):
            ws.resize(cols=len(expected))
            logger.info("Resized news_feed worksheet grid to %d cols", len(expected))

        start_col = _column_letter(len(header) + 1)
        end_col = _column_letter(len(expected))
        cell_range = f"{start_col}1:{end_col}1"
        ws.update(cell_range, [missing], value_input_option="RAW")
        logger.info(
            "Extended news_feed header with columns: %s",
            ",".join(missing),
        )

    @retry(max_retries=3, base_delay=2.0)
    def list_tg_whale_events(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict[str, object]]:
        """Return TG whale events newer than ``since``, optionally capped.

        Args:
            since: Lower bound (inclusive) on event time. ``None`` returns all rows.
            limit: Row-count cap applied AFTER the since filter.

                * ``None`` (default): no cap -- return every matching row.
                * ``0``:              return an empty list explicitly.
                * ``> 0``:            return the last ``limit`` matching rows (tail slice).

        Returns:
            List of dict rows. Empty list when no data or sheet is missing.
        """
        try:
            ws = self._worksheet(TAB_TG_WHALE_EVENTS)
            self._ensure_append_only_schema_once(
                ws,
                list(TG_WHALE_EVENTS_HEADERS),
                tab_name=TAB_TG_WHALE_EVENTS,
            )
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []

            rows: list[dict[str, object]] = [
                row_to_dict(row, TG_WHALE_EVENTS_HEADERS) for row in all_values[1:]
            ]
            if since is not None:
                filtered: list[dict[str, object]] = []
                for row in rows:
                    row_time = _normalize_event_time(row)
                    if row_time is None:
                        continue
                    if row_time.tzinfo is None and since.tzinfo is not None:
                        row_time = row_time.replace(tzinfo=since.tzinfo)
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered

            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list tg whale events: {e}") from e

    # --- signals ---

    @retry(max_retries=3, base_delay=2.0)
    def append_signal(self, signal: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_SIGNALS)
                all_values = ws.get_all_values()
                id_col = SIGNALS_HEADERS.index("signal_id")
                target = str(signal.get("signal_id", ""))
                if len(all_values) > 1:
                    for row in all_values[1:]:
                        if id_col < len(row) and row[id_col] == target:
                            logger.debug("Duplicate signal skipped: %s", target)
                            return
                signal.setdefault("created_at", now_iso())
                if "extra_json" in signal and not isinstance(signal["extra_json"], str):
                    signal["extra_json"] = json.dumps(signal["extra_json"], ensure_ascii=False)
                elif "extra_json" not in signal and "extra" in signal:
                    signal["extra_json"] = json.dumps(signal.pop("extra"), ensure_ascii=False)
                ws.append_row(dict_to_row(signal, SIGNALS_HEADERS), value_input_option="RAW")
                logger.info("Appended signal: %s", target)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append signal: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_signals(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        try:
            ws = self._worksheet(TAB_SIGNALS)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []

            rows = [row_to_dict(row, SIGNALS_HEADERS) for row in all_values[1:]]
            if since is not None:
                filtered: list[dict] = []
                for row in rows:
                    row_time = _parse_row_time(row.get("created_at") or row.get("window_end", ""))
                    if row_time is None:
                        continue
                    if row_time.tzinfo is None and since.tzinfo is not None:
                        row_time = row_time.replace(tzinfo=since.tzinfo)
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered

            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list signals: {e}") from e

    # --- weekly_trend ---

    @retry(max_retries=3, base_delay=2.0)
    def save_weekly_trend(self, rows: list[dict]) -> None:
        try:
            if not rows:
                return
            week_start = str(rows[0].get("week_start", ""))
            ws = self._worksheet(TAB_WEEKLY_TREND)
            all_values = ws.get_all_values()
            ws_col = WEEKLY_TREND_HEADERS.index("week_start")
            keep_rows = [WEEKLY_TREND_HEADERS]
            if len(all_values) > 1:
                keep_rows += [
                    row for row in all_values[1:]
                    if not (ws_col < len(row) and row[ws_col] == week_start)
                ]
            for r in rows:
                r.setdefault("created_at", now_iso())
                keep_rows.append(dict_to_row(r, WEEKLY_TREND_HEADERS))
            ws.clear()
            ws.update("A1", keep_rows, value_input_option="RAW")
            logger.info("Saved %d weekly_trend rows for week_start=%s", len(rows), week_start)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to save weekly trend: {e}") from e

    # --- analysis_log (alias for protocol compatibility) ---

    def save_analysis_log(self, entry: dict) -> None:
        self.save_analysis(entry)

    # --- user_interests ---

    @retry(max_retries=3, base_delay=2.0)
    def upsert_user_interest(
        self,
        chat_id: int,
        dimension: str,
        value: str,
        weight: float,
        source: str,
    ) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_USER_INTERESTS)
                all_values = ws.get_all_values()
                cid_col = USER_INTERESTS_HEADERS.index("chat_id")
                dim_col = USER_INTERESTS_HEADERS.index("dimension")
                val_col = USER_INTERESTS_HEADERS.index("value")
                target_cid = str(chat_id)
                for i, row in enumerate(all_values[1:], start=2):
                    if (
                        cid_col < len(row) and row[cid_col] == target_cid
                        and dim_col < len(row) and row[dim_col] == dimension
                        and val_col < len(row) and row[val_col] == value
                    ):
                        entry = row_to_dict(row, USER_INTERESTS_HEADERS)
                        entry["weight"] = str(weight)
                        entry["source"] = source
                        entry["updated_at"] = now_iso()
                        self._write_row(ws, i, entry, USER_INTERESTS_HEADERS)
                        logger.info("Updated user interest chat_id=%d dim=%s val=%s", chat_id, dimension, value)
                        return
                entry = {
                    "chat_id": chat_id,
                    "dimension": dimension,
                    "value": value,
                    "weight": weight,
                    "source": source,
                    "updated_at": now_iso(),
                }
                ws.append_row(dict_to_row(entry, USER_INTERESTS_HEADERS), value_input_option="RAW")
                logger.info("Added user interest chat_id=%d dim=%s val=%s", chat_id, dimension, value)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to upsert user interest: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_user_interests(self, user_id: str | None = None) -> list[dict]:
        try:
            ws = self._worksheet(TAB_USER_INTERESTS)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            rows = [row_to_dict(row, USER_INTERESTS_HEADERS) for row in all_values[1:]]
            if user_id is None:
                return rows
            target = str(user_id)
            return [r for r in rows if r.get("chat_id", "") == target]
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list user interests: {e}") from e

    # --- whale_stories ---

    @retry(max_retries=3, base_delay=2.0)
    def append_whale_story(self, story: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_WHALE_STORIES)
                all_values = ws.get_all_values()
                id_col = WHALE_STORIES_HEADERS.index("id")
                signal_col = WHALE_STORIES_HEADERS.index("signal_id")
                target_id = str(story.get("id", ""))
                target_signal = str(story.get("signal_id", ""))
                if len(all_values) > 1:
                    for row in all_values[1:]:
                        if (
                            id_col < len(row) and row[id_col] == target_id
                        ) or (
                            signal_col < len(row) and target_signal and row[signal_col] == target_signal
                        ):
                            logger.debug("Duplicate whale_story skipped: %s", target_id or target_signal)
                            return
                story.setdefault("published_at", now_iso())
                ws.append_row(dict_to_row(story, WHALE_STORIES_HEADERS), value_input_option="RAW")
                logger.info("Appended whale story: %s", target_id or target_signal)
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append whale story: {e}") from e

    # --- llm_budget_log ---

    @retry(max_retries=3, base_delay=2.0)
    def append_llm_budget_log(self, entry: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_LLM_BUDGET_LOG)
                normalized = {
                    "ts": entry.get("ts", now_iso()),
                    "month_key": str(entry.get("month_key", "")),
                    "pipeline": str(entry.get("pipeline", "")),
                    "model_id": str(entry.get("model_id", "")),
                    "tokens_in": entry.get("tokens_in", 0),
                    "tokens_out": entry.get("tokens_out", 0),
                    "cost_usd": entry.get("cost_usd", 0.0),
                    "cumulative_cost_usd": entry.get("cumulative_cost_usd", 0.0),
                    "decision": str(entry.get("decision", "")),
                }
                ws.append_row(
                    dict_to_row(normalized, LLM_BUDGET_LOG_HEADERS),
                    value_input_option="RAW",
                )
                logger.info(
                    "Appended llm_budget_log pipeline=%s decision=%s cumulative=%s",
                    normalized["pipeline"],
                    normalized["decision"],
                    normalized["cumulative_cost_usd"],
                )
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append llm budget log: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def append_brief_cost_ledger(self, entry: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_BRIEF_COST_LEDGER)
                self._ensure_append_only_schema_once(
                    ws,
                    BRIEF_COST_LEDGER_HEADERS,
                    tab_name=TAB_BRIEF_COST_LEDGER,
                )
                normalized = {
                    "ts": entry.get("ts", now_iso()),
                    "slot_key": str(entry.get("slot_key", "")),
                    "decision": str(entry.get("decision", "")),
                    "llm_called": self._bool_str(entry.get("llm_called")),
                    "model_id": str(entry.get("model_id", "")),
                    "tokens_in": self._int_value(entry.get("tokens_in")),
                    "tokens_out": self._int_value(entry.get("tokens_out")),
                    "cost_usd": self._float_value(entry.get("cost_usd")),
                    "cumulative_cost_usd": self._float_value(entry.get("cumulative_cost_usd")),
                    "signal_count": self._int_value(entry.get("signal_count")),
                    "transaction_count": self._int_value(entry.get("transaction_count")),
                    "input_fingerprint": str(entry.get("input_fingerprint", "")),
                    "reason": str(entry.get("reason", ""))[:2000],
                }
                ws.append_row(
                    dict_to_row(normalized, BRIEF_COST_LEDGER_HEADERS),
                    value_input_option="RAW",
                )
                logger.info(
                    "Appended brief_cost_ledger decision=%s slot=%s llm_called=%s",
                    normalized["decision"],
                    normalized["slot_key"],
                    normalized["llm_called"],
                )
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append brief cost ledger: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_brief_cost_ledger(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        try:
            ws = self._worksheet(TAB_BRIEF_COST_LEDGER)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            rows = [row_to_dict(row, BRIEF_COST_LEDGER_HEADERS) for row in all_values[1:]]
            if since is not None:
                filtered: list[dict] = []
                for row in rows:
                    row_time = _parse_row_time(row.get("ts", ""))
                    if row_time is None:
                        continue
                    if row_time.tzinfo is None and since.tzinfo is not None:
                        row_time = row_time.replace(tzinfo=since.tzinfo)
                    if row_time >= since:
                        filtered.append(row)
                rows = filtered
            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list brief cost ledger: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def list_llm_budget_log(
        self,
        month_key: str | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        try:
            ws = self._worksheet(TAB_LLM_BUDGET_LOG)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            rows = [row_to_dict(row, LLM_BUDGET_LOG_HEADERS) for row in all_values[1:]]
            if month_key:
                rows = [row for row in rows if row.get("month_key", "") == month_key]
            if limit is not None and limit >= 0:
                rows = rows[-limit:] if limit else []
            return rows
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to list llm budget log: {e}") from e

    # --- channel_health ---

    @retry(max_retries=3, base_delay=2.0)
    def append_channel_health(self, entry: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_CHANNEL_HEALTH)
                normalized = {
                    "ts": entry.get("ts", now_iso()),
                    "chat_id": str(entry.get("chat_id", "")),
                    "title": str(entry.get("title", "")),
                    "username": str(entry.get("username", "")),
                    "member_count": str(entry.get("member_count", "")),
                    "status": str(entry.get("status", "")),
                    "error": str(entry.get("error", ""))[:1000],
                }
                ws.append_row(
                    dict_to_row(normalized, CHANNEL_HEALTH_HEADERS),
                    value_input_option="RAW",
                )
                logger.info(
                    "Appended channel health status=%s chat=%s",
                    normalized["status"],
                    normalized["chat_id"],
                )
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append channel health: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def append_service_health(self, entry: dict) -> None:
        with self._write_lock:
            try:
                ws = self._worksheet(TAB_SERVICE_HEALTH)
                self._ensure_append_only_schema_once(
                    ws,
                    SERVICE_HEALTH_HEADERS,
                    tab_name=TAB_SERVICE_HEALTH,
                )
                normalized = {
                    "ts": entry.get("ts", now_iso()),
                    "service": str(entry.get("service", "")),
                    "component": str(entry.get("component", "")),
                    "status": str(entry.get("status", "")),
                    "heartbeat_key": str(entry.get("heartbeat_key", "")),
                    "details": str(entry.get("details", ""))[:4000],
                    "error": str(entry.get("error", ""))[:1000],
                    "instance_id": str(entry.get("instance_id", "")),
                    "job_name": str(entry.get("job_name", "")),
                    "last_success_at": str(entry.get("last_success_at", "")),
                    "last_failure_at": str(entry.get("last_failure_at", "")),
                    "processed_count": (
                        entry.get("processed_count", "")
                        if entry.get("processed_count") not in (None, "")
                        else ""
                    ),
                    "lag_seconds": (
                        entry.get("lag_seconds", "")
                        if entry.get("lag_seconds") not in (None, "")
                        else ""
                    ),
                    "duration_ms": (
                        entry.get("duration_ms", "")
                        if entry.get("duration_ms") not in (None, "")
                        else ""
                    ),
                    "source_name": str(entry.get("source_name", "")),
                    "supported_chains": str(entry.get("supported_chains", ""))[:1000],
                    "unsupported_chain_count": (
                        entry.get("unsupported_chain_count", "")
                        if entry.get("unsupported_chain_count") not in (None, "")
                        else ""
                    ),
                    "unsupported_chain_names": str(
                        entry.get("unsupported_chain_names", "")
                    )[:2000],
                    "per_chain_event_count": str(entry.get("per_chain_event_count", ""))[:2000],
                }
                ws.append_row(
                    dict_to_row(normalized, SERVICE_HEALTH_HEADERS),
                    value_input_option="RAW",
                )
                logger.info(
                    "Appended service health service=%s status=%s key=%s job=%s",
                    normalized["service"],
                    normalized["status"],
                    normalized["heartbeat_key"],
                    normalized["job_name"],
                )
            except gspread.exceptions.APIError as e:
                raise StorageError(f"Failed to append service health: {e}") from e

    # --- internal helpers ---

    def _write_row(
        self, ws: gspread.Worksheet, row_idx: int, entry: dict, headers: list[str]
    ) -> None:
        row_data = dict_to_row(entry, headers)
        last_col = chr(ord("A") + len(headers) - 1)
        ws.update(f"A{row_idx}:{last_col}{row_idx}", [row_data], value_input_option="RAW")

    def _build_system_log_entry(self, level: str, category: str, payload: dict) -> dict:
        payload = payload or {}
        schema_keys = set(SYSTEM_LOG_HEADERS)
        if schema_keys.intersection(payload.keys()):
            entry = {key: payload.get(key, "") for key in SYSTEM_LOG_HEADERS}
            if not entry.get("run_type"):
                entry["run_type"] = category
            if not entry.get("status"):
                entry["status"] = level
            if not entry.get("run_id"):
                entry["run_id"] = f"{category}:{level}:{now_iso()}"
            if not entry.get("started_at"):
                entry["started_at"] = now_iso()
            if not entry.get("details"):
                entry["details"] = json.dumps(
                    {"level": level, "category": category, "payload": payload},
                    ensure_ascii=False,
                    sort_keys=True,
                    default=str,
                )
            return entry

        return {
            "run_id": f"{category}:{level}:{now_iso()}",
            "run_type": category,
            "status": level,
            "started_at": now_iso(),
            "finished_at": "",
            "transactions_count": "",
            "errors": "",
            "details": json.dumps(
                {"level": level, "category": category, "payload": payload},
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            ),
        }

    def _ensure_append_only_header_schema(
        self,
        ws: "gspread.Worksheet",
        all_values: list[list[str]],
        expected_headers: list[str],
        *,
        tab_name: str,
    ) -> None:
        expected = list(expected_headers)
        if not all_values:
            self._resize_cols_if_needed(ws, len(expected))
            ws.append_row(expected)
            return

        header = all_values[0]
        if header == expected:
            return
        if len(header) > len(expected):
            logger.warning(
                "%s header has unexpected extra columns (%d vs %d), skipping auto-extension",
                tab_name,
                len(header),
                len(expected),
            )
            return
        if expected[: len(header)] != header:
            logger.warning(
                "%s header layout unexpected, skipping auto-extension: %s",
                tab_name,
                header,
            )
            return

        missing = expected[len(header) :]
        if not missing:
            return
        self._resize_cols_if_needed(ws, len(expected))
        start_col = _column_letter(len(header) + 1)
        end_col = _column_letter(len(expected))
        ws.update(f"{start_col}1:{end_col}1", [missing], value_input_option="RAW")
        logger.info("%s header extended with columns: %s", tab_name, ",".join(missing))

    def _resize_cols_if_needed(self, ws: "gspread.Worksheet", expected_cols: int) -> None:
        current_cols = self._int_value(getattr(ws, "col_count", 0))
        if current_cols < expected_cols:
            ws.resize(cols=expected_cols)

    def _int_value(self, value: object, *, default: int = 0) -> int:
        try:
            return int(value if value not in (None, "") else default)
        except (TypeError, ValueError):
            return default

    def _float_value(self, value: object, *, default: float = 0.0) -> float:
        try:
            return float(value if value not in (None, "") else default)
        except (TypeError, ValueError):
            return default

    def _bool_str(self, value: object) -> str:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes"}:
                return "true"
            if normalized in {"false", "0", "no"}:
                return "false"
        return "true" if bool(value) else "false"
