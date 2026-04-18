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
    ) -> None:
        self.signal_rows = list(signal_rows or [])
        self.transaction_rows = list(transaction_rows or [])
        self.budget_rows = list(budget_rows or [])
        self.saved_briefs: list[tuple[str, list[dict]]] = []
        self.run_logs: list[dict] = []
        self.analysis_logs: list[dict] = []
        self.service_health: list[dict] = []

    def list_llm_budget_log(self, month_key: str | None = None, limit: int | None = None) -> list[dict]:
        rows = self.budget_rows
        if month_key is not None:
            rows = [row for row in rows if row.get("month_key") == month_key]
        if limit is not None and limit >= 0:
            rows = rows[-limit:] if limit else []
        return rows

    def append_llm_budget_log(self, entry: dict) -> None:
        self.budget_rows.append(dict(entry))

    def list_signals(self, since, limit=None) -> list[dict]:
        return list(self.signal_rows)

    def list_transactions(self, since, limit=None) -> list[dict]:
        return list(self.transaction_rows)

    def save_daily_brief(self, date: str, briefs: list[dict]) -> None:
        self.saved_briefs.append((date, briefs))

    def log_run(self, run_data: dict) -> None:
        self.run_logs.append(dict(run_data))

    def save_analysis_log(self, entry: dict) -> None:
        self.analysis_logs.append(dict(entry))

    def append_service_health(self, entry: dict) -> None:
        self.service_health.append(dict(entry))


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
) -> dict:
    now = datetime.now(timezone.utc)
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


def _signal_row() -> dict:
    now = datetime.now(timezone.utc)
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
    assert "||meta:" in brief["note"]
    assert "최근 60분 온체인 대형 이동" in brief["summary"]
    note_meta = json.loads(brief["note"].split("||meta:", 1)[1])
    assert note_meta["market_mood"]["mood"] in {"risk_off", "risk_on", "watch", "neutral"}
    top_transactions = json.loads(brief["top_transactions"])
    assert len(top_transactions) == 2
    assert top_transactions[0]["symbol"] == "USDT"
    assert top_transactions[0]["amount_usd"] == 400000000.0
    assert top_transactions[1]["amount_usd"] == 10000000.0


def test_run_brief_pipeline_writes_informative_empty_fallback_when_transactions_are_empty():
    from src.pipeline.brief import run_brief_pipeline

    sheets = _FakeSheets(transaction_rows=[])
    with patch("src.pipeline.brief.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.brief.build_sheets_client", return_value=sheets
    ):
        result = run_brief_pipeline()

    assert result["status"] == "completed_empty"
    assert "mode=fallback_empty" in result["details"]
    brief = sheets.saved_briefs[0][1][0]
    assert "최근 60분 기준 대형 온체인 이동이 확인되지 않았습니다" in brief["summary"]
    assert json.loads(brief["top_transactions"]) == []
    assert "fallback_empty" in brief["note"]
    note_meta = json.loads(brief["note"].split("||meta:", 1)[1])
    assert note_meta["market_mood"]["mood"] == "neutral"


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
    ), patch("src.pipeline.brief.build_router_from_env", return_value=router):
        result = run_brief_pipeline()

    assert result["status"] == "completed"
    assert "model=gemini/gemini-2.5-flash" in result["details"]
    assert sheets.saved_briefs[0][1][0]["summary"] == "LLM generated brief"
    assert "||meta:" in sheets.saved_briefs[0][1][0]["note"]
    assert sheets.analysis_logs
    current_month = month_key_for(datetime.now(timezone.utc))
    assert sheets.budget_rows[-1]["month_key"] == current_month
