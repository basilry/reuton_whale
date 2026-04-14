import json
from unittest.mock import MagicMock, patch

import pytest

from src.analyzer.claude_analyzer import ClaudeAnalyzer
from src.utils.errors import AnalysisError


def _mock_response(text: str, input_tokens: int = 100, output_tokens: int = 50):
    resp = MagicMock()
    resp.content = [MagicMock(text=text)]
    resp.usage.input_tokens = input_tokens
    resp.usage.output_tokens = output_tokens
    return resp


def _sample_tx():
    return {
        "hash": "abc123",
        "from_owner": "Binance",
        "from_owner_type": "exchange",
        "from_address": "0xaaa",
        "to_owner": "unknown",
        "to_owner_type": "unknown",
        "to_address": "0xbbb",
        "symbol": "BTC",
        "amount": 500,
        "amount_usd": 30_000_000,
        "blockchain": "bitcoin",
        "timestamp": 1700000000,
        "current_price": 60000,
        "price_change_24h": -2.5,
        "volume_24h": 25_000_000_000,
        "market_cap": 1_200_000_000_000,
    }


VALID_JSON = json.dumps({
    "importance_score": 8,
    "type": "distribution",
    "interpretation": "Large BTC withdrawal from exchange.",
    "key_insight": "Possible long-term holding signal.",
    "confidence": "high",
})


class TestAnalyzeTransaction:
    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_success(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        result = analyzer.analyze_transaction(_sample_tx())

        assert result["importance_score"] == 8
        assert result["type"] == "distribution"
        assert result["confidence"] == "high"
        assert "prompt_hash" in result

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_cache_hit(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        tx = _sample_tx()
        analyzer.analyze_transaction(tx)
        analyzer.analyze_transaction(tx)

        assert client.messages.create.call_count == 1

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_retry_on_invalid_json(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.side_effect = [
            _mock_response("not json"),
            _mock_response("still bad"),
            _mock_response(VALID_JSON),
        ]
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        result = analyzer.analyze_transaction(_sample_tx())
        assert result["importance_score"] == 8

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_raises_after_max_retries(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response("not json at all")
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        with pytest.raises(AnalysisError, match="Failed to parse"):
            analyzer.analyze_transaction(_sample_tx())

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_markdown_fence_stripped(self, mock_anthropic):
        fenced = f"```json\n{VALID_JSON}\n```"
        client = MagicMock()
        client.messages.create.return_value = _mock_response(fenced)
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        result = analyzer.analyze_transaction(_sample_tx())
        assert result["importance_score"] == 8


class TestAnalyzeBatch:
    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_batch(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        results = analyzer.analyze_batch([_sample_tx(), _sample_tx()])
        assert len(results) == 2

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_skips_failures(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response("bad json")
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        results = analyzer.analyze_batch([_sample_tx()])
        assert len(results) == 0


class TestParseJsonResponse:
    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_raw_json(self, mock_anthropic):
        mock_anthropic.Anthropic.return_value = MagicMock()
        analyzer = ClaudeAnalyzer(api_key="test-key")
        assert analyzer._parse_json_response('{"a": 1}') == {"a": 1}

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_markdown_fence_with_json_hint(self, mock_anthropic):
        mock_anthropic.Anthropic.return_value = MagicMock()
        analyzer = ClaudeAnalyzer(api_key="test-key")
        raw = '```json\n{"a": 1}\n```'
        assert analyzer._parse_json_response(raw) == {"a": 1}

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_markdown_fence_without_hint(self, mock_anthropic):
        mock_anthropic.Anthropic.return_value = MagicMock()
        analyzer = ClaudeAnalyzer(api_key="test-key")
        raw = '```\n{"a": 1}\n```'
        assert analyzer._parse_json_response(raw) == {"a": 1}

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_extract_braces_from_prose(self, mock_anthropic):
        mock_anthropic.Anthropic.return_value = MagicMock()
        analyzer = ClaudeAnalyzer(api_key="test-key")
        raw = 'Here is the analysis: {"a": 1, "b": "x"} done.'
        assert analyzer._parse_json_response(raw) == {"a": 1, "b": "x"}

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_garbage_raises(self, mock_anthropic):
        mock_anthropic.Anthropic.return_value = MagicMock()
        analyzer = ClaudeAnalyzer(api_key="test-key")
        with pytest.raises(AnalysisError):
            analyzer._parse_json_response("no json at all")


class TestSheetsCache:
    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_sheets_cache_hit_skips_api(self, mock_anthropic):
        from src.storage.sheets_client import SheetsClient

        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        sheets = MagicMock(spec=SheetsClient)
        sheets.get_cached_analysis.return_value = {"response": VALID_JSON}

        analyzer = ClaudeAnalyzer(api_key="test-key", sheets=sheets)
        result = analyzer.analyze_transaction(_sample_tx())

        assert result["importance_score"] == 8
        client.messages.create.assert_not_called()
        sheets.save_analysis.assert_not_called()

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_sheets_cache_miss_persists(self, mock_anthropic):
        from src.storage.sheets_client import SheetsClient

        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        sheets = MagicMock(spec=SheetsClient)
        sheets.get_cached_analysis.return_value = None

        analyzer = ClaudeAnalyzer(api_key="test-key", sheets=sheets)
        analyzer.analyze_transaction(_sample_tx())

        client.messages.create.assert_called_once()
        sheets.save_analysis.assert_called_once()

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_sheets_none_falls_through(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key", sheets=None)
        result = analyzer.analyze_transaction(_sample_tx())
        assert result["importance_score"] == 8

    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_sheets_cache_failure_falls_back_to_api(self, mock_anthropic):
        from src.storage.sheets_client import SheetsClient

        client = MagicMock()
        client.messages.create.return_value = _mock_response(VALID_JSON)
        mock_anthropic.Anthropic.return_value = client

        sheets = MagicMock(spec=SheetsClient)
        sheets.get_cached_analysis.side_effect = Exception("sheets down")

        analyzer = ClaudeAnalyzer(api_key="test-key", sheets=sheets)
        result = analyzer.analyze_transaction(_sample_tx())

        assert result["importance_score"] == 8
        client.messages.create.assert_called_once()


class TestGenerateDailyBrief:
    @patch("src.analyzer.claude_analyzer.anthropic")
    def test_brief(self, mock_anthropic):
        client = MagicMock()
        client.messages.create.return_value = _mock_response("오늘의 고래 브리핑입니다.")
        mock_anthropic.Anthropic.return_value = client

        analyzer = ClaudeAnalyzer(api_key="test-key")
        tx = _sample_tx()
        tx.update({"type": "distribution", "importance_score": 8, "interpretation": "Big move"})
        brief = analyzer.generate_daily_brief([tx])
        assert "브리핑" in brief
