from src.utils.logger import get_logger

logger = get_logger("formatters")

_IMPORTANCE_FULL = "\u2588"
_IMPORTANCE_EMPTY = "\u2591"
_BAR_LENGTH = 10
_STAR = " \u2b50"


def _importance_bar(score: float) -> str:
    clamped = max(0.0, min(1.0, score))
    filled = round(clamped * _BAR_LENGTH)
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
        return "<b>WhaleScope Daily Brief</b>\n\nNo significant whale movements detected."

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
            f"Amount: {_format_usd(amount_usd)}\n"
            f"Importance: [{_importance_bar(importance)}] {importance:.0%}\n"
        )
        if analysis:
            card += f"<i>{analysis}</i>\n"

        cards.append(card)

    header = f"<b>WhaleScope Daily Brief</b> ({len(briefs)} transactions)\n"
    return header + "\n" + "\n".join(cards)


def format_welcome_message() -> str:
    return (
        "<b>Welcome to WhaleScope</b>\n\n"
        "Real-time whale transaction monitoring with AI analysis.\n\n"
        "<b>Commands:</b>\n"
        "/watchlist ETH BTC SOL - Set coins to watch\n"
        "/watchlist - View current watchlist\n"
        "/pause - Pause notifications\n"
        "/status - Subscription status & latest brief\n"
    )


def format_watchlist_confirmation(coins: list[str]) -> str:
    if not coins:
        return "Watchlist cleared. You'll receive briefs for all coins."
    formatted = ", ".join(f"<b>{c.upper()}</b>" for c in coins)
    return f"Watchlist updated: {formatted}\nMatching transactions will be highlighted with {_STAR.strip()}."
