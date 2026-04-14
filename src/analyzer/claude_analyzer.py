from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import anthropic

from src.analyzer.prompts import (
    BRIEF_PROMPT_TEMPLATE,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from src.utils.errors import AnalysisError
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from src.llm.router import LLMRouter
    from src.signals.models import Signal
    from src.storage.sheets_client import SheetsClient

logger = get_logger("claude_analyzer")


# ---------------------------------------------------------------------------
# LLMAnalyzer — new class, uses LLMRouter; ClaudeAnalyzer kept for compat
# ---------------------------------------------------------------------------

class LLMAnalyzer:
    """LLM-backed analyzer wired through the multi-provider LLMRouter."""

    def __init__(
        self,
        router: "LLMRouter",
        storage=None,
        prompts_dir: "Path | None" = None,
    ):
        self._router = router
        self._storage = storage
        self._prompts_dir = prompts_dir
        self.analysis_log: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_prompt(self, name: str) -> tuple[str, str]:
        from src.analyzer.prompt_loader import load_prompt
        return load_prompt(name, base_dir=self._prompts_dir)

    def _make_hash(self, *parts: str) -> str:
        return hashlib.sha256("".join(parts).encode()).hexdigest()

    def _load_from_cache(self, prompt_hash: str) -> str | None:
        if not self._storage:
            return None
        try:
            cached = self._storage.get_cached_analysis(prompt_hash)
            if cached and cached.get("response"):
                return cached["response"]
        except Exception:
            pass
        return None

    def _save_to_cache(self, prompt_hash: str, response: str) -> None:
        if not self._storage:
            return
        try:
            self._storage.save_analysis({
                "prompt_hash": prompt_hash,
                "response": response,
            })
        except Exception as e:
            logger.warning("Failed to save analysis cache: %s", e)

    def _log_analysis(self, entry: dict) -> None:
        if not self._storage:
            return
        try:
            self._storage.save_analysis_log(entry)
        except Exception as e:
            logger.warning("Failed to log analysis: %s", e)

    def _parse_json(self, raw: str) -> dict:
        stripped = raw.strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
        if stripped.startswith("```"):
            inner = stripped.strip("`")
            if inner.lower().startswith("json"):
                inner = inner[4:]
            inner = inner.strip().rstrip("`").strip()
            try:
                return json.loads(inner)
            except json.JSONDecodeError:
                pass
        m = re.search(r"\{.*\}", stripped, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
        raise AnalysisError(f"Cannot parse JSON: {raw!r}")

    # ------------------------------------------------------------------
    # Public API — new interface
    # ------------------------------------------------------------------

    def generate_daily_brief(self, signals: "list[Signal]") -> str:
        sys_prompt, sys_ver = self._load_prompt("daily_brief.system")
        user_tmpl, user_ver = self._load_prompt("daily_brief.user")

        signals_json = json.dumps(
            [
                {
                    "rule": s.rule,
                    "severity": s.severity,
                    "score": s.score,
                    "summary": s.summary,
                    "source": s.source,
                    "confidence": s.confidence,
                }
                for s in signals
            ],
            ensure_ascii=False,
        )
        today = date.today().isoformat()
        user_content = user_tmpl.replace("{{signals_json}}", signals_json).replace(
            "{{date}}", today
        )

        prompt_hash = self._make_hash(sys_prompt, user_content)
        cached = self._load_from_cache(prompt_hash)
        if cached:
            logger.info("Cache hit for daily_brief prompt_hash=%s", prompt_hash[:8])
            return cached

        t0 = time.perf_counter()
        result = self._router.call_task("daily_brief", sys_prompt, user_content)
        latency_ms = int((time.perf_counter() - t0) * 1000)

        prompt_version = f"{sys_ver}+{user_ver}"
        self._log_analysis({
            "task": "daily_brief",
            "model_id": result.model_id,
            "prompt_version": prompt_version,
            "tokens_in": result.tokens_in,
            "tokens_out": result.tokens_out,
            "cost_usd": result.cost_usd,
            "latency_ms": latency_ms,
        })
        self._save_to_cache(prompt_hash, result.text)
        return result.text

    def generate_weekly_commentary(self, summary_rows: list[dict]) -> str:
        sys_prompt, sys_ver = self._load_prompt("weekly_trend.system")
        user_content = json.dumps(summary_rows, ensure_ascii=False)

        result = self._router.call_task("weekly_trend", sys_prompt, user_content)
        self._log_analysis({
            "task": "weekly_trend",
            "model_id": result.model_id,
            "prompt_version": sys_ver,
            "tokens_in": result.tokens_in,
            "tokens_out": result.tokens_out,
            "cost_usd": result.cost_usd,
            "latency_ms": result.latency_ms,
        })
        return result.text

    def parse_intent(self, message: str) -> dict:
        sys_prompt, sys_ver = self._load_prompt("nl_intent.system")

        result = self._router.call_task("nl_intent", sys_prompt, message)
        self._log_analysis({
            "task": "nl_intent",
            "model_id": result.model_id,
            "prompt_version": sys_ver,
            "tokens_in": result.tokens_in,
            "tokens_out": result.tokens_out,
            "cost_usd": result.cost_usd,
            "latency_ms": result.latency_ms,
        })
        try:
            return self._parse_json(result.text)
        except (AnalysisError, json.JSONDecodeError):
            return {}

    def analyze_batch(self, transactions: list[dict]) -> list[dict]:
        """Legacy compat: score each transaction dict via LLMRouter."""
        results = []
        for tx in transactions:
            try:
                user_content = _safe_format(USER_PROMPT_TEMPLATE, tx)
                prompt_hash = self._make_hash(SYSTEM_PROMPT, user_content)

                # check memory cache
                if prompt_hash in self.analysis_log:
                    results.append({**tx, **self.analysis_log[prompt_hash]})
                    continue

                cached = self._load_from_cache(prompt_hash)
                if cached:
                    try:
                        parsed = json.loads(cached)
                        parsed["prompt_hash"] = prompt_hash
                        self.analysis_log[prompt_hash] = parsed
                        results.append({**tx, **parsed})
                        continue
                    except json.JSONDecodeError:
                        pass

                result = self._router.call_task(
                    "per_signal_narration", SYSTEM_PROMPT, user_content
                )
                parsed = self._parse_json(result.text)
                parsed["prompt_hash"] = prompt_hash
                self.analysis_log[prompt_hash] = parsed
                self._save_to_cache(prompt_hash, result.text)
                results.append({**tx, **parsed})
            except Exception as e:
                logger.error("Skipping transaction %s: %s", tx.get("hash", ""), e)
        return results


def _safe_format(template: str, data: dict) -> str:
    """Format template with data, substituting missing keys with '?'."""
    import string

    class SafeDict(dict):
        def __missing__(self, key):
            return "?"

    return template.format_map(SafeDict(data))


# ---------------------------------------------------------------------------
# ClaudeAnalyzer — original class kept for backward compatibility with tests
# ---------------------------------------------------------------------------

class ClaudeAnalyzer:
    def __init__(
        self,
        api_key: str,
        sheets: "SheetsClient | None" = None,
        model: str = "claude-sonnet-4-20250514",
    ):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self._sheets = sheets
        self.analysis_log: dict[str, dict] = {}

    def _make_prompt_hash(self, text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    def _call_api(self, user_content: str, system: str = SYSTEM_PROMPT) -> tuple[str, int]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        total = tokens_in + tokens_out
        logger.info("Token usage: input=%d, output=%d, total=%d", tokens_in, tokens_out, total)
        return response.content[0].text, total

    def _parse_json_response(self, raw: str) -> dict:
        stripped = raw.strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
        if stripped.startswith("```"):
            inner = stripped.strip("`")
            if inner.lower().startswith("json"):
                inner = inner[4:]
            inner = inner.strip()
            if inner.endswith("```"):
                inner = inner[:-3].strip()
            try:
                return json.loads(inner)
            except json.JSONDecodeError:
                pass
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(stripped[start : end + 1])
        raise AnalysisError(f"Cannot parse JSON from response: {raw!r}")

    def _load_from_sheets_cache(self, prompt_hash: str) -> dict | None:
        if not self._sheets:
            return None
        try:
            cached = self._sheets.get_cached_analysis(prompt_hash)
        except Exception as e:
            logger.warning("Sheets cache lookup failed: %s", e)
            return None
        if not cached or not cached.get("response"):
            return None
        try:
            result = json.loads(cached["response"])
        except json.JSONDecodeError:
            return None
        result["prompt_hash"] = prompt_hash
        return result

    def _persist_to_sheets(self, prompt_hash: str, prompt: str, result: dict, tokens: int) -> None:
        if not self._sheets:
            return
        try:
            self._sheets.save_analysis({
                "prompt_hash": prompt_hash,
                "prompt": prompt,
                "response": json.dumps(result, ensure_ascii=False),
                "model": self.model,
                "tokens_used": tokens,
            })
        except Exception as e:
            logger.warning("Failed to persist analysis to sheets: %s", e)

    def analyze_transaction(self, transaction: dict) -> dict:
        user_content = USER_PROMPT_TEMPLATE.format(**transaction)
        prompt_hash = self._make_prompt_hash(user_content)

        if prompt_hash in self.analysis_log:
            logger.info("Memory cache hit for transaction %s", transaction.get("hash", ""))
            return self.analysis_log[prompt_hash]

        cached = self._load_from_sheets_cache(prompt_hash)
        if cached is not None:
            logger.info("Sheets cache hit for transaction %s", transaction.get("hash", ""))
            self.analysis_log[prompt_hash] = cached
            return cached

        max_attempts = 3
        last_error = None
        for attempt in range(max_attempts):
            try:
                raw, tokens = self._call_api(user_content)
                result = self._parse_json_response(raw)
                result["prompt_hash"] = prompt_hash
                self.analysis_log[prompt_hash] = result
                self._persist_to_sheets(prompt_hash, user_content, result, tokens)
                return result
            except (json.JSONDecodeError, KeyError, IndexError, AnalysisError) as e:
                last_error = e
                logger.warning("Parse attempt %d/%d failed: %s", attempt + 1, max_attempts, e)

        raise AnalysisError(f"Failed to parse Claude response after {max_attempts} attempts: {last_error}")

    def analyze_batch(self, transactions: list[dict]) -> list[dict]:
        results = []
        for tx in transactions:
            try:
                analysis = self.analyze_transaction(tx)
                results.append({**tx, **analysis})
            except AnalysisError as e:
                logger.error("Skipping transaction %s: %s", tx.get("hash", ""), e)
        return results

    def generate_daily_brief(self, top_transactions: list[dict]) -> str:
        summaries = []
        for i, tx in enumerate(top_transactions, 1):
            summaries.append(
                f"{i}. [{tx.get('symbol', '?')}] ${tx.get('amount_usd', 0):,.0f} "
                f"| {tx.get('from_owner', '?')} -> {tx.get('to_owner', '?')} "
                f"| type: {tx.get('type', '?')} | score: {tx.get('importance_score', '?')}/10 "
                f"| {tx.get('interpretation', '')}"
            )

        user_content = BRIEF_PROMPT_TEMPLATE.format(
            count=len(top_transactions),
            transactions_summary="\n".join(summaries),
        )

        try:
            text, _ = self._call_api(user_content, system="You are a professional crypto market analyst. Write in Korean.")
            return text
        except Exception as e:
            raise AnalysisError(f"Failed to generate daily brief: {e}") from e
