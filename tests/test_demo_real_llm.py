from datetime import datetime, timezone

import pytest

from scripts import demo_real_llm
from src.signals.models import Signal


def _signal(rule="cold_to_hot_transfer"):
    now = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return Signal(
        signal_id="sig1",
        rule=rule,
        severity="high",
        score=9.0,
        confidence="high",
        source="chain",
        evidence_tx_hashes=["tx1"],
        window_start=now,
        window_end=now,
        summary="Large cold-to-hot transfer",
    )


def test_render_output_includes_signal_and_brief():
    rendered = demo_real_llm.render_output("오늘의 브리핑", [_signal()])

    assert "# WhaleScope Real LLM Demo Output" in rendered
    assert "- Signals: 1" in rendered
    assert "cold_to_hot_transfer" in rendered
    assert "오늘의 브리핑" in rendered


def test_build_real_llm_analyzer_requires_provider_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(demo_real_llm, "load_dotenv", lambda: None)

    with pytest.raises(SystemExit, match="Real LLM demo requires"):
        demo_real_llm.build_real_llm_analyzer()
