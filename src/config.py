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


def load_config() -> Config:
    load_dotenv()

    required = {
        "etherscan_api_key": "ETHERSCAN_API_KEY",
        "anthropic_api_key": "ANTHROPIC_API_KEY",
        "sheet_id": "GOOGLE_SHEET_ID",
        "google_credentials": "GOOGLE_CREDENTIALS_JSON",
        "telegram_token": "TELEGRAM_BOT_TOKEN",
    }

    values: dict = {}
    for field, env_var in required.items():
        value = os.getenv(env_var)
        if not value:
            raise ValueError(f"Missing required environment variable: {env_var}")
        values[field] = value

    values["solscan_api_key"] = os.getenv("SOLSCAN_API_KEY", "")
    raw_api_id = os.getenv("TELETHON_API_ID", "0")
    values["telethon_api_id"] = int(raw_api_id) if raw_api_id.isdigit() else 0
    values["telethon_api_hash"] = os.getenv("TELETHON_API_HASH", "")
    values["telethon_session"] = os.getenv("TELETHON_SESSION", "whalescope")

    return Config(**values)
