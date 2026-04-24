from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable

from src.storage.postgres_schema import iter_schema_statements
from src.storage.queries import now_iso
from src.storage.schema import (
    ADDRESS_ACTIVITY_HEADERS,
    ANALYSIS_LOG_HEADERS,
    BRIEF_COST_LEDGER_HEADERS,
    BROADCAST_LOG_HEADERS,
    CHANNEL_HEALTH_HEADERS,
    CURATED_WALLET_BALANCES_HEADERS,
    CURATED_WALLETS_HEADERS,
    DAILY_BRIEF_HEADERS,
    LLM_BUDGET_LOG_HEADERS,
    NEWS_FEED_HEADERS,
    SERVICE_HEALTH_HEADERS,
    SIGNALS_HEADERS,
    SUBSCRIBERS_HEADERS,
    SYSTEM_LOG_HEADERS,
    TG_WHALE_EVENTS_HEADERS,
    TRANSACTIONS_HEADERS,
    USER_INTERESTS_HEADERS,
    WATCHED_ADDRESSES_HEADERS,
    WHALE_STORIES_HEADERS,
)
from src.utils.errors import StorageError

try:  # psycopg is optional at import time so unit tests can run without a DB.
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - exercised when dependency is absent.
    psycopg = None
    dict_row = None

ConnectFunc = Callable[..., Any]

INSERT_TRANSACTION_SQL = """
    INSERT INTO transactions (
      raw_response_hash, hash, timestamp, blockchain, symbol, amount, amount_usd,
      from_address, from_owner_type, from_owner, to_address, to_owner_type,
      to_owner, created_at
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()))
    ON CONFLICT (raw_response_hash) DO NOTHING
    RETURNING id
"""

INSERT_ADDRESS_ACTIVITY_SQL = """
    INSERT INTO address_activity (
      tx_hash, chain, block_time, watched_address, direction, counterparty,
      counterparty_category, token, amount_token, amount_usd, collected_at
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()))
    ON CONFLICT (tx_hash, watched_address, direction) DO NOTHING
    RETURNING id
"""

INSERT_SYSTEM_LOG_SQL = """
    INSERT INTO system_log (
      run_id, run_type, status, started_at, finished_at, transactions_count,
      errors, details
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
"""

INSERT_SERVICE_HEALTH_SQL = """
    INSERT INTO service_health (
      ts, service, component, status, heartbeat_key, details, error, instance_id,
      job_name, last_success_at, last_failure_at, processed_count, lag_seconds,
      duration_ms, source_name, supported_chains, unsupported_chain_count,
      unsupported_chain_names, per_chain_event_count
    )
    VALUES (
      COALESCE(%s, now()), %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s,
      %s, %s, %s, %s, %s, %s, %s, %s
    )
"""

INSERT_TG_WHALE_EVENT_SQL = """
    INSERT INTO tg_whale_events (
      tg_msg_id, tg_date, blockchain, symbol, amount, amount_usd,
      from_owner_type, from_owner, to_owner_type, to_owner, raw_text,
      parsed_confidence, external_channel, external_display_name,
      external_confidence, collected_at
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()))
    ON CONFLICT (tg_msg_id) DO NOTHING
"""

INSERT_SIGNAL_SQL = """
    INSERT INTO signals (
      signal_id, created_at, rule, severity, score, confidence, source,
      evidence_tx_hashes, window_start, window_end, summary, extra_json
    )
    VALUES (
      %s, COALESCE(%s, now()), %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb
    )
    ON CONFLICT (signal_id) DO NOTHING
"""

INSERT_DAILY_BRIEF_SQL = """
    INSERT INTO daily_brief (
      date, summary, top_transactions, total_volume_usd, alert_count, created_at,
      highlights, signal_themes, note, input_fingerprint
    )
    VALUES (%s, %s, %s::jsonb, %s, %s, COALESCE(%s, now()), %s, %s::jsonb, %s, %s)
"""

INSERT_BROADCAST_LOG_SQL = """
    INSERT INTO broadcast_log (
      ts, kind, dedup_key, chat_id, message_id, status, error, message_length,
      content_hash, signal_count, transaction_count, slot_key, delivery_mode
    )
    VALUES (COALESCE(%s, now()), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

INSERT_BRIEF_COST_LEDGER_SQL = """
    INSERT INTO brief_cost_ledger (
      ts, slot_key, decision, llm_called, model_id, tokens_in, tokens_out,
      cost_usd, cumulative_cost_usd, signal_count, transaction_count,
      input_fingerprint, reason
    )
    VALUES (COALESCE(%s, now()), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

INSERT_LLM_BUDGET_LOG_SQL = """
    INSERT INTO llm_budget_log (
      ts, month_key, pipeline, model_id, tokens_in, tokens_out, cost_usd,
      cumulative_cost_usd, decision
    )
    VALUES (COALESCE(%s, now()), %s, %s, %s, %s, %s, %s, %s, %s)
"""

INSERT_CHANNEL_HEALTH_SQL = """
    INSERT INTO channel_health (
      ts, chat_id, title, username, member_count, status, error
    )
    VALUES (COALESCE(%s, now()), %s, %s, %s, %s, %s, %s)
"""

INSERT_NEWS_FEED_SQL = """
    INSERT INTO news_feed (
      id, source, title, summary, url, published_at, language, tags,
      fetched_at, hash, last_seen_at
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()), %s, COALESCE(%s, now()))
    ON CONFLICT (hash) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
    RETURNING id
"""

INSERT_CURATED_WALLET_BALANCE_SQL = """
    INSERT INTO curated_wallet_balances (
      wallet_id, chain, address, owner_label, owner_category, approx_balance,
      source_ref, source_url, note, is_active, updated_at
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()))
    ON CONFLICT (wallet_id) DO UPDATE SET
      chain = EXCLUDED.chain,
      address = EXCLUDED.address,
      owner_label = EXCLUDED.owner_label,
      owner_category = EXCLUDED.owner_category,
      approx_balance = EXCLUDED.approx_balance,
      source_ref = EXCLUDED.source_ref,
      source_url = EXCLUDED.source_url,
      note = EXCLUDED.note,
      is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at
"""

INSERT_ANALYSIS_LOG_SQL = """
    INSERT INTO analysis_log (
      prompt_hash, task, prompt_version, prompt, response, model, model_id,
      tokens_used, tokens_in, tokens_out, cost_usd, latency_ms, status, created_at
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()))
    ON CONFLICT (prompt_hash) DO UPDATE SET
      response = EXCLUDED.response,
      model = EXCLUDED.model,
      model_id = EXCLUDED.model_id,
      tokens_used = EXCLUDED.tokens_used,
      tokens_in = EXCLUDED.tokens_in,
      tokens_out = EXCLUDED.tokens_out,
      cost_usd = EXCLUDED.cost_usd,
      latency_ms = EXCLUDED.latency_ms,
      status = EXCLUDED.status,
      created_at = EXCLUDED.created_at
"""

INSERT_WHALE_STORY_SQL = """
    INSERT INTO whale_stories (
      id, signal_id, wallet_id, title, body_ko, body_en, impact_score,
      published_at, source_signal_ts
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, COALESCE(%s, now()), %s)
    ON CONFLICT (id) DO NOTHING
"""

UPSERT_USER_INTEREST_SQL = """
    INSERT INTO user_interests (chat_id, dimension, value, weight, source, updated_at)
    VALUES (%s, %s, %s, %s, %s, now())
    ON CONFLICT (chat_id, dimension, value) DO UPDATE SET
      weight = EXCLUDED.weight,
      source = EXCLUDED.source,
      updated_at = EXCLUDED.updated_at
"""

UPSERT_SUBSCRIBER_SQL = """
    INSERT INTO subscribers (
      chat_id, username, status, watchlist_coins, created_at, updated_at,
      last_brief_at, status_changed_at, language
    )
    VALUES (%s, %s, 'active', '', now(), now(), NULL, now(), '')
    ON CONFLICT (chat_id) DO UPDATE SET
      username = COALESCE(NULLIF(EXCLUDED.username, ''), subscribers.username),
      status = CASE
        WHEN subscribers.status IN ('blocked', 'deactivated') THEN 'active'
        ELSE subscribers.status
      END,
      updated_at = now(),
      status_changed_at = CASE
        WHEN subscribers.status IN ('blocked', 'deactivated') THEN now()
        ELSE subscribers.status_changed_at
      END
"""


def _none_if_blank(value: object) -> object | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _text(value: object, *, max_length: int | None = None) -> str:
    text = "" if value is None else str(value)
    if max_length is not None:
        return text[:max_length]
    return text


def _timestamp(value: object) -> object | None:
    value = _none_if_blank(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    if isinstance(value, (int, float)):
        numeric = float(value)
    else:
        raw = str(value).strip()
        if not raw:
            return None
        try:
            numeric = float(raw)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
            except ValueError:
                return raw

    if numeric > 10_000_000_000:
        numeric = numeric / 1000
    try:
        return datetime.fromtimestamp(numeric, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return str(value)


def _numeric(value: object) -> object | None:
    return _none_if_blank(value)


def _int(value: object) -> int | None:
    value = _none_if_blank(value)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bool(value: object) -> bool | None:
    value = _none_if_blank(value)
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _json_param(value: object) -> str | None:
    value = _none_if_blank(value)
    if value is None:
        return None
    if isinstance(value, str):
        raw = value.strip()
        try:
            json.loads(raw)
            return raw
        except json.JSONDecodeError:
            return json.dumps(raw, ensure_ascii=False)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _format_value(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return value


def _format_rows(rows: list[dict[str, object]], headers: list[str]) -> list[dict]:
    return [
        {header: _format_value(row.get(header)) for header in headers}
        for row in rows
    ]


def _build_system_log_entry(level: str, category: str, payload: dict | None) -> dict:
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
            entry["details"] = {
                "level": level,
                "category": category,
                "payload": payload,
            }
        return entry
    return {
        "run_id": f"{category}:{level}:{now_iso()}",
        "run_type": category,
        "status": level,
        "started_at": now_iso(),
        "finished_at": "",
        "transactions_count": "",
        "errors": "",
        "details": {"level": level, "category": category, "payload": payload},
    }


class PostgresClient:
    """Postgres-backed implementation of the Phase 1 storage surface."""

    def __init__(
        self,
        database_url: str | None = None,
        *,
        connect_func: ConnectFunc | None = None,
    ) -> None:
        self.database_url = (database_url or os.getenv("DATABASE_URL", "")).strip()
        if not self.database_url:
            raise StorageError("DATABASE_URL is required for PostgresClient")
        self._connect_func = connect_func

    def _connect(self):
        connect_func = self._connect_func
        kwargs: dict[str, object] = {}
        if connect_func is None:
            if psycopg is None:
                raise StorageError(
                    "psycopg is not installed; install requirements.txt before using PostgresClient"
                )
            connect_func = psycopg.connect
            if dict_row is not None:
                kwargs["row_factory"] = dict_row
        try:
            return connect_func(self.database_url, **kwargs)
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to connect to Postgres using DATABASE_URL: {exc}") from exc

    def init_schema(self) -> int:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for statement in iter_schema_statements():
                        cur.execute(statement)
            return len(iter_schema_statements())
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to initialize Postgres schema: {exc}") from exc

    def append_transactions(self, rows: list[dict]) -> int:
        inserted = 0
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for row in rows:
                        cur.execute(
                            INSERT_TRANSACTION_SQL,
                            (
                                _none_if_blank(row.get("raw_response_hash")),
                                _text(row.get("hash")),
                                _timestamp(row.get("timestamp")),
                                _text(row.get("blockchain")),
                                _text(row.get("symbol")),
                                _numeric(row.get("amount")),
                                _numeric(row.get("amount_usd")),
                                _text(row.get("from_address")),
                                _text(row.get("from_owner_type")),
                                _text(row.get("from_owner")),
                                _text(row.get("to_address")),
                                _text(row.get("to_owner_type")),
                                _text(row.get("to_owner")),
                                _timestamp(row.get("created_at")),
                            ),
                        )
                        if cur.fetchone() is not None:
                            inserted += 1
            return inserted
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append transactions: {exc}") from exc

    def append_address_activity(self, events: list[dict]) -> int:
        inserted = 0
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for event in events:
                        cur.execute(
                            INSERT_ADDRESS_ACTIVITY_SQL,
                            (
                                _text(event.get("tx_hash")),
                                _text(event.get("chain")),
                                _timestamp(event.get("block_time")),
                                _text(event.get("watched_address")),
                                _text(event.get("direction")),
                                _text(event.get("counterparty")),
                                _text(event.get("counterparty_category")),
                                _text(event.get("token")),
                                _numeric(event.get("amount_token")),
                                _numeric(event.get("amount_usd")),
                                _timestamp(event.get("collected_at")),
                            ),
                        )
                        if cur.fetchone() is not None:
                            inserted += 1
            return inserted
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append address activity: {exc}") from exc

    def log_run(self, row: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(INSERT_SYSTEM_LOG_SQL, self._system_log_params(row))
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to log run: {exc}") from exc

    def append_system_log(self, level: str, category: str, payload: dict) -> None:
        self.log_run(_build_system_log_entry(level, category, payload))

    def append_service_health(self, entry: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_SERVICE_HEALTH_SQL,
                        (
                            _timestamp(entry.get("ts")),
                            _text(entry.get("service")),
                            _text(entry.get("component")),
                            _text(entry.get("status")),
                            _text(entry.get("heartbeat_key")),
                            _json_param(entry.get("details")),
                            _text(entry.get("error"), max_length=1000),
                            _text(entry.get("instance_id")),
                            _text(entry.get("job_name")),
                            _timestamp(entry.get("last_success_at")),
                            _timestamp(entry.get("last_failure_at")),
                            _int(entry.get("processed_count")),
                            _int(entry.get("lag_seconds")),
                            _int(entry.get("duration_ms")),
                            _text(entry.get("source_name")),
                            _text(entry.get("supported_chains"), max_length=1000),
                            _int(entry.get("unsupported_chain_count")),
                            _text(entry.get("unsupported_chain_names"), max_length=2000),
                            _text(entry.get("per_chain_event_count"), max_length=2000),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append service health: {exc}") from exc

    def list_transactions(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        if limit == 0:
            return []
        rows = self._select_rows(
            "transactions",
            TRANSACTIONS_HEADERS,
            time_expr="COALESCE(created_at, timestamp)",
            since=since,
            limit=limit,
        )
        return _format_rows(rows, TRANSACTIONS_HEADERS)

    def append_tg_whale_event(self, event: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_TG_WHALE_EVENT_SQL,
                        (
                            _none_if_blank(event.get("tg_msg_id")),
                            _timestamp(event.get("tg_date")),
                            _text(event.get("blockchain")),
                            _text(event.get("symbol")),
                            _numeric(event.get("amount")),
                            _numeric(event.get("amount_usd")),
                            _text(event.get("from_owner_type")),
                            _text(event.get("from_owner")),
                            _text(event.get("to_owner_type")),
                            _text(event.get("to_owner")),
                            _text(event.get("raw_text")),
                            _numeric(event.get("parsed_confidence")),
                            _text(event.get("external_channel")),
                            _text(event.get("external_display_name")),
                            _numeric(event.get("external_confidence")),
                            _timestamp(event.get("collected_at")),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append tg whale event: {exc}") from exc

    def list_tg_whale_events(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict[str, object]]:
        if limit == 0:
            return []
        rows = self._select_rows(
            "tg_whale_events",
            TG_WHALE_EVENTS_HEADERS,
            time_expr="COALESCE(tg_date, collected_at)",
            since=since,
            limit=limit,
        )
        return _format_rows(rows, TG_WHALE_EVENTS_HEADERS)

    def append_signal(self, signal: dict) -> None:
        normalized = dict(signal)
        if "extra_json" not in normalized and "extra" in normalized:
            normalized["extra_json"] = normalized.pop("extra")
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_SIGNAL_SQL,
                        (
                            _none_if_blank(normalized.get("signal_id")),
                            _timestamp(normalized.get("created_at")),
                            _text(normalized.get("rule")),
                            _text(normalized.get("severity")),
                            _numeric(normalized.get("score")),
                            _text(normalized.get("confidence")),
                            _text(normalized.get("source")),
                            _json_param(normalized.get("evidence_tx_hashes")),
                            _timestamp(normalized.get("window_start")),
                            _timestamp(normalized.get("window_end")),
                            _text(normalized.get("summary")),
                            _json_param(normalized.get("extra_json")),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append signal: {exc}") from exc

    def list_signals(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        if limit == 0:
            return []
        rows = self._select_rows(
            "signals",
            SIGNALS_HEADERS,
            time_expr="COALESCE(created_at, window_end)",
            since=since,
            limit=limit,
        )
        return _format_rows(rows, SIGNALS_HEADERS)

    def save_daily_brief(
        self,
        date: str | dict,
        briefs: list[dict] | None = None,
    ) -> None:
        if isinstance(date, dict) and briefs is None:
            rows = [date]
        else:
            rows = []
            for brief in briefs or []:
                row = dict(brief)
                row["date"] = str(date)
                rows.append(row)

        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for row in rows:
                        normalized = dict(row)
                        if "signal_themes" not in normalized and "signalThemes" in normalized:
                            normalized["signal_themes"] = normalized.pop("signalThemes")
                        if "input_fingerprint" not in normalized and "inputFingerprint" in normalized:
                            normalized["input_fingerprint"] = normalized.pop("inputFingerprint")
                        cur.execute(
                            INSERT_DAILY_BRIEF_SQL,
                            (
                                _text(normalized.get("date")),
                                _text(normalized.get("summary")),
                                _json_param(normalized.get("top_transactions")),
                                _numeric(normalized.get("total_volume_usd")),
                                _int(normalized.get("alert_count")),
                                _timestamp(normalized.get("created_at")),
                                _text(normalized.get("highlights")),
                                _json_param(normalized.get("signal_themes")),
                                _text(normalized.get("note")),
                                _text(normalized.get("input_fingerprint")),
                            ),
                        )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to save daily brief: {exc}") from exc

    def get_latest_daily_brief(self) -> dict | None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT date, summary, top_transactions, total_volume_usd,
                               alert_count, created_at, highlights, signal_themes,
                               note, input_fingerprint
                        FROM daily_brief
                        ORDER BY created_at DESC, id DESC
                        LIMIT 1
                        """,
                    )
                    row = cur.fetchone()
            if row is None:
                return None
            return _format_rows([row], DAILY_BRIEF_HEADERS)[0]
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to get latest daily brief: {exc}") from exc

    def append_broadcast_log(self, entry: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_BROADCAST_LOG_SQL,
                        (
                            _timestamp(entry.get("ts")),
                            _text(entry.get("kind")),
                            _text(entry.get("dedup_key")),
                            _text(entry.get("chat_id")),
                            _text(entry.get("message_id")),
                            _text(entry.get("status")),
                            _text(entry.get("error"), max_length=1000),
                            _int(entry.get("message_length")),
                            _text(entry.get("content_hash")),
                            _int(entry.get("signal_count")),
                            _int(entry.get("transaction_count")),
                            _text(entry.get("slot_key")),
                            _text(entry.get("delivery_mode")),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append broadcast log: {exc}") from exc

    def list_broadcast_log(
        self,
        *,
        kind: str | None = None,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        if limit == 0:
            return []
        filters = []
        params: list[object] = []
        if kind:
            filters.append("kind = %s")
            params.append(kind)
        rows = self._select_rows(
            "broadcast_log",
            BROADCAST_LOG_HEADERS,
            time_expr="ts",
            since=since,
            limit=limit,
            filters=filters,
            params=params,
        )
        return _format_rows(rows, BROADCAST_LOG_HEADERS)

    def append_brief_cost_ledger(self, entry: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_BRIEF_COST_LEDGER_SQL,
                        (
                            _timestamp(entry.get("ts")),
                            _text(entry.get("slot_key")),
                            _text(entry.get("decision")),
                            _bool(entry.get("llm_called")),
                            _text(entry.get("model_id")),
                            _int(entry.get("tokens_in")),
                            _int(entry.get("tokens_out")),
                            _numeric(entry.get("cost_usd")),
                            _numeric(entry.get("cumulative_cost_usd")),
                            _int(entry.get("signal_count")),
                            _int(entry.get("transaction_count")),
                            _text(entry.get("input_fingerprint")),
                            _text(entry.get("reason"), max_length=2000),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append brief cost ledger: {exc}") from exc

    def list_brief_cost_ledger(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        if limit == 0:
            return []
        rows = self._select_rows(
            "brief_cost_ledger",
            BRIEF_COST_LEDGER_HEADERS,
            time_expr="ts",
            since=since,
            limit=limit,
        )
        return _format_rows(rows, BRIEF_COST_LEDGER_HEADERS)

    def append_llm_budget_log(self, entry: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_LLM_BUDGET_LOG_SQL,
                        (
                            _timestamp(entry.get("ts")),
                            _text(entry.get("month_key")),
                            _text(entry.get("pipeline")),
                            _text(entry.get("model_id")),
                            _int(entry.get("tokens_in")),
                            _int(entry.get("tokens_out")),
                            _numeric(entry.get("cost_usd")),
                            _numeric(entry.get("cumulative_cost_usd")),
                            _text(entry.get("decision")),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append llm budget log: {exc}") from exc

    def list_llm_budget_log(
        self,
        month_key: str | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        if limit == 0:
            return []
        filters = []
        params: list[object] = []
        if month_key:
            filters.append("month_key = %s")
            params.append(month_key)
        rows = self._select_rows(
            "llm_budget_log",
            LLM_BUDGET_LOG_HEADERS,
            time_expr="ts",
            limit=limit,
            filters=filters,
            params=params,
        )
        return _format_rows(rows, LLM_BUDGET_LOG_HEADERS)

    def append_channel_health(self, entry: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_CHANNEL_HEALTH_SQL,
                        (
                            _timestamp(entry.get("ts")),
                            _text(entry.get("chat_id")),
                            _text(entry.get("title")),
                            _text(entry.get("username")),
                            _int(entry.get("member_count")),
                            _text(entry.get("status")),
                            _text(entry.get("error"), max_length=1000),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append channel health: {exc}") from exc

    def has_logged_run_in_window(
        self,
        *,
        run_type: str,
        window_start: datetime,
        window_end: datetime,
        statuses: set[str] | list[str] | tuple[str, ...],
    ) -> bool:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT 1
                        FROM system_log
                        WHERE run_type = %s
                          AND started_at >= %s
                          AND started_at < %s
                          AND status = ANY(%s)
                        LIMIT 1
                        """,
                        (run_type, window_start, window_end, list(statuses)),
                    )
                    return cur.fetchone() is not None
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to check logged run window: {exc}") from exc

    def list_watched_addresses(self) -> dict[str, dict]:
        rows = self._select_rows(
            "watched_addresses",
            WATCHED_ADDRESSES_HEADERS,
            time_expr="COALESCE(added_at, now())",
        )
        formatted = _format_rows(rows, WATCHED_ADDRESSES_HEADERS)
        return {
            str(row.get("address", "")).lower(): row
            for row in formatted
            if str(row.get("address", "")).strip()
            and str(row.get("enabled", "true")).strip().lower() not in {"false", "0", "no"}
        }

    def list_curated_wallets(self, active_only: bool = True) -> list[dict]:
        filters: list[str] = []
        params: list[object] = []
        if active_only:
            filters.append("COALESCE(is_active, 'true') NOT IN ('false', '0', 'no')")
        rows = self._select_rows(
            "curated_wallets",
            CURATED_WALLETS_HEADERS,
            time_expr="COALESCE(updated_at, created_at, now())",
            filters=filters,
            params=params,
        )
        return _format_rows(rows, CURATED_WALLETS_HEADERS)

    def upsert_curated_wallet_balances(self, balances: list[dict]) -> dict[str, int]:
        counts = {"inserted": 0, "updated": 0, "invalid": 0}
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for balance in balances:
                        wallet_id = str(balance.get("wallet_id", "")).strip()
                        if not wallet_id:
                            counts["invalid"] += 1
                            continue
                        cur.execute(
                            INSERT_CURATED_WALLET_BALANCE_SQL,
                            (
                                wallet_id,
                                _text(balance.get("chain")),
                                _text(balance.get("address")),
                                _text(balance.get("owner_label")),
                                _text(balance.get("owner_category")),
                                _numeric(balance.get("approx_balance")),
                                _text(balance.get("source_ref")),
                                _text(balance.get("source_url")),
                                _text(balance.get("note")),
                                _text(balance.get("is_active")),
                                _timestamp(balance.get("updated_at")),
                            ),
                        )
                        counts["updated"] += 1
            return counts
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to upsert curated wallet balances: {exc}") from exc

    def append_news_feed(self, items: list[dict]) -> int:
        inserted = 0
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    for item in items:
                        digest = str(item.get("hash", "")).strip()
                        if not digest:
                            continue
                        cur.execute(
                            INSERT_NEWS_FEED_SQL,
                            (
                                str(item.get("id") or digest[:16]),
                                _text(item.get("source")),
                                _text(item.get("title")),
                                _text(item.get("summary")),
                                _text(item.get("url")),
                                _timestamp(item.get("published_at")),
                                _text(item.get("language")),
                                _text(item.get("tags")),
                                _timestamp(item.get("fetched_at")),
                                digest,
                                _timestamp(item.get("last_seen_at")),
                            ),
                        )
                        if cur.fetchone() is not None:
                            inserted += 1
            return inserted
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append news feed: {exc}") from exc

    def list_news_feed(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        if limit == 0:
            return []
        rows = self._select_rows(
            "news_feed",
            NEWS_FEED_HEADERS,
            time_expr="COALESCE(published_at, fetched_at, last_seen_at)",
            since=since,
            limit=limit,
        )
        return _format_rows(rows, NEWS_FEED_HEADERS)

    def find_daily_brief_by_fingerprint(self, fingerprint: str) -> dict | None:
        if not fingerprint:
            return None
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT date, summary, top_transactions, total_volume_usd,
                               alert_count, created_at, highlights, signal_themes,
                               note, input_fingerprint
                        FROM daily_brief
                        WHERE input_fingerprint = %s
                        ORDER BY created_at DESC, id DESC
                        LIMIT 1
                        """,
                        (fingerprint,),
                    )
                    row = cur.fetchone()
            if row is None:
                return None
            return _format_rows([row], DAILY_BRIEF_HEADERS)[0]
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to find daily brief by fingerprint: {exc}") from exc

    def save_analysis_log(self, entry: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_ANALYSIS_LOG_SQL,
                        (
                            _text(entry.get("prompt_hash")),
                            _text(entry.get("task")),
                            _text(entry.get("prompt_version")),
                            _text(entry.get("prompt")),
                            _text(entry.get("response")),
                            _text(entry.get("model")),
                            _text(entry.get("model_id")),
                            _int(entry.get("tokens_used")),
                            _int(entry.get("tokens_in")),
                            _int(entry.get("tokens_out")),
                            _numeric(entry.get("cost_usd")),
                            _int(entry.get("latency_ms")),
                            _text(entry.get("status")),
                            _timestamp(entry.get("created_at")),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to save analysis log: {exc}") from exc

    def save_analysis(self, log_entry: dict) -> None:
        self.save_analysis_log(log_entry)

    def get_cached_analysis(self, prompt_hash: str) -> dict | None:
        if not prompt_hash:
            return None
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT prompt_hash, task, prompt_version, prompt, response,
                               model, model_id, tokens_used, tokens_in, tokens_out,
                               cost_usd, latency_ms, status, created_at
                        FROM analysis_log
                        WHERE prompt_hash = %s AND status = 'success'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (prompt_hash,),
                    )
                    row = cur.fetchone()
            if row is None:
                return None
            return _format_rows([row], ANALYSIS_LOG_HEADERS)[0]
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to get cached analysis: {exc}") from exc

    def append_whale_story(self, story: dict) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        INSERT_WHALE_STORY_SQL,
                        (
                            _text(story.get("id")),
                            _text(story.get("signal_id")),
                            _text(story.get("wallet_id")),
                            _text(story.get("title")),
                            _text(story.get("body_ko")),
                            _text(story.get("body_en")),
                            _numeric(story.get("impact_score")),
                            _timestamp(story.get("published_at")),
                            _timestamp(story.get("source_signal_ts")),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to append whale story: {exc}") from exc

    def add_subscriber(self, chat_id: int, username: str | None = None) -> bool:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(UPSERT_SUBSCRIBER_SQL, (str(chat_id), _text(username)))
            return True
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to add subscriber: {exc}") from exc

    def list_subscribers(self, statuses: list[str] | None = None) -> list[dict]:
        filters: list[str] = []
        params: list[object] = []
        if statuses:
            filters.append("status = ANY(%s)")
            params.append(list(statuses))
        rows = self._select_rows(
            "subscribers",
            SUBSCRIBERS_HEADERS,
            time_expr="COALESCE(updated_at, created_at)",
            filters=filters,
            params=params,
        )
        return _format_rows(rows, SUBSCRIBERS_HEADERS)

    def get_active_subscribers(self) -> list[dict]:
        return self.list_subscribers(statuses=["active"])

    def get_subscriber_info(self, chat_id: int) -> dict | None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT chat_id, username, status, watchlist_coins, created_at,
                               updated_at, last_brief_at, status_changed_at
                        FROM subscribers
                        WHERE chat_id = %s
                        LIMIT 1
                        """,
                        (str(chat_id),),
                    )
                    row = cur.fetchone()
            if row is None:
                return None
            return _format_rows([row], SUBSCRIBERS_HEADERS)[0]
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to get subscriber info: {exc}") from exc

    def get_watchlist(self, chat_id: int) -> list[str]:
        info = self.get_subscriber_info(chat_id)
        raw = str((info or {}).get("watchlist_coins", ""))
        return [coin.strip().upper() for coin in raw.split(",") if coin.strip()]

    def set_watchlist(self, chat_id: int, coins: list[str]) -> None:
        watchlist = ",".join(coin.strip().upper() for coin in coins if coin.strip())
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO subscribers (
                          chat_id, username, status, watchlist_coins, created_at,
                          updated_at, status_changed_at
                        )
                        VALUES (%s, '', 'active', %s, now(), now(), now())
                        ON CONFLICT (chat_id) DO UPDATE SET
                          watchlist_coins = EXCLUDED.watchlist_coins,
                          updated_at = now()
                        """,
                        (str(chat_id), watchlist),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to set watchlist: {exc}") from exc

    def set_status(self, chat_id: int, status: str) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO subscribers (
                          chat_id, username, status, watchlist_coins, created_at,
                          updated_at, status_changed_at
                        )
                        VALUES (%s, '', %s, '', now(), now(), now())
                        ON CONFLICT (chat_id) DO UPDATE SET
                          status = EXCLUDED.status,
                          updated_at = now(),
                          status_changed_at = now()
                        """,
                        (str(chat_id), _text(status)),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to set subscriber status: {exc}") from exc

    def update_subscriber_language(self, chat_id: int, language: str) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO subscribers (
                          chat_id, username, status, watchlist_coins, created_at,
                          updated_at, status_changed_at, language
                        )
                        VALUES (%s, '', 'active', '', now(), now(), now(), %s)
                        ON CONFLICT (chat_id) DO UPDATE SET
                          language = EXCLUDED.language,
                          updated_at = now()
                        """,
                        (str(chat_id), _text(language)),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to update subscriber language: {exc}") from exc

    def upsert_user_interest(
        self,
        chat_id: int,
        dimension: str,
        value: str,
        weight: float,
        source: str,
    ) -> None:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        UPSERT_USER_INTEREST_SQL,
                        (
                            str(chat_id),
                            _text(dimension),
                            _text(value),
                            _numeric(weight),
                            _text(source),
                        ),
                    )
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to upsert user interest: {exc}") from exc

    def list_user_interests(self, user_id: str | None = None) -> list[dict]:
        filters: list[str] = []
        params: list[object] = []
        if user_id is not None:
            filters.append("chat_id = %s")
            params.append(str(user_id))
        rows = self._select_rows(
            "user_interests",
            USER_INTERESTS_HEADERS,
            time_expr="updated_at",
            filters=filters,
            params=params,
        )
        return _format_rows(rows, USER_INTERESTS_HEADERS)

    def _system_log_params(self, row: dict) -> tuple[object, ...]:
        return (
            _text(row.get("run_id")),
            _text(row.get("run_type")),
            _text(row.get("status")),
            _timestamp(row.get("started_at")),
            _timestamp(row.get("finished_at")),
            _int(row.get("transactions_count")),
            _text(row.get("errors")),
            _json_param(row.get("details")),
        )

    def _select_rows(
        self,
        table: str,
        headers: list[str],
        *,
        time_expr: str,
        since: datetime | None = None,
        limit: int | None = None,
        filters: list[str] | None = None,
        params: list[object] | None = None,
    ) -> list[dict[str, object]]:
        where = list(filters or [])
        query_params = list(params or [])
        if since is not None:
            where.append(f"{time_expr} >= %s")
            query_params.append(since)

        columns = ", ".join(headers)
        where_clause = f" WHERE {' AND '.join(where)}" if where else ""
        if limit is not None and limit > 0:
            sql = (
                f"SELECT {columns} FROM {table}{where_clause} "
                f"ORDER BY {time_expr} DESC, id DESC LIMIT %s"
            )
            query_params.append(limit)
            reverse = True
        else:
            sql = f"SELECT {columns} FROM {table}{where_clause} ORDER BY {time_expr} ASC, id ASC"
            reverse = False

        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql, tuple(query_params))
                    rows = list(cur.fetchall())
            if reverse:
                rows.reverse()
            return rows
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError(f"Failed to list rows from {table}: {exc}") from exc


def initialize_schema(
    database_url: str | None = None,
    *,
    connect_func: ConnectFunc | None = None,
) -> int:
    return PostgresClient(database_url=database_url, connect_func=connect_func).init_schema()
