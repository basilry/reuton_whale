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
