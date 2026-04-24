"""Run the WhaleScope Telegram bot in long-polling mode."""

import sys

sys.path.insert(0, ".")

from src.config import load_config
from src.distributor.telegram_bot import WhaleScopeBot
from src.storage.factory import build_storage_client
from src.utils.logger import get_logger

logger = get_logger("run_bot")


def main() -> None:
    config = load_config()
    sheets = build_storage_client()
    bot = WhaleScopeBot(token=config.telegram_token, sheets_client=sheets)
    app = bot.build()

    logger.info("Starting WhaleScope bot polling with drop_pending_updates=true...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
