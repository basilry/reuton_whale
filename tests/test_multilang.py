"""Integration tests for multi-language support across prompt loader, analyzer, and Telegram bot."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import src.analyzer.prompt_loader as pl


def _clear_cache():
    pl._CACHE.clear()


# ---------------------------------------------------------------------------
# prompt_loader language resolution
# ---------------------------------------------------------------------------


def test_load_prompt_ko_uses_default_files(tmp_path):
    _clear_cache()
    (tmp_path / "brief.system.txt").write_text("KO system", encoding="utf-8")
    content, _ = pl.load_prompt("brief.system", base_dir=tmp_path, lang="ko")
    assert content == "KO system"


def test_load_prompt_en_uses_en_files(tmp_path):
    _clear_cache()
    (tmp_path / "brief.system.txt").write_text("KO system", encoding="utf-8")
    (tmp_path / "brief.system.en.txt").write_text("EN system", encoding="utf-8")
    content, _ = pl.load_prompt("brief.system", base_dir=tmp_path, lang="en")
    assert content == "EN system"


def test_load_prompt_ja_uses_ja_files(tmp_path):
    _clear_cache()
    (tmp_path / "brief.user.txt").write_text("ko user", encoding="utf-8")
    (tmp_path / "brief.user.ja.txt").write_text("JA user", encoding="utf-8")
    content, _ = pl.load_prompt("brief.user", base_dir=tmp_path, lang="ja")
    assert content == "JA user"


def test_load_prompt_missing_lang_falls_back_to_ko(tmp_path):
    """If the language-specific file is missing, fall back to the Korean default."""
    _clear_cache()
    (tmp_path / "brief.system.txt").write_text("KO default", encoding="utf-8")
    # No brief.system.en.txt file -- should fall back
    content, _ = pl.load_prompt("brief.system", base_dir=tmp_path, lang="en")
    assert content == "KO default"


def test_load_prompt_cache_per_language(tmp_path):
    """Different language files should not cross-contaminate the cache."""
    _clear_cache()
    (tmp_path / "brief.system.txt").write_text("KO", encoding="utf-8")
    (tmp_path / "brief.system.en.txt").write_text("EN", encoding="utf-8")
    ko, _ = pl.load_prompt("brief.system", base_dir=tmp_path, lang="ko")
    en, _ = pl.load_prompt("brief.system", base_dir=tmp_path, lang="en")
    assert ko == "KO"
    assert en == "EN"


# ---------------------------------------------------------------------------
# claude_analyzer generate_daily_brief passes lang through
# ---------------------------------------------------------------------------


def _mock_signal():
    from src.signals.models import Signal

    now = datetime(2026, 4, 15, tzinfo=timezone.utc)
    return Signal(
        signal_id="sig-1",
        rule="cex_outflow_spike",
        severity="high",
        score=8.0,
        confidence="high",
        source="chain",
        evidence_tx_hashes=["0xabc"],
        window_start=now,
        window_end=now,
        summary="test summary",
    )


def test_generate_daily_brief_passes_lang_to_loader(tmp_path):
    """LLMAnalyzer.generate_daily_brief should pass its lang kwarg through to load_prompt."""
    # Create both ko and en prompt files in a temp prompts dir
    (tmp_path / "daily_brief.system.txt").write_text("ko sys", encoding="utf-8")
    (tmp_path / "daily_brief.user.txt").write_text("ko user {{date}} {{signals_json}}", encoding="utf-8")
    (tmp_path / "daily_brief.system.en.txt").write_text("en sys", encoding="utf-8")
    (tmp_path / "daily_brief.user.en.txt").write_text("en user {{date}} {{signals_json}}", encoding="utf-8")

    from src.analyzer.claude_analyzer import LLMAnalyzer

    mock_router = MagicMock()
    mock_result = MagicMock()
    mock_result.text = "brief output"
    mock_result.model_id = "test-model"
    mock_result.tokens_in = 10
    mock_result.tokens_out = 5
    mock_result.cost_usd = 0.001
    mock_result.latency_ms = 100
    mock_router.call_task.return_value = mock_result

    analyzer = LLMAnalyzer(router=mock_router, storage=None, prompts_dir=tmp_path)

    with patch(
        "src.analyzer.prompt_loader.load_prompt",
        wraps=pl.load_prompt,
    ) as spy:
        _clear_cache()
        analyzer.generate_daily_brief([_mock_signal()], lang="en")

        # Should have been called at least twice (system + user) with lang="en"
        lang_kwargs = [call.kwargs.get("lang") for call in spy.call_args_list]
        assert "en" in lang_kwargs

    # Router should be called with task="daily_brief_en" for en lang
    task_arg = mock_router.call_task.call_args[0][0]
    assert task_arg == "daily_brief_en"


def test_generate_daily_brief_ko_uses_default_task(tmp_path):
    """When lang=ko, routing task should remain 'daily_brief'."""
    (tmp_path / "daily_brief.system.txt").write_text("ko sys", encoding="utf-8")
    (tmp_path / "daily_brief.user.txt").write_text(
        "ko user {{date}} {{signals_json}}", encoding="utf-8"
    )

    from src.analyzer.claude_analyzer import LLMAnalyzer

    mock_router = MagicMock()
    mock_result = MagicMock()
    mock_result.text = "brief"
    mock_result.model_id = "m"
    mock_result.tokens_in = 1
    mock_result.tokens_out = 1
    mock_result.cost_usd = 0.0
    mock_result.latency_ms = 10
    mock_router.call_task.return_value = mock_result

    analyzer = LLMAnalyzer(router=mock_router, storage=None, prompts_dir=tmp_path)
    _clear_cache()
    analyzer.generate_daily_brief([_mock_signal()], lang="ko")

    assert mock_router.call_task.call_args[0][0] == "daily_brief"


# ---------------------------------------------------------------------------
# telegram_bot send_daily_brief respects subscriber language
# ---------------------------------------------------------------------------


@patch("src.distributor.telegram_bot.Application")
@pytest.mark.asyncio
async def test_send_daily_brief_uses_subscriber_language(mock_app_cls):
    """Each subscriber should receive the brief matching their language preference."""
    from src.distributor.telegram_bot import WhaleScopeBot
    from src.storage.sheets_client import SheetsClient

    mock_app = MagicMock()
    mock_builder = MagicMock()
    mock_builder.token.return_value = mock_builder
    mock_builder.build.return_value = mock_app
    mock_app_cls.builder.return_value = mock_builder
    mock_app.bot.send_message = AsyncMock()

    sheets_mock = MagicMock(spec=SheetsClient)
    sheets_mock.get_active_subscribers.return_value = [
        {"chat_id": 111, "watchlist": [], "language": "ko"},
        {"chat_id": 222, "watchlist": [], "language": "en"},
        {"chat_id": 333, "watchlist": []},  # no language -> ko default
    ]

    bot = WhaleScopeBot(token="t", sheets_client=sheets_mock)
    bot.build()

    multilang = {
        "ko": "KO 브리프",
        "en": "EN brief",
        "ja": "JA ブリーフ",
    }
    result = await bot.send_daily_brief(
        brief_text="FALLBACK",
        multilang_briefs=multilang,
    )
    assert result == {"sent": 3, "failed": 0, "blocked": 0}

    texts = [c.kwargs["text"] for c in mock_app.bot.send_message.call_args_list]
    assert texts[0] == "KO 브리프"
    assert texts[1] == "EN brief"
    # No language field -> defaults to "ko"
    assert texts[2] == "KO 브리프"


@patch("src.distributor.telegram_bot.Application")
@pytest.mark.asyncio
async def test_send_daily_brief_backwards_compatible_without_multilang(mock_app_cls):
    """Old callers that pass only brief_text should still work."""
    from src.distributor.telegram_bot import WhaleScopeBot
    from src.storage.sheets_client import SheetsClient

    mock_app = MagicMock()
    mock_builder = MagicMock()
    mock_builder.token.return_value = mock_builder
    mock_builder.build.return_value = mock_app
    mock_app_cls.builder.return_value = mock_builder
    mock_app.bot.send_message = AsyncMock()

    sheets_mock = MagicMock(spec=SheetsClient)
    sheets_mock.get_active_subscribers.return_value = [
        {"chat_id": 111, "watchlist": [], "language": "en"},
    ]

    bot = WhaleScopeBot(token="t", sheets_client=sheets_mock)
    bot.build()

    result = await bot.send_daily_brief(brief_text="only KR brief")
    assert result["sent"] == 1
    sent = mock_app.bot.send_message.call_args.kwargs["text"]
    assert sent == "only KR brief"


@patch("src.distributor.telegram_bot.Application")
@pytest.mark.asyncio
async def test_handle_language_no_args_replies_usage(mock_app_cls):
    from src.distributor.telegram_bot import WhaleScopeBot
    from src.storage.sheets_client import SheetsClient

    sheets_mock = MagicMock(spec=SheetsClient)
    sheets_mock.get_subscriber_info.return_value = None
    bot = WhaleScopeBot(token="t", sheets_client=sheets_mock)

    update = MagicMock()
    update.effective_chat.id = 1
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = []

    await bot.handle_language(update, context)
    reply = update.message.reply_text.call_args[0][0]
    assert "/language" in reply
    sheets_mock.update_subscriber_language.assert_not_called()


@patch("src.distributor.telegram_bot.Application")
@pytest.mark.asyncio
async def test_handle_language_invalid_code(mock_app_cls):
    from src.distributor.telegram_bot import WhaleScopeBot
    from src.storage.sheets_client import SheetsClient

    sheets_mock = MagicMock(spec=SheetsClient)
    sheets_mock.get_subscriber_info.return_value = None
    bot = WhaleScopeBot(token="t", sheets_client=sheets_mock)

    update = MagicMock()
    update.effective_chat.id = 1
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = ["zz"]

    await bot.handle_language(update, context)
    reply = update.message.reply_text.call_args[0][0]
    assert "ko, en, ja" in reply
    sheets_mock.update_subscriber_language.assert_not_called()


@patch("src.distributor.telegram_bot.Application")
@pytest.mark.asyncio
async def test_handle_language_valid_code_updates(mock_app_cls):
    from src.distributor.telegram_bot import WhaleScopeBot
    from src.storage.sheets_client import SheetsClient

    sheets_mock = MagicMock(spec=SheetsClient)
    sheets_mock.get_subscriber_info.return_value = None
    bot = WhaleScopeBot(token="t", sheets_client=sheets_mock)

    update = MagicMock()
    update.effective_chat.id = 42
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.args = ["en"]

    await bot.handle_language(update, context)
    sheets_mock.update_subscriber_language.assert_called_once_with(
        chat_id=42, language="en"
    )
    reply = update.message.reply_text.call_args[0][0]
    assert reply == "Language set to English."
