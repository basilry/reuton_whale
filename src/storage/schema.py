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
    "highlights",
    "signal_themes",
    "note",
    "input_fingerprint",
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
    "task",
    "prompt_version",
    "prompt",
    "response",
    "model",
    "model_id",
    "tokens_used",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "latency_ms",
    "status",
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
TAB_CURATED_WALLETS = "curated_wallets"
TAB_WALLET_ALIASES = "wallet_aliases"
TAB_WATCHLIST_OVERRIDES = "watchlist_overrides"
TAB_NEWS_FEED = "news_feed"
TAB_MARKET_SNAPSHOTS = "market_snapshots"
TAB_WALLET_ACTIVITY_SNAPSHOTS = "wallet_activity_snapshots"
TAB_WHALE_STORIES = "whale_stories"
TAB_BROADCAST_LOG = "broadcast_log"
TAB_LLM_BUDGET_LOG = "llm_budget_log"
TAB_CURATED_WALLET_BALANCES = "curated_wallet_balances"
TAB_CHANNEL_HEALTH = "channel_health"
TAB_SERVICE_HEALTH = "service_health"

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

CURATED_WALLETS_HEADERS = [
    "id", "chain", "address", "owner_label", "owner_category",
    "owner_subcategory", "approx_balance", "tier", "source_ref",
    "source_url", "note", "entity_id", "is_representative",
    "narrative_tags", "display_priority", "is_active",
    "created_at", "updated_at",
]

WALLET_ALIASES_HEADERS = [
    "canonical_id", "alias_id", "chain", "address", "label", "note",
]

WATCHLIST_OVERRIDES_HEADERS = [
    "wallet_id", "enabled", "actor", "reason", "updated_at",
]

NEWS_FEED_HEADERS = [
    "id", "source", "title", "summary", "url",
    "published_at", "language", "tags", "fetched_at", "hash",
    # last_seen_at = when we most recently observed this article in ANY RSS poll,
    # including dedup hits. Distinct from fetched_at (first insertion time) so the
    # dashboard can tell "pipeline is polling" apart from "new article arrived".
    "last_seen_at",
]

MARKET_SNAPSHOTS_HEADERS = [
    "ts", "symbol", "binance_usd", "upbit_krw", "bitflyer_jpy",
    "kraken_eur", "krw_premium_pct", "jpy_premium_pct", "eur_premium_pct",
]

WALLET_ACTIVITY_SNAPSHOTS_HEADERS = [
    "ts", "wallet_id", "chain", "balance", "balance_delta_24h",
    "inflow_24h", "outflow_24h", "tx_count_24h", "source",
]

WHALE_STORIES_HEADERS = [
    "id", "signal_id", "wallet_id", "title", "body_ko",
    "body_en", "impact_score", "published_at", "source_signal_ts",
]

BROADCAST_LOG_HEADERS = [
    "ts", "kind", "dedup_key", "chat_id", "message_id", "status", "error",
]

LLM_BUDGET_LOG_HEADERS = [
    "ts",
    "month_key",
    "pipeline",
    "model_id",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "cumulative_cost_usd",
    "decision",
]

CURATED_WALLET_BALANCES_HEADERS = [
    "wallet_id",
    "chain",
    "address",
    "owner_label",
    "owner_category",
    "approx_balance",
    "source_ref",
    "source_url",
    "note",
    "is_active",
    "updated_at",
]

CHANNEL_HEALTH_HEADERS = [
    "ts",
    "chat_id",
    "title",
    "username",
    "member_count",
    "status",
    "error",
]

SERVICE_HEALTH_HEADERS = [
    "ts",
    "service",
    "component",
    "status",
    "heartbeat_key",
    "details",
    "error",
]

ALL_TABS.extend([
    TAB_WATCHED_ADDRESSES,
    TAB_ADDRESS_ACTIVITY,
    TAB_TG_WHALE_EVENTS,
    TAB_SIGNALS,
    TAB_WEEKLY_TREND,
    TAB_USER_INTERESTS,
    TAB_CURATED_WALLETS,
    TAB_WALLET_ALIASES,
    TAB_WATCHLIST_OVERRIDES,
    TAB_NEWS_FEED,
    TAB_MARKET_SNAPSHOTS,
    TAB_WALLET_ACTIVITY_SNAPSHOTS,
    TAB_WHALE_STORIES,
    TAB_BROADCAST_LOG,
    TAB_LLM_BUDGET_LOG,
    TAB_CURATED_WALLET_BALANCES,
    TAB_CHANNEL_HEALTH,
    TAB_SERVICE_HEALTH,
])

TAB_HEADERS.update({
    TAB_WATCHED_ADDRESSES: WATCHED_ADDRESSES_HEADERS,
    TAB_ADDRESS_ACTIVITY: ADDRESS_ACTIVITY_HEADERS,
    TAB_TG_WHALE_EVENTS: TG_WHALE_EVENTS_HEADERS,
    TAB_SIGNALS: SIGNALS_HEADERS,
    TAB_WEEKLY_TREND: WEEKLY_TREND_HEADERS,
    TAB_USER_INTERESTS: USER_INTERESTS_HEADERS,
    TAB_CURATED_WALLETS: CURATED_WALLETS_HEADERS,
    TAB_WALLET_ALIASES: WALLET_ALIASES_HEADERS,
    TAB_WATCHLIST_OVERRIDES: WATCHLIST_OVERRIDES_HEADERS,
    TAB_NEWS_FEED: NEWS_FEED_HEADERS,
    TAB_MARKET_SNAPSHOTS: MARKET_SNAPSHOTS_HEADERS,
    TAB_WALLET_ACTIVITY_SNAPSHOTS: WALLET_ACTIVITY_SNAPSHOTS_HEADERS,
    TAB_WHALE_STORIES: WHALE_STORIES_HEADERS,
    TAB_BROADCAST_LOG: BROADCAST_LOG_HEADERS,
    TAB_LLM_BUDGET_LOG: LLM_BUDGET_LOG_HEADERS,
    TAB_CURATED_WALLET_BALANCES: CURATED_WALLET_BALANCES_HEADERS,
    TAB_CHANNEL_HEALTH: CHANNEL_HEALTH_HEADERS,
    TAB_SERVICE_HEALTH: SERVICE_HEALTH_HEADERS,
})
