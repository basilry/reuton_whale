"""Tests for LLMRouter: preferred success, fallback, and full failure."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.llm.base import LLMProvider, LLMResult
from src.llm.router import LLMRouter
from src.utils.errors import LLMProviderError, LLMRouterError

_ROUTING_CONFIG = {
    "tasks": {
        "test_task": {
            "preferred": "anthropic/claude-3-5-haiku-latest",
            "fallback": ["gemini/gemini-1.5-flash", "groq/llama-3.3-70b-versatile"],
            "max_tokens": 300,
        }
    }
}

_DUMMY_RESULT = LLMResult(
    text="hello",
    model_id="claude-3-5-haiku-latest",
    tokens_in=10,
    tokens_out=5,
    cost_usd=0.000012,
    latency_ms=120,
)


def _make_providers(
    anthropic_side_effect=None,
    gemini_side_effect=None,
    groq_side_effect=None,
) -> dict:
    anthropic = MagicMock(spec=LLMProvider)
    anthropic.name = "anthropic"
    anthropic.call.side_effect = anthropic_side_effect or [_DUMMY_RESULT]

    gemini = MagicMock(spec=LLMProvider)
    gemini.name = "gemini"
    gemini.call.side_effect = gemini_side_effect or [_DUMMY_RESULT]

    groq = MagicMock(spec=LLMProvider)
    groq.name = "groq"
    groq.call.side_effect = groq_side_effect or [_DUMMY_RESULT]

    return {"anthropic": anthropic, "gemini": gemini, "groq": groq}


def test_preferred_succeeds_no_fallback_called():
    providers = _make_providers()
    router = LLMRouter(providers, _ROUTING_CONFIG)

    result = router.call_task("test_task", "sys", "user")

    assert isinstance(result, LLMResult)
    providers["anthropic"].call.assert_called_once()
    providers["gemini"].call.assert_not_called()
    providers["groq"].call.assert_not_called()


def test_preferred_fails_first_fallback_succeeds():
    fallback_result = LLMResult(
        text="fallback",
        model_id="gemini-1.5-flash",
        tokens_in=8,
        tokens_out=4,
        cost_usd=0.0000003,
        latency_ms=90,
    )
    providers = _make_providers(
        anthropic_side_effect=LLMProviderError("api error"),
        gemini_side_effect=[fallback_result],
    )
    router = LLMRouter(providers, _ROUTING_CONFIG)

    result = router.call_task("test_task", "sys", "user")

    assert isinstance(result, LLMResult)
    assert result.text == "fallback"
    providers["anthropic"].call.assert_called_once()
    providers["gemini"].call.assert_called_once()
    providers["groq"].call.assert_not_called()


def test_all_candidates_fail_raises_router_error():
    providers = _make_providers(
        anthropic_side_effect=LLMProviderError("anthropic down"),
        gemini_side_effect=LLMProviderError("gemini down"),
        groq_side_effect=LLMProviderError("groq down"),
    )
    router = LLMRouter(providers, _ROUTING_CONFIG)

    with pytest.raises(LLMRouterError):
        router.call_task("test_task", "sys", "user")
