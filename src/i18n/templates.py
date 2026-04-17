"""Language-aware message templates for Telegram bot."""
from __future__ import annotations

BOT_MESSAGES: dict[str, dict[str, str]] = {
    "ko": {
        "welcome": "WhaleScope에 오신 것을 환영합니다. /watchlist로 관심 코인을 등록하거나 /language로 언어를 변경할 수 있습니다.",
        "no_signals": "오늘은 관심 기준에 부합하는 시그널이 없습니다.",
        "paused": "알림이 일시중지되었습니다.",
        "language_set": "언어가 한국어로 설정되었습니다.",
        "language_usage": "사용법: /language ko|en|ja",
        "language_invalid": "지원되지 않는 언어입니다. 사용 가능: ko, en, ja",
    },
    "en": {
        "welcome": "Welcome to WhaleScope. Register watchlist coins with /watchlist or change language with /language.",
        "no_signals": "No signals matching your criteria today.",
        "paused": "Notifications paused.",
        "language_set": "Language set to English.",
        "language_usage": "Usage: /language ko|en|ja",
        "language_invalid": "Unsupported language. Available: ko, en, ja",
    },
    "ja": {
        "welcome": "WhaleScopeへようこそ。/watchlistでウォッチリストを登録するか、/languageで言語を変更できます。",
        "no_signals": "本日は基準に合致するシグナルがありませんでした。",
        "paused": "通知を一時停止しました。",
        "language_set": "言語を日本語に設定しました。",
        "language_usage": "使い方: /language ko|en|ja",
        "language_invalid": "サポートされていない言語です。利用可能: ko, en, ja",
    },
}

def get_message(lang: str, key: str) -> str:
    return BOT_MESSAGES.get(lang, BOT_MESSAGES["ko"]).get(key, "")
