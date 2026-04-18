import os
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    etherscan_api_key: str
    anthropic_api_key: str
    sheet_id: str
    google_credentials: str
    telegram_token: str
    solscan_api_key: str = ""
    telethon_api_id: int = 0
    telethon_api_hash: str = ""
    telethon_session: str = "whalescope"
    telethon_phone: str = ""
    telethon_session_string: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = ""


def _set_required(values: dict, field: str, env_var: str) -> None:
    value = os.getenv(env_var)
    if not value:
        raise ValueError(f"Missing required environment variable: {env_var}")
    values[field] = value


def _set_llm_values(values: dict, require_one: bool) -> None:
    values["anthropic_api_key"] = os.getenv("ANTHROPIC_API_KEY", "")
    values["gemini_api_key"] = os.getenv("GEMINI_API_KEY", "")
    values["groq_api_key"] = os.getenv("GROQ_API_KEY", "")
    if require_one and not any(
        values[key]
        for key in ("anthropic_api_key", "gemini_api_key", "groq_api_key")
    ):
        raise ValueError(
            "Missing required LLM provider key: set at least one of "
            "ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY"
        )


def _set_optional_values(values: dict) -> None:
    values["solscan_api_key"] = os.getenv("SOLSCAN_API_KEY", "")
    raw_api_id = os.getenv("TELETHON_API_ID", "0")
    values["telethon_api_id"] = int(raw_api_id) if raw_api_id.isdigit() else 0
    values["telethon_api_hash"] = os.getenv("TELETHON_API_HASH", "")
    values["telethon_session"] = os.getenv("TELETHON_SESSION", "whalescope")
    values["telethon_phone"] = os.getenv("TELETHON_PHONE", "")
    values["telethon_session_string"] = os.getenv("TELETHON_SESSION_STRING", "")


def load_config() -> Config:
    load_dotenv()

    values: dict = {}
    _set_required(values, "etherscan_api_key", "ETHERSCAN_API_KEY")
    _set_required(values, "sheet_id", "GOOGLE_SHEET_ID")
    _set_required(values, "google_credentials", "GOOGLE_CREDENTIALS_JSON")
    _set_required(values, "telegram_token", "TELEGRAM_BOT_TOKEN")
    _set_llm_values(values, require_one=True)
    _set_optional_values(values)

    return Config(**values)


def load_listener_config() -> Config:
    load_dotenv()

    values: dict = {
        "etherscan_api_key": "",
        "telegram_token": "",
    }
    _set_required(values, "sheet_id", "GOOGLE_SHEET_ID")
    _set_required(values, "google_credentials", "GOOGLE_CREDENTIALS_JSON")
    _set_llm_values(values, require_one=False)
    _set_optional_values(values)

    return Config(**values)


def has_llm_provider(config: Config) -> bool:
    return any(
        (
            config.anthropic_api_key,
            config.gemini_api_key,
            config.groq_api_key,
        )
    )
