"""Tests for the src.i18n module."""
from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from src.i18n import (
    BOT_MESSAGES,
    DEFAULT_LANGUAGE,
    Language,
    SUPPORTED_LANGUAGES,
    get_message,
)


def test_supported_languages_contains_ko_en_ja():
    assert "ko" in SUPPORTED_LANGUAGES
    assert "en" in SUPPORTED_LANGUAGES
    assert "ja" in SUPPORTED_LANGUAGES
    assert DEFAULT_LANGUAGE == "ko"
    assert SUPPORTED_LANGUAGES["ko"].prompt_suffix == ""
    assert SUPPORTED_LANGUAGES["en"].prompt_suffix == ".en"
    assert SUPPORTED_LANGUAGES["ja"].prompt_suffix == ".ja"


def test_language_dataclass_frozen():
    ko = SUPPORTED_LANGUAGES["ko"]
    with pytest.raises(FrozenInstanceError):
        ko.code = "xx"  # type: ignore[misc]


def test_get_message_fallback_to_korean():
    # Unknown language falls back to Korean
    assert get_message("zz", "welcome") == BOT_MESSAGES["ko"]["welcome"]
    assert get_message("zz", "paused") == BOT_MESSAGES["ko"]["paused"]


def test_get_message_unknown_key_returns_empty():
    assert get_message("ko", "does_not_exist") == ""
    assert get_message("en", "missing_key") == ""


def test_get_message_each_language_has_core_keys():
    required = {
        "welcome",
        "no_signals",
        "paused",
        "language_set",
        "language_usage",
        "language_invalid",
    }
    for lang, messages in BOT_MESSAGES.items():
        missing = required - messages.keys()
        assert not missing, f"{lang} missing keys: {missing}"


def test_language_instance_type():
    assert isinstance(SUPPORTED_LANGUAGES["ko"], Language)
    assert SUPPORTED_LANGUAGES["en"].name == "English"
