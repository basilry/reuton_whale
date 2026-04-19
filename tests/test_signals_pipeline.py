from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from src.pipeline.common import CollectedEvents


class _FakeSheets:
    def __init__(self) -> None:
        self.run_logs: list[dict] = []
        self.service_health: list[dict] = []

    def log_run(self, run_data: dict) -> None:
        self.run_logs.append(dict(run_data))

    def append_service_health(self, entry: dict) -> None:
        self.service_health.append(dict(entry))


def _fake_env() -> SimpleNamespace:
    return SimpleNamespace(
        sheet_id="sheet",
        google_credentials="{}",
        etherscan_api_key="etherscan",
        solscan_api_key="solscan",
    )


def _render_log_messages(mock_logger) -> list[str]:
    messages: list[str] = []
    for call in mock_logger.info.call_args_list:
        message = call.args[0]
        if len(call.args) > 1:
            message = message % call.args[1:]
        messages.append(message)
    return messages


def test_run_signals_pipeline_logs_stage_diagnostics():
    from src.pipeline.signals import run_signals_pipeline

    sheets = _FakeSheets()
    collected = CollectedEvents(
        raw_events=[SimpleNamespace(source="chain"), SimpleNamespace(source="tg")],
        chain_events=[SimpleNamespace(source="chain")],
        transactions=[{"hash": "0xabc"}],
        errors=["collect_failed:partial"],
    )

    with patch("src.pipeline.signals.load_pipeline_env", return_value=_fake_env()), patch(
        "src.pipeline.signals.build_sheets_client", return_value=sheets
    ), patch(
        "src.pipeline.signals.build_price_services",
        return_value=(object(), object(), object()),
    ), patch("src.pipeline.signals._load_signals_cfg", return_value={}), patch(
        "src.pipeline.signals.SignalEngine"
    ), patch(
        "src.pipeline.signals.collect_recent_events", return_value=collected
    ), patch(
        "src.pipeline.signals.persist_chain_activity",
        return_value={
            "stored_activity": 1,
            "stored_transactions": 1,
            "errors": ["persist_failed:transactions"],
        },
    ), patch(
        "src.pipeline.signals.log_unknown_price_symbols",
        return_value=["price_unknown_symbols:append_failed"],
    ), patch(
        "src.pipeline.signals.detect_signals",
        return_value=([object(), object()], ["signal_engine:degraded"]),
    ), patch(
        "src.pipeline.signals.persist_signals",
        return_value=(1, ["append_signal:sig-1:duplicate"]),
    ), patch("src.pipeline.signals.logger") as mock_logger:
        result = run_signals_pipeline()

    messages = _render_log_messages(mock_logger)
    assert result["status"] == "completed_with_errors"
    assert any(message.startswith("signals collected raw_events=2 chain_events=1 tg_events=1") for message in messages)
    assert any("signals persisted address_activity=1 stored_transactions=1 persist_errors=1" in message for message in messages)
    assert any("signals price diagnostics unknown_symbol_log_errors=1 cumulative_errors=3" in message for message in messages)
    assert any("signals detected signals=2 detect_errors=1 raw_events=2" in message for message in messages)
    assert any("signals stored stored_signals=1 persist_signal_errors=1 cumulative_errors=5" in message for message in messages)
    assert any("signals pipeline finished status=completed_with_errors" in message for message in messages)
