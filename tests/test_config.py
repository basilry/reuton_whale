import pytest

from src.config import load_config


def _set_base_env(monkeypatch):
    monkeypatch.setattr("src.config.load_dotenv", lambda: None)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "eth-key")
    monkeypatch.setenv("GOOGLE_SHEET_ID", "sheet-id")
    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", '{"type":"service_account"}')
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "telegram-token")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)


def test_load_config_accepts_gemini_without_anthropic(monkeypatch):
    _set_base_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("TELETHON_PHONE", "+821012345678")
    monkeypatch.setenv("TELETHON_SESSION_STRING", "session-string")

    config = load_config()

    assert config.anthropic_api_key == ""
    assert config.gemini_api_key == "gemini-key"
    assert config.telethon_phone == "+821012345678"
    assert config.telethon_session_string == "session-string"


def test_load_config_requires_at_least_one_llm_key(monkeypatch):
    _set_base_env(monkeypatch)

    with pytest.raises(ValueError, match="Missing required LLM provider key"):
        load_config()
