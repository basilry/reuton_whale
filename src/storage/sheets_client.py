import json

import gspread
from google.oauth2.service_account import Credentials

from src.storage.queries import dict_to_row, now_iso, row_to_dict
from src.storage.schema import (
    ALL_TABS,
    ANALYSIS_LOG_HEADERS,
    DAILY_BRIEF_HEADERS,
    SUBSCRIBERS_HEADERS,
    SYSTEM_LOG_HEADERS,
    TAB_ANALYSIS_LOG,
    TAB_DAILY_BRIEF,
    TAB_HEADERS,
    TAB_SUBSCRIBERS,
    TAB_SYSTEM_LOG,
    TAB_TRANSACTIONS,
    TRANSACTIONS_HEADERS,
)
from src.utils.errors import StorageError
from src.utils.logger import get_logger
from src.utils.retry import retry

logger = get_logger("sheets_client")

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]


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
    return {
        "chat_id": chat_id,
        "username": row_dict.get("username", ""),
        "status": row_dict.get("status", ""),
        "watchlist": _parse_coins(row_dict.get("watchlist_coins", "")),
        "created_at": row_dict.get("created_at", ""),
        "updated_at": row_dict.get("updated_at", ""),
        "last_brief_at": row_dict.get("last_brief_at", ""),
    }


class SheetsClient:
    def __init__(self, sheet_id: str, credentials_json: str):
        try:
            creds_dict = json.loads(credentials_json)
            creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
            self._gc = gspread.authorize(creds)
            self._spreadsheet = self._gc.open_by_key(sheet_id)
        except Exception as e:
            raise StorageError(f"Failed to initialize SheetsClient: {e}") from e
        self._ensure_worksheets()

    def _ensure_worksheets(self) -> None:
        existing = {ws.title for ws in self._spreadsheet.worksheets()}
        for tab_name in ALL_TABS:
            if tab_name not in existing:
                ws = self._spreadsheet.add_worksheet(
                    title=tab_name, rows=1000, cols=len(TAB_HEADERS[tab_name])
                )
                ws.append_row(TAB_HEADERS[tab_name])
                logger.info("Created worksheet: %s", tab_name)

    def _worksheet(self, tab_name: str) -> gspread.Worksheet:
        return self._spreadsheet.worksheet(tab_name)

    # --- transactions ---

    @retry(max_retries=3, base_delay=2.0)
    def append_transactions(self, transactions: list[dict]) -> int:
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

    # --- daily_brief ---

    @retry(max_retries=3, base_delay=2.0)
    def save_daily_brief(self, date: str, briefs: list[dict]) -> None:
        try:
            ws = self._worksheet(TAB_DAILY_BRIEF)
            rows = []
            for brief in briefs:
                brief["date"] = date
                brief.setdefault("created_at", now_iso())
                rows.append(dict_to_row(brief, DAILY_BRIEF_HEADERS))
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

    # --- subscribers ---

    def _find_subscriber_row(self, all_values: list[list[str]], chat_id: int) -> int | None:
        if len(all_values) <= 1:
            return None
        col = SUBSCRIBERS_HEADERS.index("chat_id")
        target = str(chat_id)
        for i, row in enumerate(all_values[1:], start=2):
            if i - 2 < len(all_values) - 1 and col < len(row) and row[col] == target:
                return i
        return None

    @retry(max_retries=3, base_delay=2.0)
    def get_active_subscribers(self) -> list[dict]:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            if len(all_values) <= 1:
                return []
            status_col = SUBSCRIBERS_HEADERS.index("status")
            return [
                _normalize_subscriber(row_to_dict(row, SUBSCRIBERS_HEADERS))
                for row in all_values[1:]
                if status_col < len(row) and row[status_col].lower() == "active"
            ]
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get subscribers: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def get_subscriber_info(self, chat_id: int) -> dict | None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            row_idx = self._find_subscriber_row(all_values, chat_id)
            if row_idx is None:
                return None
            return _normalize_subscriber(
                row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS)
            )
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get subscriber info: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def add_subscriber(self, chat_id: int, username: str) -> None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            row_idx = self._find_subscriber_row(all_values, chat_id)
            now = now_iso()

            if row_idx is not None:
                existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS)
                entry = {
                    "chat_id": chat_id,
                    "username": username or existing.get("username", ""),
                    "status": "active",
                    "watchlist_coins": existing.get("watchlist_coins", ""),
                    "created_at": existing.get("created_at", "") or now,
                    "updated_at": now,
                    "last_brief_at": existing.get("last_brief_at", ""),
                }
                self._write_subscriber_row(ws, row_idx, entry)
                logger.info("Reactivated subscriber %d", chat_id)
            else:
                entry = {
                    "chat_id": chat_id,
                    "username": username,
                    "status": "active",
                    "watchlist_coins": "",
                    "created_at": now,
                    "updated_at": now,
                    "last_brief_at": "",
                }
                ws.append_row(
                    dict_to_row(entry, SUBSCRIBERS_HEADERS),
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
            entry = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS)
            return _parse_coins(entry.get("watchlist_coins", ""))
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to get watchlist: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def set_watchlist(self, chat_id: int, coins: list[str]) -> None:
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            row_idx = self._find_subscriber_row(all_values, chat_id)
            now = now_iso()
            serialized = _serialize_coins(coins)

            if row_idx is not None:
                existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS)
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
                }
                ws.append_row(
                    dict_to_row(entry, SUBSCRIBERS_HEADERS),
                    value_input_option="RAW",
                )
                logger.info("Created subscriber %d via set_watchlist", chat_id)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to set watchlist: {e}") from e

    @retry(max_retries=3, base_delay=2.0)
    def set_status(self, chat_id: int, status: str) -> None:
        if status not in ("active", "paused"):
            raise StorageError(f"Invalid status: {status}")
        try:
            ws = self._worksheet(TAB_SUBSCRIBERS)
            all_values = ws.get_all_values()
            row_idx = self._find_subscriber_row(all_values, chat_id)
            if row_idx is None:
                raise StorageError(f"Subscriber {chat_id} not found")
            existing = row_to_dict(all_values[row_idx - 1], SUBSCRIBERS_HEADERS)
            entry = {
                **existing,
                "chat_id": chat_id,
                "status": status,
                "updated_at": now_iso(),
            }
            self._write_subscriber_row(ws, row_idx, entry)
            logger.info("Set subscriber %d status=%s", chat_id, status)
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to set status: {e}") from e

    def _write_subscriber_row(
        self, ws: gspread.Worksheet, row_idx: int, entry: dict
    ) -> None:
        row_data = dict_to_row(entry, SUBSCRIBERS_HEADERS)
        last_col = chr(ord("A") + len(SUBSCRIBERS_HEADERS) - 1)
        cell_range = f"A{row_idx}:{last_col}{row_idx}"
        ws.update(cell_range, [row_data], value_input_option="RAW")

    # --- legacy watchlist API (reimplemented on subscribers) ---

    def get_active_watchlists(self) -> list[dict]:
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
        try:
            ws = self._worksheet(TAB_SYSTEM_LOG)
            ws.append_row(
                dict_to_row(run_data, SYSTEM_LOG_HEADERS),
                value_input_option="RAW",
            )
            logger.info("Logged run: %s", run_data.get("run_id", "?"))
        except gspread.exceptions.APIError as e:
            raise StorageError(f"Failed to log run: {e}") from e
