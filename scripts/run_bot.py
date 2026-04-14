"""Run the WhaleScope Telegram bot in long-polling mode."""

import sys

sys.path.insert(0, ".")

from src.config import load_config
from src.distributor.telegram_bot import WhaleScopeBot
from src.storage.sheets_client import SheetsClient
from src.utils.logger import get_logger

logger = get_logger("run_bot")


def main() -> None:
    config = load_config()
    sheets = SheetsClient(
        sheet_id=config.sheet_id,
        credentials_json=config.google_credentials,
    )
    bot = WhaleScopeBot(token=config.telegram_token, sheets_client=sheets)
    app = bot.build()

    logger.info("Starting WhaleScope bot polling...")
    app.run_polling(stop_signals=None)


if __name__ == "__main__":
    main()
