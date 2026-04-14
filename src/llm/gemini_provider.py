"""Google Gemini LLM provider. Filled in TRACK 1."""
from __future__ import annotations

from src.llm.base import LLMResult


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str):
        raise NotImplementedError("TRACK 1")

    def call(self, system: str, user: str, *, model: str, max_tokens: int = 2048) -> LLMResult:
        raise NotImplementedError("TRACK 1")
