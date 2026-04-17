"""Supported language definitions."""
from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class Language:
    code: str
    name: str
    prompt_suffix: str
    disclaimer: str

SUPPORTED_LANGUAGES: dict[str, Language] = {
    "ko": Language(code="ko", name="한국어", prompt_suffix="",
                   disclaimer="본 내용은 투자 조언이 아닙니다."),
    "en": Language(code="en", name="English", prompt_suffix=".en",
                   disclaimer="This is not financial advice."),
    "ja": Language(code="ja", name="日本語", prompt_suffix=".ja",
                   disclaimer="本内容は投資助言ではありません。"),
}
DEFAULT_LANGUAGE = "ko"
