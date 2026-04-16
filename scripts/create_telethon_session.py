#!/usr/bin/env python3
"""Create a Telethon StringSession for non-interactive workers.

Required env:
    TELETHON_API_ID
    TELETHON_API_HASH
    TELETHON_PHONE  # E.164 format, for example +821012345678
"""
from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv


async def _run() -> None:
    try:
        from telethon import TelegramClient  # noqa: PLC0415
        from telethon.errors import PhoneNumberInvalidError  # noqa: PLC0415
        from telethon.sessions import StringSession  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError("telethon is not installed") from exc

    load_dotenv()

    raw_api_id = os.getenv("TELETHON_API_ID", "")
    api_hash = os.getenv("TELETHON_API_HASH", "")
    phone = os.getenv("TELETHON_PHONE", "")

    if not raw_api_id.isdigit() or not api_hash:
        raise RuntimeError("Set TELETHON_API_ID and TELETHON_API_HASH first.")

    if not phone.startswith("+"):
        raise RuntimeError(
            "Set TELETHON_PHONE in international E.164 format, "
            "for example +821012345678. Do not use a leading local 0."
        )

    client = TelegramClient(StringSession(), int(raw_api_id), api_hash)
    try:
        try:
            await client.start(phone=phone)
        except PhoneNumberInvalidError as exc:
            raise RuntimeError(
                "Invalid TELETHON_PHONE. Use international E.164 format "
                "with country code, for example +821012345678."
            ) from exc

        session_string = client.session.save()
        print()
        print("Add this value to Render or .env as a secret.")
        print("Treat it like a password; it authorizes Telegram account access.")
        print()
        print(f"TELETHON_SESSION_STRING={session_string}")
    finally:
        await client.disconnect()


def main() -> None:
    try:
        asyncio.run(_run())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
