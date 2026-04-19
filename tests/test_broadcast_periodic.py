from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from src.utils.errors import StorageError


class _FakeSheets:
    def __init__(
        self,
        *,
        signal_rows: list[dict] | None = None,
        transaction_rows: list[dict] | None = None,
        broadcast_rows: list[dict] | None = None,
        duplicate_in_window: bool = False,
        duplicate_error: bool = False,
    ) -> None:
        self.signal_rows = list(signal_rows or [])
        self.transaction_rows = list(transaction_rows or [])
        self.broadcast_rows = list(broadcast_rows or [])
        self.duplicate_in_window = duplicate_in_window
        self.duplicate_error = duplicate_error
        self.run_logs: list[dict] = []
        self.service_health: list[dict] = []

    def has_logged_run_in_window(self, **kwargs) -> bool:
        if self.duplicate_error:
            raise StorageError("quota exceeded")
        return self.duplicate_in_window

    def list_signals(self, since=None, limit=None) -> list[dict]:
        rows = list(self.signal_rows)
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def list_transactions(self, since=None, limit=None) -> list[dict]:
        rows = list(self.transaction_rows)
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def append_broadcast_log(self, entry: dict) -> None:
        self.broadcast_rows.append(dict(entry))

    def list_broadcast_log(
        self,
        *,
        kind: str | None = None,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        rows = list(self.broadcast_rows)
        if kind is not None:
            rows = [row for row in rows if row.get("kind") == kind]
        if since is not None:
            filtered: list[dict] = []
            for row in rows:
                ts = datetime.fromisoformat(str(row.get("ts")).replace("Z", "+00:00"))
                if ts >= since:
                    filtered.append(row)
            rows = filtered
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def log_run(self, entry: dict) -> None:
        self.run_logs.append(dict(entry))

    def append_service_health(self, entry: dict) -> None:
        self.service_health.append(dict(entry))


def _fake_env(*, dry_run: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        telegram_broadcast_token="broadcast-token",
        telegram_token="",
        telegram_broadcast_chat="@channel",
        telegram_broadcast_enabled=True,
        telegram_broadcast_dry_run=dry_run,
        sheet_id="sheet",
        google_credentials="{}",
    )


def _signal_row() -> dict:
    return {
        "signal_id": "sig-1",
        "summary": "대형 유입",
        "severity": "high",
        "rule": "cex_inflow_spike",
        "source": "chain",
    }


def _transaction_row(*, amount_usd: str, symbol: str = "BTC") -> dict:
    return {
        "symbol": symbol,
        "amount": "10",
        "amount_usd": amount_usd,
        "from_owner": "wallet_a",
        "from_owner_type": "wallet",
        "to_owner": "Binance",
        "to_owner_type": "exchange",
    }


def test_run_broadcast_periodic_skips_duplicate_content_within_one_hour():
    from src.pipeline.broadcast_periodic import _clip_periodic_message, _content_hash, run_broadcast_periodic

    fixed_now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_transaction_row(amount_usd="1500000")],
    )

    with patch("src.pipeline.broadcast_periodic.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.broadcast_periodic.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.broadcast_periodic.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)
        preview_message = _clip_periodic_message(
            "<b>WhaleScope Periodic Update</b>\n<i>2026-04-19 10:15 KST · recent 15m</i>\n\n"
            "<b>Signals</b>\n• 대형 유입 (HIGH · cex_inflow_spike · chain)\n\n"
            "<b>Transactions</b>\n• BTC · $1.5M · 거래소 유입 · wallet_a → Binance\n\n"
            "<i>signals=1 | tx=1 | volume=$1.5M</i>"
        )
        sheets.broadcast_rows.append(
            {
                "ts": (fixed_now - timedelta(minutes=30)).isoformat(),
                "kind": "broadcast_periodic",
                "status": "dry_run",
                "delivery_mode": "dry_run",
                "content_hash": _content_hash(preview_message),
            }
        )
        result = run_broadcast_periodic()

    assert result["status"] == "skipped_duplicate_content"
    assert sheets.broadcast_rows[-1]["status"] == "skipped_duplicate_content"
    assert sheets.broadcast_rows[-1]["delivery_mode"] == "skipped"
    assert sheets.broadcast_rows[-1]["signal_count"] == 1
    assert sheets.broadcast_rows[-1]["transaction_count"] == 1


def test_run_broadcast_periodic_persists_rich_broadcast_metadata_for_dry_run():
    from src.pipeline.broadcast_periodic import run_broadcast_periodic

    fixed_now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_transaction_row(amount_usd="1500000")],
    )

    with patch("src.pipeline.broadcast_periodic.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.broadcast_periodic.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.broadcast_periodic.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)
        result = run_broadcast_periodic()

    assert result["status"] == "completed"
    assert sheets.broadcast_rows[-1]["status"] == "dry_run"
    assert sheets.broadcast_rows[-1]["delivery_mode"] == "dry_run"
    assert sheets.broadcast_rows[-1]["message_length"] > 0
    assert sheets.broadcast_rows[-1]["content_hash"]
    assert sheets.broadcast_rows[-1]["slot_key"] == "20260419T1015"
    assert sheets.broadcast_rows[-1]["signal_count"] == 1
    assert sheets.broadcast_rows[-1]["transaction_count"] == 1


def test_run_broadcast_periodic_enforces_1500_character_cap_before_logging():
    from src.pipeline.broadcast_periodic import run_broadcast_periodic

    fixed_now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_transaction_row(amount_usd="1500000")],
    )

    with patch("src.pipeline.broadcast_periodic.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.broadcast_periodic.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.broadcast_periodic._build_periodic_message", return_value="X" * 2000), patch(
        "src.pipeline.broadcast_periodic.datetime"
    ) as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)
        result = run_broadcast_periodic()

    assert result["status"] == "completed"
    assert sheets.broadcast_rows[-1]["message_length"] == 1500


def test_run_broadcast_periodic_logs_skipped_empty_into_broadcast_log():
    from src.pipeline.broadcast_periodic import run_broadcast_periodic

    fixed_now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    sheets = _FakeSheets(signal_rows=[], transaction_rows=[])

    with patch("src.pipeline.broadcast_periodic.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.broadcast_periodic.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.broadcast_periodic.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)
        result = run_broadcast_periodic()

    assert result["status"] == "skipped_empty"
    assert sheets.broadcast_rows[-1]["status"] == "skipped_empty"
    assert sheets.broadcast_rows[-1]["delivery_mode"] == "skipped"
    assert sheets.broadcast_rows[-1]["message_length"] == 0


def test_run_broadcast_periodic_continues_when_duplicate_guard_read_fails():
    from src.pipeline.broadcast_periodic import run_broadcast_periodic

    fixed_now = datetime(2026, 4, 19, 1, 15, tzinfo=timezone.utc)
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_transaction_row(amount_usd="1500000")],
        duplicate_error=True,
    )

    with patch("src.pipeline.broadcast_periodic.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.broadcast_periodic.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.broadcast_periodic.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)
        result = run_broadcast_periodic()

    assert result["status"] == "completed"
    assert sheets.broadcast_rows[-1]["delivery_mode"] == "dry_run"
