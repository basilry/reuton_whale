"""Groq LLM provider."""
from __future__ import annotations

import time

from groq import Groq

from src.llm.base import LLMResult
from src.llm.usage import estimate_cost
from src.utils.errors import LLMProviderError


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str):
        self._client = Groq(api_key=api_key)

    def call(self, system: str, user: str, *, model: str, max_tokens: int = 2048) -> LLMResult:
        try:
            t0 = time.perf_counter()
            response = self._client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
        except Exception as exc:
            raise LLMProviderError(f"Groq call failed: {exc}") from exc

        tokens_in = response.usage.prompt_tokens
        tokens_out = response.usage.completion_tokens
        return LLMResult(
            text=response.choices[0].message.content,
            model_id=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=estimate_cost("groq", model, tokens_in, tokens_out),
            latency_ms=latency_ms,
        )
