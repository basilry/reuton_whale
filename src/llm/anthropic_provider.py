"""Anthropic LLM provider."""
from __future__ import annotations

import time

from anthropic import Anthropic

from src.llm.base import LLMResult
from src.llm.usage import estimate_cost
from src.utils.errors import LLMProviderError


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str):
        self._client = Anthropic(api_key=api_key)

    def call(self, system: str, user: str, *, model: str, max_tokens: int = 2048) -> LLMResult:
        try:
            t0 = time.perf_counter()
            response = self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
        except Exception as exc:
            raise LLMProviderError(f"Anthropic call failed: {exc}") from exc

        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        return LLMResult(
            text=response.content[0].text,
            model_id=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=estimate_cost("anthropic", model, tokens_in, tokens_out),
            latency_ms=latency_ms,
        )
