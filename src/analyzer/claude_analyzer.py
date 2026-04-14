from __future__ import annotations

import hashlib
import json
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
    from src.storage.sheets_client import SheetsClient

logger = get_logger("claude_analyzer")


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
