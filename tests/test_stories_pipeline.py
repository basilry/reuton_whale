from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

from src.llm.base import LLMResult


class _FakeSheets:
    def __init__(self) -> None:
        self.budget_rows: list[dict] = []
        self.story_rows: list[dict] = []
        self.run_logs: list[dict] = []
        self.analysis_logs: list[dict] = []
        self.service_health: list[dict] = []

    def list_llm_budget_log(self, month_key: str | None = None, limit: int | None = None) -> list[dict]:
        return list(self.budget_rows)

    def append_llm_budget_log(self, entry: dict) -> None:
        self.budget_rows.append(dict(entry))

    def list_signals(self, since, limit=None) -> list[dict]:
        return [
            {
                "signal_id": "sig-1",
                "rule": "cex_inflow_spike",
                "severity": "high",
                "score": "8.5",
                "source": "chain",
                "summary": "거래소 유입 급증",
                "created_at": "2026-04-19T08:00:00+00:00",
                "window_end": "2026-04-19T08:00:00+00:00",
                "evidence_tx_hashes": json.dumps(["0xabc"]),
                "extra_json": json.dumps({"asset": "BTC", "amount_usd": 120000000}),
            }
        ]

    def list_transactions(self, since, limit=None) -> list[dict]:
        return [
            {
                "hash": "0xabc",
                "from_owner": "unknown",
                "to_owner": "Binance",
                "blockchain": "ETH",
            }
        ]

    def save_analysis_log(self, entry: dict) -> None:
        self.analysis_logs.append(dict(entry))

    def append_whale_story(self, entry: dict) -> None:
        self.story_rows.append(dict(entry))

    def log_run(self, run_data: dict) -> None:
        self.run_logs.append(dict(run_data))

    def append_service_health(self, entry: dict) -> None:
        self.service_health.append(dict(entry))


def _fake_env() -> SimpleNamespace:
    return SimpleNamespace(
        sheet_id="sheet",
        google_credentials="{}",
        anthropic_api_key="anthropic-key",
        gemini_api_key="",
        groq_api_key="",
    )


def test_run_stories_pipeline_publishes_completed_update():
    from src.pipeline.stories import run_stories_pipeline

    sheets = _FakeSheets()
    router = SimpleNamespace(
        call_task=lambda *args, **kwargs: LLMResult(
            text='{"title":"고래 이동","body_ko":"대형 이동이 감지됐습니다.","impact_score":77}',
            model_id="anthropic/claude-sonnet",
            tokens_in=100,
            tokens_out=50,
            cost_usd=0.02,
            latency_ms=250,
        )
    )

    with patch("src.pipeline.stories.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.stories.build_sheets_client", return_value=sheets
    ), patch("src.pipeline.stories.build_router_from_env", return_value=router), patch(
        "src.pipeline.stories.publish_success_event"
    ) as publish_success_event:
        result = run_stories_pipeline(limit=1)

    assert result["status"] == "completed"
    assert len(sheets.story_rows) == 1
    heartbeat = sheets.service_health[-1]
    assert heartbeat["job_name"] == "stories"
    assert heartbeat["processed_count"] == 1
    assert heartbeat["last_success_at"]
    publish_success_event.assert_called_once_with(
        section="stories",
        pipeline="stories",
        result=result,
    )
