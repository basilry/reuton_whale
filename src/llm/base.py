from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class LLMResult:
    text: str
    model_id: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int


class LLMProvider(Protocol):
    name: str

    def call(
        self,
        system: str,
        user: str,
        *,
        model: str,
        max_tokens: int = 2048,
    ) -> LLMResult: ...
