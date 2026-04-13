import os
from dataclasses import dataclass
from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    whale_alert_api_key: str
    anthropic_api_key: str
    sheet_id: str
    google_credentials: str
    telegram_token: str


def load_config() -> Config:
    load_dotenv()

    fields = {
        "whale_alert_api_key": "WHALE_ALERT_API_KEY",
        "anthropic_api_key": "ANTHROPIC_API_KEY",
        "sheet_id": "GOOGLE_SHEET_ID",
        "google_credentials": "GOOGLE_CREDENTIALS_JSON",
        "telegram_token": "TELEGRAM_BOT_TOKEN",
    }

    values = {}
    for field, env_var in fields.items():
        value = os.getenv(env_var)
        if not value:
            raise ValueError(f"Missing required environment variable: {env_var}")
        values[field] = value

    return Config(**values)
