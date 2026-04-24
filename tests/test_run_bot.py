from __future__ import annotations

from unittest.mock import MagicMock, patch


def test_run_bot_uses_drop_pending_updates_and_default_stop_signals() -> None:
    import scripts.run_bot as run_bot

    app = MagicMock()
    bot = MagicMock()
    bot.build.return_value = app

    with patch.object(run_bot, "load_config", return_value=MagicMock(telegram_token="token")), patch.object(
        run_bot, "build_storage_client", return_value=MagicMock()
    ), patch.object(run_bot, "WhaleScopeBot", return_value=bot):
        run_bot.main()

    app.run_polling.assert_called_once_with(drop_pending_updates=True)
