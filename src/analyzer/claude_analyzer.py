import hashlib
import json

import anthropic

from src.analyzer.prompts import (
    BRIEF_PROMPT_TEMPLATE,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from src.utils.errors import AnalysisError
from src.utils.logger import get_logger

logger = get_logger("claude_analyzer")


class ClaudeAnalyzer:
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.analysis_log: dict[str, dict] = {}

    def _make_prompt_hash(self, text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    def _call_api(self, user_content: str, system: str = SYSTEM_PROMPT) -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        logger.info("Token usage: input=%d, output=%d, total=%d", tokens_in, tokens_out, tokens_in + tokens_out)
        return response.content[0].text

    def _parse_json_response(self, raw: str) -> dict:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(cleaned)

    def analyze_transaction(self, transaction: dict) -> dict:
        user_content = USER_PROMPT_TEMPLATE.format(**transaction)
        prompt_hash = self._make_prompt_hash(user_content)

        if prompt_hash in self.analysis_log:
            logger.info("Cache hit for transaction %s", transaction.get("hash", ""))
            return self.analysis_log[prompt_hash]

        max_attempts = 3
        last_error = None
        for attempt in range(max_attempts):
            try:
                raw = self._call_api(user_content)
                result = self._parse_json_response(raw)
                result["prompt_hash"] = prompt_hash
                self.analysis_log[prompt_hash] = result
                return result
            except (json.JSONDecodeError, KeyError, IndexError) as e:
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
            return self._call_api(user_content, system="You are a professional crypto market analyst. Write in Korean.")
        except Exception as e:
            raise AnalysisError(f"Failed to generate daily brief: {e}") from e
