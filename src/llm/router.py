"""LLM router with preferred/fallback model selection. Filled in TRACK 1."""
from __future__ import annotations

from src.llm.base import LLMProvider, LLMResult


class LLMRouter:
    def __init__(self, providers: dict[str, LLMProvider], routing_config: dict, logger=None):
        raise NotImplementedError("TRACK 1")

    def call_task(self, task: str, system: str, user: str) -> LLMResult:
        raise NotImplementedError("TRACK 1")
