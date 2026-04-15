#!/usr/bin/env python3
"""Run the assignment demo with fixture signals and a real LLM brief.

This avoids external collectors, Google Sheets, Telegram delivery, and any writes
unless --output is provided. It is intended to show the core product experience:
curated whale signals -> Korean LLM briefing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.analyzer.claude_analyzer import LLMAnalyzer
from src.main import _build_router, _dict_to_event, _load_signals_cfg
from src.signals.engine import SignalEngine
from src.signals.models import Event, Signal

DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "sample_events.json"


def _parse_dt(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def load_fixture(path: Path) -> tuple[datetime, list[Event]]:
    with path.open() as f:
        payload = json.load(f)
    now = _parse_dt(payload.get("now", datetime.now().isoformat()))
    events = [_dict_to_event(e) for e in payload.get("events", [])]
    return now, events


def build_real_llm_analyzer() -> LLMAnalyzer:
    load_dotenv()
    available = {
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
        "gemini": bool(os.getenv("GEMINI_API_KEY")),
        "groq": bool(os.getenv("GROQ_API_KEY")),
    }
    if not any(available.values()):
        raise SystemExit(
            "Real LLM demo requires at least one provider key: "
            "ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY."
        )

    router = _build_router(
        SimpleNamespace(anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    )
    return LLMAnalyzer(router=router, storage=None)


def build_signals(events: list[Event], now: datetime) -> list[Signal]:
    engine = SignalEngine(_load_signals_cfg(), storage=None)
    return engine.run(events, now, baselines={})


def render_output(brief: str, signals: list[Signal]) -> str:
    lines = [
        "# WhaleScope Real LLM Demo Output",
        "",
        f"- Signals: {len(signals)}",
        "- Mode: real LLM API",
        "",
        "## Signal Summary",
    ]
    for signal in sorted(signals, key=lambda s: s.score, reverse=True):
        lines.append(
            f"- [{signal.severity}] {signal.rule} score={signal.score:.1f} "
            f"source={signal.source}: {signal.summary}"
        )
    lines.extend(["", "## Korean Brief", "", brief.strip(), ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a real LLM WhaleScope brief from fixture signals."
    )
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--output", type=Path, help="Optional markdown output path")
    args = parser.parse_args()

    now, events = load_fixture(args.fixture)
    signals = build_signals(events, now)
    if not signals:
        raise SystemExit("No signals were generated from the fixture.")

    analyzer = build_real_llm_analyzer()
    brief = analyzer.generate_daily_brief(signals)
    output = render_output(brief, signals)

    print(output)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
        print(f"\nSaved demo output: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
