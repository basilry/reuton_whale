"""Smoke test: calls each LLM provider with a simple 'hello' prompt.
Skips providers whose API key env var is absent.
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, ".")
load_dotenv()

from src.llm.anthropic_provider import AnthropicProvider
from src.llm.gemini_provider import GeminiProvider
from src.llm.groq_provider import GroqProvider

_PROBES = [
    ("ANTHROPIC_API_KEY", AnthropicProvider, "claude-3-5-haiku-latest"),
    ("GEMINI_API_KEY", GeminiProvider, "gemini-2.5-flash"),
    ("GROQ_API_KEY", GroqProvider, "llama-3.3-70b-versatile"),
]

SYSTEM = "You are a test assistant."
USER = "Say hello in exactly one word."


def main() -> None:
    any_ran = False
    for env_var, cls, model in _PROBES:
        key = os.getenv(env_var)
        if not key:
            print(f"[skip] {cls.name}: {env_var} not set")
            continue
        print(f"[run]  {cls.name}/{model} ...", end=" ", flush=True)
        provider = cls(api_key=key)
        result = provider.call(SYSTEM, USER, model=model, max_tokens=10)
        print(f"ok | text={result.text!r} tokens={result.tokens_in}+{result.tokens_out} cost=${result.cost_usd:.6f} latency={result.latency_ms}ms")
        any_ran = True

    if not any_ran:
        print("No API keys found — all providers skipped.")
    sys.exit(0)


if __name__ == "__main__":
    main()
