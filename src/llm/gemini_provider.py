"""Google Gemini LLM provider."""
from __future__ import annotations

import time

from google import genai
from google.genai import types

from src.llm.base import LLMResult
from src.llm.usage import estimate_cost
from src.utils.errors import LLMProviderError


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str):
        self._client = genai.Client(api_key=api_key)

    def call(self, system: str, user: str, *, model: str, max_tokens: int = 2048) -> LLMResult:
        try:
            t0 = time.perf_counter()
            response = self._client.models.generate_content(
                model=model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=max_tokens,
                ),
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
        except Exception as exc:
            raise LLMProviderError(f"Gemini call failed: {exc}") from exc

        tokens_in = response.usage_metadata.prompt_token_count
        tokens_out = response.usage_metadata.candidates_token_count
        return LLMResult(
            text=response.text,
            model_id=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=estimate_cost("gemini", model, tokens_in, tokens_out),
            latency_ms=latency_ms,
        )
