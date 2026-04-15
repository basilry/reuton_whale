export const TAB_TRANSACTIONS = "transactions" as const;
export const TAB_DAILY_BRIEF = "daily_brief" as const;
export const TAB_SIGNALS = "signals" as const;
export const TAB_SYSTEM_LOG = "system_log" as const;
export const TAB_SUBSCRIBERS = "subscribers" as const;

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
}

export type SheetTabName = keyof SheetRowMap;

export const TAB_HEADERS = {
  transactions: TRANSACTIONS_HEADERS,
  daily_brief: DAILY_BRIEF_HEADERS,
  signals: SIGNALS_HEADERS,
  system_log: SYSTEM_LOG_HEADERS,
  subscribers: SUBSCRIBERS_HEADERS,
} as const satisfies Record<SheetTabName, readonly string[]>;

export const DASHBOARD_TABS = [
  TAB_TRANSACTIONS,
  TAB_DAILY_BRIEF,
  TAB_SIGNALS,
  TAB_SYSTEM_LOG,
  TAB_SUBSCRIBERS,
] as const;

export type DashboardTabName = (typeof DASHBOARD_TABS)[number];
