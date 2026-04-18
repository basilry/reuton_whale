export const TAB_TRANSACTIONS = "transactions" as const;
export const TAB_DAILY_BRIEF = "daily_brief" as const;
export const TAB_SIGNALS = "signals" as const;
export const TAB_SYSTEM_LOG = "system_log" as const;
export const TAB_SUBSCRIBERS = "subscribers" as const;
export const TAB_TG_WHALE_EVENTS = "tg_whale_events" as const;
export const TAB_CURATED_WALLETS = "curated_wallets" as const;
export const TAB_WATCHED_ADDRESSES = "watched_addresses" as const;
export const TAB_WALLET_ALIASES = "wallet_aliases" as const;
export const TAB_WATCHLIST_OVERRIDES = "watchlist_overrides" as const;
export const TAB_NEWS_FEED = "news_feed" as const;

export const TRANSACTIONS_HEADERS = [
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
] as const;

export const DAILY_BRIEF_HEADERS = [
  "date",
  "summary",
  "top_transactions",
  "total_volume_usd",
  "alert_count",
  "created_at",
  "highlights",
  "signal_themes",
  "note",
] as const;

export const SIGNALS_HEADERS = [
  "signal_id",
  "created_at",
  "rule",
  "severity",
  "score",
  "confidence",
  "source",
  "evidence_tx_hashes",
  "window_start",
  "window_end",
  "summary",
  "extra_json",
] as const;

export const SYSTEM_LOG_HEADERS = [
  "run_id",
  "run_type",
  "status",
  "started_at",
  "finished_at",
  "transactions_count",
  "errors",
  "details",
] as const;

export const SUBSCRIBERS_HEADERS = [
  "chat_id",
  "username",
  "status",
  "watchlist_coins",
  "created_at",
  "updated_at",
  "last_brief_at",
] as const;

export const TG_WHALE_EVENTS_HEADERS = [
  "tg_msg_id",
  "tg_date",
  "blockchain",
  "symbol",
  "amount",
  "amount_usd",
  "from_owner_type",
  "from_owner",
  "to_owner_type",
  "to_owner",
  "raw_text",
  "parsed_confidence",
  "collected_at",
] as const;

export const CURATED_WALLETS_HEADERS = [
  "id",
  "chain",
  "address",
  "owner_label",
  "owner_category",
  "owner_subcategory",
  "approx_balance",
  "tier",
  "source_ref",
  "source_url",
  "note",
  "is_active",
  "created_at",
  "updated_at",
] as const;

export const WATCHED_ADDRESSES_HEADERS = [
  "address",
  "chain",
  "category",
  "label",
  "source",
  "confidence",
  "enabled",
  "added_at",
  "notes",
] as const;

export const WALLET_ALIASES_HEADERS = [
  "canonical_id",
  "alias_id",
  "chain",
  "address",
  "label",
  "note",
] as const;

export const WATCHLIST_OVERRIDES_HEADERS = [
  "wallet_id",
  "enabled",
  "actor",
  "reason",
  "updated_at",
] as const;

export const NEWS_FEED_HEADERS = [
  "id",
  "source",
  "title",
  "summary",
  "url",
  "published_at",
  "language",
  "tags",
  "fetched_at",
  "hash",
  // last_seen_at = most recent RSS poll that observed this article (including dedup hits).
  // Distinct from fetched_at (first insert) so the dashboard can tell
  // "pipeline is polling" apart from "new article arrived".
  "last_seen_at",
] as const;

export interface TransactionRow {
  raw_response_hash: string;
  hash: string;
  timestamp: string;
  blockchain: string;
  symbol: string;
  amount: string;
  amount_usd: string;
  from_address: string;
  from_owner_type: string;
  from_owner: string;
  to_address: string;
  to_owner_type: string;
  to_owner: string;
  created_at: string;
}

export interface DailyBriefRow {
  date: string;
  summary: string;
  top_transactions: string;
  total_volume_usd: string;
  alert_count: string;
  created_at: string;
  highlights: string;
  signal_themes: string;
  note: string;
}

export interface SignalRow {
  signal_id: string;
  created_at: string;
  rule: string;
  severity: string;
  score: string;
  confidence: string;
  source: string;
  evidence_tx_hashes: string;
  window_start: string;
  window_end: string;
  summary: string;
  extra_json: string;
}

export interface SystemLogRow {
  run_id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string;
  transactions_count: string;
  errors: string;
  details: string;
}

export interface TgWhaleEventRow {
  tg_msg_id: string;
  tg_date: string;
  blockchain: string;
  symbol: string;
  amount: string;
  amount_usd: string;
  from_owner_type: string;
  from_owner: string;
  to_owner_type: string;
  to_owner: string;
  raw_text: string;
  parsed_confidence: string;
  collected_at: string;
}

export interface CuratedWalletRow {
  id: string;
  chain: string;
  address: string;
  owner_label: string;
  owner_category: string;
  owner_subcategory: string;
  approx_balance: string;
  tier: string;
  source_ref: string;
  source_url: string;
  note: string;
  is_active: string;
  created_at: string;
  updated_at: string;
}

export interface WatchedAddressRow {
  address: string;
  chain: string;
  category: string;
  label: string;
  source: string;
  confidence: string;
  enabled: string;
  added_at: string;
  notes: string;
}

export interface WalletAliasRow {
  canonical_id: string;
  alias_id: string;
  chain: string;
  address: string;
  label: string;
  note: string;
}

export interface WatchlistOverrideRow {
  wallet_id: string;
  enabled: string;
  actor: string;
  reason: string;
  updated_at: string;
}

export interface NewsFeedRow {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  language: string;
  tags: string;
  fetched_at: string;
  hash: string;
  last_seen_at: string;
}

export interface SubscriberRow {
  chat_id: string;
  username: string;
  status: string;
  watchlist_coins: string;
  created_at: string;
  updated_at: string;
  last_brief_at: string;
}

export interface SheetRowMap {
  transactions: TransactionRow;
  daily_brief: DailyBriefRow;
  signals: SignalRow;
  system_log: SystemLogRow;
  subscribers: SubscriberRow;
  tg_whale_events: TgWhaleEventRow;
  curated_wallets: CuratedWalletRow;
  watched_addresses: WatchedAddressRow;
  wallet_aliases: WalletAliasRow;
  watchlist_overrides: WatchlistOverrideRow;
  news_feed: NewsFeedRow;
}

export type SheetTabName = keyof SheetRowMap;

export const TAB_HEADERS = {
  transactions: TRANSACTIONS_HEADERS,
  daily_brief: DAILY_BRIEF_HEADERS,
  signals: SIGNALS_HEADERS,
  system_log: SYSTEM_LOG_HEADERS,
  subscribers: SUBSCRIBERS_HEADERS,
  tg_whale_events: TG_WHALE_EVENTS_HEADERS,
  curated_wallets: CURATED_WALLETS_HEADERS,
  watched_addresses: WATCHED_ADDRESSES_HEADERS,
  wallet_aliases: WALLET_ALIASES_HEADERS,
  watchlist_overrides: WATCHLIST_OVERRIDES_HEADERS,
  news_feed: NEWS_FEED_HEADERS,
} as const satisfies Record<SheetTabName, readonly string[]>;

export const DASHBOARD_TABS = [
  TAB_TRANSACTIONS,
  TAB_DAILY_BRIEF,
  TAB_SIGNALS,
  TAB_SYSTEM_LOG,
  TAB_SUBSCRIBERS,
  TAB_TG_WHALE_EVENTS,
] as const;

export type DashboardTabName = (typeof DASHBOARD_TABS)[number];
