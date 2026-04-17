"""Cost calculator for LLM providers.

Rate sources (2026-04 snapshot):
  Anthropic: https://www.anthropic.com/pricing#anthropic-api
  Google:    https://ai.google.dev/pricing
  Groq:      https://groq.com/pricing/
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# USD per 1 million tokens: {model_id: (input_per_1m, output_per_1m)}
_RATES: dict[str, tuple[float, float]] = {
    # Anthropic
    "claude-3-5-sonnet-latest": (3.0, 15.0),
    "claude-3-5-haiku-latest": (0.8, 4.0),
    # Google Gemini
    "gemini-1.5-flash": (0.075, 0.30),
    "gemini-1.5-pro": (1.25, 5.0),
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-2.5-flash": (0.15, 0.60),
    "gemini-2.5-pro": (1.25, 5.0),
    # Groq
    "llama-3.3-70b-versatile": (0.59, 0.79),
}


def estimate_cost(provider: str, model: str, tokens_in: int, tokens_out: int) -> float:
    """Return USD cost estimate for a single LLM call."""
    rates = _RATES.get(model)
    if rates is None:
        logger.warning("No rate data for model=%r provider=%r; cost reported as 0.0", model, provider)
        return 0.0
    input_rate, output_rate = rates
    return (tokens_in * input_rate + tokens_out * output_rate) / 1_000_000
