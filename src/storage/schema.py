TAB_TRANSACTIONS = "transactions"
TAB_DAILY_BRIEF = "daily_brief"
TAB_SUBSCRIBERS = "subscribers"
TAB_ANALYSIS_LOG = "analysis_log"
TAB_SYSTEM_LOG = "system_log"

ALL_TABS = [
    TAB_TRANSACTIONS,
    TAB_DAILY_BRIEF,
    TAB_SUBSCRIBERS,
    TAB_ANALYSIS_LOG,
    TAB_SYSTEM_LOG,
]

TRANSACTIONS_HEADERS = [
    "raw_response_hash",
    "hash",
    "timestamp",
    "blockchain",
    "symbol",
    "amount",
    "amount_usd",
    "from_address",
    "from_owner_type",
    "from_owner",
    "to_address",
    "to_owner_type",
    "to_owner",
    "created_at",
]

DAILY_BRIEF_HEADERS = [
    "date",
    "summary",
    "top_transactions",
    "total_volume_usd",
    "alert_count",
    "created_at",
]

SUBSCRIBERS_HEADERS = [
    "chat_id",
    "username",
    "status",
    "watchlist_coins",
    "created_at",
    "updated_at",
    "last_brief_at",
]

ANALYSIS_LOG_HEADERS = [
    "prompt_hash",
    "prompt",
    "response",
    "model",
    "tokens_used",
    "created_at",
]

SYSTEM_LOG_HEADERS = [
    "run_id",
    "run_type",
    "status",
    "started_at",
    "finished_at",
    "transactions_count",
    "errors",
    "details",
]

TAB_HEADERS = {
    TAB_TRANSACTIONS: TRANSACTIONS_HEADERS,
    TAB_DAILY_BRIEF: DAILY_BRIEF_HEADERS,
    TAB_SUBSCRIBERS: SUBSCRIBERS_HEADERS,
    TAB_ANALYSIS_LOG: ANALYSIS_LOG_HEADERS,
    TAB_SYSTEM_LOG: SYSTEM_LOG_HEADERS,
}

# --- New tabs (TRACK 2) ---

TAB_WATCHED_ADDRESSES = "watched_addresses"
TAB_ADDRESS_ACTIVITY = "address_activity"
TAB_TG_WHALE_EVENTS = "tg_whale_events"
TAB_SIGNALS = "signals"
TAB_WEEKLY_TREND = "weekly_trend"
TAB_USER_INTERESTS = "user_interests"

WATCHED_ADDRESSES_HEADERS = [
    "address", "chain", "category", "label", "source",
    "confidence", "enabled", "added_at", "notes",
]

ADDRESS_ACTIVITY_HEADERS = [
    "tx_hash", "chain", "block_time", "watched_address", "direction",
    "counterparty", "counterparty_category", "token", "amount_token",
    "amount_usd", "collected_at",
]

TG_WHALE_EVENTS_HEADERS = [
    "tg_msg_id", "tg_date", "blockchain", "symbol", "amount",
    "amount_usd", "from_owner_type", "from_owner", "to_owner_type",
    "to_owner", "raw_text", "parsed_confidence", "collected_at",
]

SIGNALS_HEADERS = [
    "signal_id", "created_at", "rule", "severity", "score",
    "confidence", "source", "evidence_tx_hashes", "window_start",
    "window_end", "summary", "extra_json",
]

WEEKLY_TREND_HEADERS = [
    "week_start", "category", "chain", "net_flow_usd",
    "event_count", "unique_addresses", "created_at",
]

USER_INTERESTS_HEADERS = [
    "chat_id", "dimension", "value", "weight", "source",
    "updated_at",
]

ALL_TABS.extend([
    TAB_WATCHED_ADDRESSES,
    TAB_ADDRESS_ACTIVITY,
    TAB_TG_WHALE_EVENTS,
    TAB_SIGNALS,
    TAB_WEEKLY_TREND,
    TAB_USER_INTERESTS,
])

TAB_HEADERS.update({
    TAB_WATCHED_ADDRESSES: WATCHED_ADDRESSES_HEADERS,
    TAB_ADDRESS_ACTIVITY: ADDRESS_ACTIVITY_HEADERS,
    TAB_TG_WHALE_EVENTS: TG_WHALE_EVENTS_HEADERS,
    TAB_SIGNALS: SIGNALS_HEADERS,
    TAB_WEEKLY_TREND: WEEKLY_TREND_HEADERS,
    TAB_USER_INTERESTS: USER_INTERESTS_HEADERS,
})
