"""Verify API connections: Etherscan, CoinGecko, configured LLMs, Sheets, Telegram."""

import sys

sys.path.insert(0, ".")

from src.config import load_config
from src.utils.logger import get_logger

logger = get_logger("test_connection")


def test_etherscan(api_key: str) -> bool:
    import requests

    try:
        resp = requests.get(
            "https://api.etherscan.io/v2/api",
            params={"chainid": 1, "module": "proxy", "action": "eth_blockNumber", "apikey": api_key},
            timeout=10,
        )
        data = resp.json()
        ok = resp.status_code == 200 and data.get("status") != "0"
        logger.info("Etherscan: %s", "OK" if ok else "FAIL")
        return ok
    except Exception as e:
        logger.error("Etherscan: FAIL (%s)", e)
        return False


def test_coingecko() -> bool:
    import requests

    try:
        resp = requests.get(
            "https://api.coingecko.com/api/v3/ping",
            timeout=10,
        )
        ok = resp.status_code == 200
        logger.info("CoinGecko: %s (status %d)", "OK" if ok else "FAIL", resp.status_code)
        return ok
    except Exception as e:
        logger.error("CoinGecko: FAIL (%s)", e)
        return False


def test_anthropic(api_key: str) -> bool:
    import anthropic

    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=16,
            messages=[{"role": "user", "content": "ping"}],
        )
        ok = len(resp.content) > 0
        logger.info("Anthropic: %s", "OK" if ok else "FAIL")
        return ok
    except Exception as e:
        logger.error("Anthropic: FAIL (%s)", e)
        return False


def test_gemini(api_key: str) -> bool:
    from src.llm.gemini_provider import GeminiProvider

    try:
        result = GeminiProvider(api_key).call(
            "Reply with one short word.",
            "ping",
            model="gemini-2.5-flash",
            max_tokens=8,
        )
        logger.info("Gemini: OK")
        return True
    except Exception as e:
        logger.error("Gemini: FAIL (%s)", e)
        return False


def test_groq(api_key: str) -> bool:
    from src.llm.groq_provider import GroqProvider

    try:
        result = GroqProvider(api_key).call(
            "Reply with one short word.",
            "ping",
            model="llama-3.3-70b-versatile",
            max_tokens=8,
        )
        ok = bool(result.text)
        logger.info("Groq: %s", "OK" if ok else "FAIL")
        return ok
    except Exception as e:
        logger.error("Groq: FAIL (%s)", e)
        return False


def test_google_sheets(sheet_id: str, credentials_json: str) -> bool:
    import json
    import gspread
    from google.oauth2.service_account import Credentials

    try:
        creds = Credentials.from_service_account_info(
            json.loads(credentials_json),
            scopes=[
                "https://spreadsheets.google.com/feeds",
                "https://www.googleapis.com/auth/drive",
            ],
        )
        gc = gspread.authorize(creds)
        ss = gc.open_by_key(sheet_id)
        ok = ss.title is not None
        logger.info("Google Sheets: %s (%s)", "OK" if ok else "FAIL", ss.title)
        return ok
    except Exception as e:
        logger.error("Google Sheets: FAIL (%s)", e)
        return False


def test_telegram(token: str) -> bool:
    import requests

    try:
        resp = requests.get(
            f"https://api.telegram.org/bot{token}/getMe",
            timeout=10,
        )
        ok = resp.status_code == 200 and resp.json().get("ok", False)
        bot_name = resp.json().get("result", {}).get("username", "?") if ok else "?"
        logger.info("Telegram: %s (@%s)", "OK" if ok else "FAIL", bot_name)
        return ok
    except Exception as e:
        logger.error("Telegram: FAIL (%s)", e)
        return False


def main():
    config = load_config()
    llm_results = {}
    if config.anthropic_api_key:
        llm_results["Anthropic"] = test_anthropic(config.anthropic_api_key)
    if config.gemini_api_key:
        llm_results["Gemini"] = test_gemini(config.gemini_api_key)
    if config.groq_api_key:
        llm_results["Groq"] = test_groq(config.groq_api_key)

    results = {
        "Etherscan": test_etherscan(config.etherscan_api_key),
        "CoinGecko": test_coingecko(),
        **llm_results,
        "Google Sheets": test_google_sheets(config.sheet_id, config.google_credentials),
        "Telegram": test_telegram(config.telegram_token),
    }

    print("\n--- Connection Test Results ---")
    all_ok = True
    for name, ok in results.items():
        status = "PASS" if ok else "FAIL"
        print(f"  {name}: {status}")
        if not ok:
            all_ok = False

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
