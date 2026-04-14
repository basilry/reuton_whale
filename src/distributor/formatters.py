from src.utils.logger import get_logger

logger = get_logger("formatters")

_IMPORTANCE_FULL = "\u2588"
_IMPORTANCE_EMPTY = "\u2591"
_BAR_LENGTH = 10
_STAR = " \u2b50"


def _importance_bar(score: float) -> str:
    normalized = max(0.0, min(1.0, score / 10.0))
    filled = round(normalized * _BAR_LENGTH)
    return _IMPORTANCE_FULL * filled + _IMPORTANCE_EMPTY * (_BAR_LENGTH - filled)


def _format_usd(value: float) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.0f}"


def format_daily_brief(
    briefs: list[dict], watchlist: list[str] | None = None
) -> str:
    if not briefs:
        return "<b>WhaleScope 데일리 브리핑</b>\n\n주목할 만한 고래 거래가 없습니다."

    watchlist_upper = {c.upper() for c in watchlist} if watchlist else set()
    cards: list[str] = []

    for b in briefs:
        symbol = b.get("symbol", "???").upper()
        amount_usd = b.get("amount_usd", 0)
        importance = b.get("importance_score", 0)
        analysis = b.get("analysis", "")

        is_watched = symbol in watchlist_upper
        star = _STAR if is_watched else ""

        card = (
            f"<b>{symbol}{star}</b>\n"
            f"금액: {_format_usd(amount_usd)}\n"
            f"중요도: [{_importance_bar(importance)}] {importance}/10\n"
        )
        if analysis:
            card += f"<i>{analysis}</i>\n"

        cards.append(card)

    header = f"<b>WhaleScope 데일리 브리핑</b> (거래 {len(briefs)}건)\n"
    return header + "\n" + "\n".join(cards)


def format_welcome_message() -> str:
    return (
        "<b>🐋 WhaleScope에 오신 것을 환영합니다!</b>\n\n"
        "매일 아침 KST 08:00에 Top 5 고래 거래 브리핑이 전달됩니다.\n\n"
        "<b>명령어:</b>\n"
        "/watchlist - 관심 코인 설정\n"
        "/pause - 알림 일시중지\n"
        "/status - 구독 상태 확인\n"
    )


def format_watchlist_confirmation(coins: list[str]) -> str:
    if not coins:
        return "모든 코인을 기본으로 추적합니다."
    formatted = ", ".join(f"<b>{c.upper()}</b>" for c in coins)
    return f"관심 코인 설정 완료: {formatted}"
