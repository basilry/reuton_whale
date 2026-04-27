from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.enrich.price_resolver import PriceQuote
from src.llm.base import LLMResult
from src.router.budget import month_key_for


class _FakeSheets:
    def __init__(
        self,
        *,
        signal_rows: list[dict] | None = None,
        transaction_rows: list[dict] | None = None,
        budget_rows: list[dict] | None = None,
        cached_briefs: list[dict] | None = None,
        news_rows: list[dict] | None = None,
        curated_wallet_rows: list[dict] | None = None,
    ) -> None:
        self.signal_rows = list(signal_rows or [])
        self.transaction_rows = list(transaction_rows or [])
        self.budget_rows = list(budget_rows or [])
        self.cached_briefs = list(cached_briefs or [])
        self.news_rows = list(news_rows or [])
        self.curated_wallet_rows = list(curated_wallet_rows or [])
        self.saved_briefs: list[tuple[str, list[dict]]] = []
        self.run_logs: list[dict] = []
        self.analysis_logs: list[dict] = []
        self.service_health: list[dict] = []
        self.brief_cost_ledger_rows: list[dict] = []

    def list_llm_budget_log(self, month_key: str | None = None, limit: int | None = None) -> list[dict]:
        rows = self.budget_rows
        if month_key is not None:
            rows = [row for row in rows if row.get("month_key") == month_key]
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def append_llm_budget_log(self, entry: dict) -> None:
        self.budget_rows.append(dict(entry))

    def append_brief_cost_ledger(self, entry: dict) -> None:
        self.brief_cost_ledger_rows.append(dict(entry))

    def list_brief_cost_ledger(
        self,
        since: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        rows = list(self.brief_cost_ledger_rows)
        if since is not None:
            filtered: list[dict] = []
            for row in rows:
                created_at = datetime.fromisoformat(str(row.get("ts")).replace("Z", "+00:00"))
                if created_at >= since:
                    filtered.append(row)
            rows = filtered
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def list_signals(self, since, limit=None) -> list[dict]:
        rows = list(self.signal_rows)
        if since is not None:
            filtered: list[dict] = []
            for row in rows:
                created_at = datetime.fromisoformat(str(row.get("created_at")).replace("Z", "+00:00"))
                if created_at >= since:
                    filtered.append(row)
            rows = filtered
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def list_transactions(self, since, limit=None) -> list[dict]:
        rows = list(self.transaction_rows)
        if since is not None:
            filtered: list[dict] = []
            for row in rows:
                created_at = datetime.fromisoformat(
                    str(row.get("created_at") or row.get("timestamp")).replace("Z", "+00:00")
                )
                if created_at >= since:
                    filtered.append(row)
            rows = filtered
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def save_daily_brief(self, date: str, briefs: list[dict]) -> None:
        self.saved_briefs.append((date, briefs))
        for brief in briefs:
            self.cached_briefs.append(
                {
                    "date": date,
                    **dict(brief),
                }
            )

    def log_run(self, run_data: dict) -> None:
        self.run_logs.append(dict(run_data))

    def save_analysis_log(self, entry: dict) -> None:
        self.analysis_logs.append(dict(entry))

    def append_service_health(self, entry: dict) -> None:
        self.service_health.append(dict(entry))

    def find_daily_brief_by_fingerprint(self, fingerprint: str) -> dict | None:
        target = str(fingerprint or "").strip()
        for row in reversed(self.cached_briefs):
            if str(row.get("input_fingerprint", "")).strip() == target:
                return dict(row)
        return None

    def list_news_feed(self, since=None, limit=None) -> list[dict]:
        rows = list(self.news_rows)
        if since is not None:
            filtered: list[dict] = []
            for row in rows:
                raw = str(row.get("published_at") or row.get("fetched_at") or "")
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
            rows = rows[:limit] if limit else []
        return rows

    def list_curated_wallets(self, active_only: bool = True) -> list[dict]:
        rows = list(self.curated_wallet_rows)
        if active_only:
            return [r for r in rows if str(r.get("is_active", "true")).strip().lower() not in {"false", "0", "no"}]
        return rows


def _fake_env() -> SimpleNamespace:
    return SimpleNamespace(
        sheet_id="sheet",
        google_credentials="{}",
        anthropic_api_key="",
        gemini_api_key="",
        groq_api_key="",
    )


def _recent_tx_row(
    *,
    symbol: str,
    amount: str,
    amount_usd: str = "",
    hash_value: str = "",
    from_owner: str = "unknown",
    from_owner_type: str = "wallet",
    to_owner: str = "Binance",
    to_owner_type: str = "exchange",
    created_at: datetime | None = None,
) -> dict:
    now = created_at or datetime.now(timezone.utc)
    return {
        "hash": hash_value or f"{symbol.lower()}-hash",
        "raw_response_hash": hash_value or f"{symbol.lower()}-raw",
        "timestamp": now.isoformat(),
        "created_at": now.isoformat(),
        "blockchain": "ETH",
        "symbol": symbol,
        "amount": amount,
        "amount_usd": amount_usd,
        "from_owner": from_owner,
        "from_owner_type": from_owner_type,
        "to_owner": to_owner,
        "to_owner_type": to_owner_type,
    }


def _signal_row(*, created_at: datetime | None = None) -> dict:
    now = created_at or datetime.now(timezone.utc)
    return {
        "signal_id": "sig-1",
        "created_at": now.isoformat(),
        "rule": "cex_inflow_spike",
        "severity": "high",
        "score": "9.1",
        "confidence": "high",
        "source": "chain",
        "evidence_tx_hashes": json.dumps(["0xabc"]),
        "window_start": (now - timedelta(minutes=15)).isoformat(),
        "window_end": now.isoformat(),
        "summary": "거래소 유입 급증",
        "extra_json": json.dumps(
            {
                "asset": "USDT",
                "amount_usd": 539_000_000,
                "chain": "ETH",
            }
        ),
    }


def _render_log_messages(mock_logger) -> list[str]:
    messages: list[str] = []
    for call in mock_logger.info.call_args_list:
        message = call.args[0]
        if len(call.args) > 1:
            message = message % call.args[1:]
        messages.append(message)
    return messages


def test_run_brief_pipeline_uses_transaction_fallback_when_signals_are_empty():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        transaction_rows=[
            _recent_tx_row(symbol="USDT", amount="400000000", amount_usd="", hash_value="0xusdt"),
            _recent_tx_row(
                symbol="ETH",
                amount="5000",
                amount_usd="",
                hash_value="0xeth",
                from_owner="Coinbase",
                from_owner_type="exchange",
                to_owner="cold_wallet",
                to_owner_type="wallet",
            ),
        ]
    )
    router_builder = MagicMock()

    def _resolve(symbol: str, *, at=None):
        if symbol == "ETH":
            return PriceQuote(
                symbol="ETH",
                price_usd=2000.0,
                source="binance",
                fetched_at=at or datetime.now(timezone.utc),
            )
        return PriceQuote(
            symbol=symbol,
            price_usd=1.0,
            source="stablecoin_proxy",
            fetched_at=at or datetime.now(timezone.utc),
        )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", router_builder), patch(
        "src.pipeline.brief.PriceResolver.resolve",
        side_effect=_resolve,
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    assert "mode=fallback_tx" in result["details"]
    assert router_builder.called is False
    assert sheets.saved_briefs
    brief = sheets.saved_briefs[0][1][0]
    assert brief["alert_count"] == 0
    assert "fallback_tx_based" in brief["note"]
    heartbeat = sheets.service_health[-1]
    assert heartbeat["job_name"] == "brief"
    assert heartbeat["processed_count"] == 2
    assert heartbeat["last_success_at"]
    assert "||meta:" in brief["note"]
    assert "최근 60분 온체인 대형 이동" in brief["summary"]
    note_meta = json.loads(brief["note"].split("||meta:", 1)[1])
    assert note_meta["market_mood"]["mood"] in {"risk_off", "risk_on", "watch", "neutral"}
    top_transactions = json.loads(brief["top_transactions"])
    assert len(top_transactions) == 2
    assert top_transactions[0]["symbol"] == "USDT"
    assert top_transactions[0]["amount_usd"] == 400000000.0
    assert top_transactions[1]["amount_usd"] == 10000000.0
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "transaction_fallback"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "false"
    assert sheets.brief_cost_ledger_rows[-1]["transaction_count"] == 2


def test_run_brief_pipeline_unpriced_fallback_uses_quantity_wording_and_json_ready_items():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        transaction_rows=[
            _recent_tx_row(
                symbol="TRIA",
                amount="210,592",
                amount_usd="",
                hash_value="0xtria",
                from_owner="wallet_a",
                from_owner_type="wallet",
                to_owner="wallet_b",
                to_owner_type="wallet",
            )
        ]
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.PriceResolver.resolve", return_value=None):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    brief = sheets.saved_briefs[0][1][0]
    assert "가격 미확인 거래 fallback" in brief["summary"]
    assert "가격 품질: USD 환산 0건 / 미확인 1건" in brief["summary"]
    assert "TRIA 210,592 TRIA 수량" in brief["summary"]
    assert "210,592건" not in brief["summary"]

    assert brief["highlights"] == ["TRIA · 210,592 TRIA · 지갑 간 이동"]
    assert json.loads(json.dumps(brief["highlights"], ensure_ascii=False)) == brief["highlights"]

    top_transactions = json.loads(brief["top_transactions"])
    assert top_transactions[0]["amount_token"] == 210592.0
    assert top_transactions[0]["amount_usd_known"] is False
    assert top_transactions[0]["movement_label"] == "지갑 간 이동"
    assert "wallet_a" in top_transactions[0]["interpretation"]


def test_run_brief_pipeline_skips_when_recent_activity_is_empty():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(transaction_rows=[])
    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ):
        result = run_brief_pipeline()

    assert result["status"] == "skipped_inactive"
    assert "inactive_window=60m" in result["details"]
    assert sheets.saved_briefs == []
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "skipped_inactive"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "false"


def test_run_brief_pipeline_prefers_llm_path_when_signals_exist():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
    )
    router = MagicMock()
    router.call_task.return_value = LLMResult(
        text="LLM generated brief",
        model_id="gemini/gemini-2.5-flash",
        tokens_in=120,
        tokens_out=80,
        cost_usd=0.01,
        latency_ms=320,
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._save_full_brief_log"
    ), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    assert "model=gemini/gemini-2.5-flash" in result["details"]
    assert sheets.saved_briefs[0][1][0]["summary"] == "LLM generated brief"
    assert sheets.saved_briefs[0][1][0]["input_fingerprint"]
    assert "||meta:" in sheets.saved_briefs[0][1][0]["note"]
    assert sheets.analysis_logs
    current_month = month_key_for(datetime.now(timezone.utc))
    assert sheets.budget_rows[-1]["month_key"] == current_month
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "generated"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "true"
    assert sheets.brief_cost_ledger_rows[-1]["model_id"] == "gemini/gemini-2.5-flash"
    heartbeat = sheets.service_health[-1]
    assert heartbeat["job_name"] == "brief"
    assert heartbeat["processed_count"] == 1
    assert heartbeat["source_name"] == "signals+transactions+llm"


def test_run_brief_pipeline_reuses_cached_completion_for_same_fingerprint():
    from src.pipeline.brief import _build_input_fingerprint, run_brief_pipeline

    prompt_version = "v-test"
    user_content = "same-user-content"
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
        cached_briefs=[
            {
                "date": "2026-04-19",
                "summary": "cached brief",
                "input_fingerprint": _build_input_fingerprint(
                    prompt_version=prompt_version,
                    user_content=user_content,
                ),
            }
        ],
    )
    router = MagicMock()

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch(
        "src.pipeline.brief._build_brief_request",
        return_value=("sys", user_content, prompt_version),
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    assert "mode=cached" in result["details"]
    assert router.call_task.called is False
    assert sheets.saved_briefs[-1][1][0]["summary"] == "cached brief"
    assert sheets.saved_briefs[-1][1][0]["input_fingerprint"]
    assert sheets.analysis_logs == []
    assert sheets.budget_rows == []
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "cached"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "false"


def test_run_brief_pipeline_logs_fallback_skip_when_signals_are_empty():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(transaction_rows=[_recent_tx_row(symbol="USDT", amount="100", amount_usd="100")])

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.logger") as mock_logger:
        result = run_brief_pipeline()

    messages = _render_log_messages(mock_logger)
    assert result["status"] == "completed"
    assert any(message.startswith("brief inputs loaded ") for message in messages)
    assert any("brief llm call skipped reason=no_signals fallback_mode=transaction" in message for message in messages)


def test_run_brief_pipeline_logs_llm_attempt_and_success():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
    )
    router = MagicMock()
    router.call_task.return_value = LLMResult(
        text="LLM generated brief",
        model_id="gemini/gemini-2.5-flash",
        tokens_in=120,
        tokens_out=80,
        cost_usd=0.01,
        latency_ms=320,
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._save_full_brief_log"
    ), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ), patch(
        "src.pipeline.brief.logger"
    ) as mock_logger:
        result = run_brief_pipeline()

    messages = _render_log_messages(mock_logger)
    assert result["status"] == "completed"
    assert any(message.startswith("brief signals_json preview=") for message in messages)
    assert any("brief llm call attempted task=daily_brief" in message for message in messages)
    assert any("brief llm call succeeded model=gemini/gemini-2.5-flash" in message for message in messages)


def test_run_brief_pipeline_publishes_completed_update():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")]
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.publish_success_event") as publish_success_event:
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    publish_success_event.assert_called_once_with(
        section="brief",
        pipeline="brief",
        result=result,
    )


def test_run_brief_pipeline_records_budget_skip_in_cost_ledger():
    from src.pipeline.brief import run_brief_pipeline

    current_month = month_key_for(datetime.now(timezone.utc))
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
        budget_rows=[
            {
                "month_key": current_month,
                "cost_usd": 15.0,
                "cumulative_cost_usd": 15.0,
                "decision": "generated",
            }
        ],
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ):
        result = run_brief_pipeline()

    assert result["status"] == "skipped_budget"
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "skipped_budget"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "false"
    assert sheets.brief_cost_ledger_rows[-1]["cumulative_cost_usd"] == 15.0


def test_run_brief_pipeline_records_completed_empty_in_cost_ledger():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="100", amount_usd="100")]
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch(
        "src.pipeline.brief._build_transaction_fallback_brief",
        return_value=(
            None,
            {
                "transactions": 0,
                "priced": 0,
                "unpriced": 0,
                "total_volume_usd": 0.0,
                "price_sources": "",
            },
        ),
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed_empty"
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "completed_empty"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "false"


def test_run_brief_pipeline_records_llm_errors_in_cost_ledger():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
    )
    router = MagicMock()
    router.call_task.side_effect = RuntimeError("llm unavailable")

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed_with_errors"
    assert sheets.brief_cost_ledger_rows[-1]["decision"] == "completed_with_errors"
    assert sheets.brief_cost_ledger_rows[-1]["llm_called"] == "false"
    assert "llm unavailable" in sheets.brief_cost_ledger_rows[-1]["reason"]


# --- 신규: mode 분기 + 컨텍스트 빌더 단위 테스트 ---

def test_is_full_slot_true_for_9_15_21_kst():
    from zoneinfo import ZoneInfo
    from src.pipeline.brief import _is_full_slot

    _KST = ZoneInfo("Asia/Seoul")
    for hour in (9, 15, 21):
        dt = datetime(2026, 4, 19, hour, 5, tzinfo=_KST)
        assert _is_full_slot(dt) is True, f"hour={hour} should be full slot"


def test_is_full_slot_false_for_other_hours():
    from zoneinfo import ZoneInfo
    from src.pipeline.brief import _is_full_slot

    _KST = ZoneInfo("Asia/Seoul")
    for hour in (0, 6, 10, 12, 18, 23):
        dt = datetime(2026, 4, 19, hour, 0, tzinfo=_KST)
        assert _is_full_slot(dt) is False, f"hour={hour} should not be full slot"


def test_build_news_context_formats_correctly():
    from src.pipeline.brief import _build_news_context

    now = datetime.now(timezone.utc)
    rows = [
        {
            "source": "CoinDesk",
            "title": "BTC breaks $100k",
            "summary": "Bitcoin surged past the $100,000 level.",
            "published_at": now.isoformat(),
        },
        {
            "source": "Cointelegraph",
            "title": "ETH staking outflows",
            "summary": "",
            "published_at": (now - timedelta(hours=2)).isoformat(),
        },
    ]
    ctx = _build_news_context(rows, top_n=5)
    assert "BTC breaks $100k" in ctx
    assert "CoinDesk" in ctx
    assert "ETH staking outflows" in ctx
    assert "Cointelegraph" in ctx


def test_build_news_context_empty_returns_marker():
    from src.pipeline.brief import _build_news_context

    ctx = _build_news_context([])
    assert ctx == "(없음)"


def test_build_curated_context_formats_correctly():
    from src.pipeline.brief import _build_curated_context

    rows = [
        {
            "owner_label": "Binance Hot Wallet",
            "owner_category": "exchange",
            "chain": "ETH",
            "tier": "1",
            "approx_balance": "2B",
            "narrative_tags": "cex,hot",
            "is_active": "true",
        },
    ]
    ctx = _build_curated_context(rows)
    assert "Binance Hot Wallet" in ctx
    assert "exchange" in ctx
    assert "tier=1" in ctx


def test_build_curated_context_empty_returns_marker():
    from src.pipeline.brief import _build_curated_context

    ctx = _build_curated_context([])
    assert ctx == "(없음)"


def test_run_brief_pipeline_full_mode_injects_news_and_curated():
    """full 슬롯에서 뉴스+큐레이션 컨텍스트가 로드되고 LLM 호출이 성공하는지 검증."""
    from src.pipeline.brief import run_brief_pipeline

    now = datetime.now(timezone.utc)
    news_row = {
        "source": "CoinDesk",
        "title": "BTC whale accumulation detected",
        "summary": "Large BTC moves spotted.",
        "published_at": now.isoformat(),
        "fetched_at": now.isoformat(),
    }
    curated_row = {
        "owner_label": "Binance Cold Wallet",
        "owner_category": "exchange",
        "chain": "BTC",
        "tier": "1",
        "approx_balance": "500k BTC",
        "narrative_tags": "cex,cold",
        "is_active": "true",
    }
    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
        news_rows=[news_row],
        curated_wallet_rows=[curated_row],
    )
    router = MagicMock()
    router.call_task.return_value = LLMResult(
        text="Full LLM briefing with news context",
        model_id="gemini/gemini-2.5-flash",
        tokens_in=800,
        tokens_out=200,
        cost_usd=0.003,
        latency_ms=500,
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ), patch(
        "src.pipeline.brief._is_full_slot", return_value=True
    ), patch(
        "src.pipeline.brief._save_full_brief_log"
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    assert "brief_mode=full" in result["details"]
    assert "news=1" in result["details"]


def test_run_brief_pipeline_incremental_uses_prior_brief():
    """당일 full 로그가 있고 비-슬롯 시간이면 incremental 모드로 실행."""
    from zoneinfo import ZoneInfo
    from src.pipeline.brief import run_brief_pipeline

    _KST = ZoneInfo("Asia/Seoul")
    # 12:00 KST (비-슬롯)
    kst_12 = datetime(2026, 4, 19, 12, 0, tzinfo=_KST)
    utc_now = kst_12.astimezone(timezone.utc)

    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
    )
    router = MagicMock()
    router.call_task.return_value = LLMResult(
        text="Incremental update: no major changes",
        model_id="gemini/gemini-2.5-flash",
        tokens_in=300,
        tokens_out=80,
        cost_usd=0.001,
        latency_ms=200,
    )

    prior_log = {
        "ts": utc_now.isoformat(),
        "slot_key": "20260419T0000Z",
        "summary": "이전 브리핑 요약입니다.",
    }

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=prior_log
    ), patch(
        "src.pipeline.brief._is_full_slot", return_value=False
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    assert "brief_mode=incremental" in result["details"]
    assert sheets.saved_briefs[0][1][0]["summary"] == "Incremental update: no major changes"


def test_run_brief_pipeline_promotes_incremental_to_full_when_no_prior():
    """당일 full 로그가 없으면 비-슬롯 시간이어도 full로 승격."""
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(
        signal_rows=[_signal_row()],
        transaction_rows=[_recent_tx_row(symbol="USDT", amount="1000000", amount_usd="1000000")],
    )
    router = MagicMock()
    router.call_task.return_value = LLMResult(
        text="Promoted full briefing",
        model_id="gemini/gemini-2.5-flash",
        tokens_in=500,
        tokens_out=150,
        cost_usd=0.002,
        latency_ms=350,
    )

    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router), patch(
        "src.pipeline.brief._load_latest_full_brief_log", return_value=None
    ), patch(
        "src.pipeline.brief._is_full_slot", return_value=False
    ):
        result = run_brief_pipeline()

    # prior=None이면 is_full_slot=False여도 full로 승격
    assert result["status"] == "completed"
    assert "brief_mode=full" in result["details"]


def test_load_prompt_mode_selects_full_prompt(tmp_path):
    """mode='full'이면 daily_brief.full.system.txt를 선택하고 없으면 폴백."""
    from src.analyzer.prompt_loader import load_prompt, _CACHE

    # full 프롬프트 파일 생성
    (tmp_path / "daily_brief.full.system.txt").write_text("FULL SYSTEM", encoding="utf-8")
    (tmp_path / "daily_brief.system.txt").write_text("BASE SYSTEM", encoding="utf-8")

    _CACHE.clear()
    content, _ = load_prompt("daily_brief.system", base_dir=tmp_path, mode="full")
    assert content == "FULL SYSTEM"


def test_load_prompt_mode_fallback_when_no_mode_file(tmp_path):
    """mode 파일이 없으면 기존 파일로 폴백."""
    from src.analyzer.prompt_loader import load_prompt, _CACHE

    (tmp_path / "daily_brief.system.txt").write_text("BASE SYSTEM", encoding="utf-8")

    _CACHE.clear()
    content, _ = load_prompt("daily_brief.system", base_dir=tmp_path, mode="incremental")
    assert content == "BASE SYSTEM"


def test_save_and_load_full_brief_log(tmp_path):
    """full 브리핑 로그를 저장하고 다시 불러오는 기능 검증."""
    from src.pipeline.brief import _save_full_brief_log, _load_latest_full_brief_log, _BRIEF_LOG_DIR

    # tmp_path로 로그 디렉토리 오버라이드
    now = datetime(2026, 4, 19, 9, 0, tzinfo=timezone.utc)  # UTC 09:00 = KST 18:00 -> 비-슬롯이지만 날짜 테스트용
    payload = {
        "summary": "테스트 요약",
        "highlights": ["BTC 이동"],
        "signal_themes": ["cex_inflow_spike"],
        "note": "note_text",
        "input_fingerprint": "abc123",
    }

    with patch("src.pipeline.brief._BRIEF_LOG_DIR", tmp_path):
        _save_full_brief_log(now, payload)
        loaded = _load_latest_full_brief_log(now)

    assert loaded is not None
    assert loaded["summary"] == "테스트 요약"
    assert loaded["input_fingerprint"] == "abc123"


def test_load_full_brief_log_returns_none_when_no_file(tmp_path):
    """로그 파일이 없으면 None 반환."""
    from src.pipeline.brief import _load_latest_full_brief_log

    now = datetime(2026, 4, 19, 9, 0, tzinfo=timezone.utc)

    with patch("src.pipeline.brief._BRIEF_LOG_DIR", tmp_path):
        loaded = _load_latest_full_brief_log(now)

    assert loaded is None
