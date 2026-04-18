// Dashboard shared types (extracted from app/page.tsx during the W1-B split).
// Server Components and the normalize/humanize helpers all import from here.

export type DashboardMetrics = {
  transactionCount: number;
  signalCount: number;
  dailyBriefCount: number;
  subscriberCount: number;
  latestRunStatus: string;
  latestRunErrorCount: number;
  lastUpdatedAt?: string;
};

export type DashboardBrief = {
  date?: string;
  generatedAt?: string;
  summary?: string;
  alertCount?: number;
  totalVolumeUsd?: number;
  highlights?: string[];
  signalThemes?: string[];
  topTransactions?: Array<{
    symbol?: unknown;
    amountUsd?: unknown;
    amount_usd?: unknown;
    chain?: unknown;
    blockchain?: unknown;
  }>;
};

export type DashboardData = {
  generatedAt?: string;
  metrics?: Partial<DashboardMetrics>;
  latestBrief?: DashboardBrief | null;
  recentTransactions?: unknown[] | null;
  recentSignals?: unknown[] | null;
  curatedWallets?: CuratedWalletEntry[] | null;
  watchlist?: CuratedWatchlistItem[] | null;
  whaleStories?: WhaleStory[] | null;
  latestRun?: {
    status?: string;
    message?: string;
    errorCount?: number;
    updatedAt?: string;
  } | null;
  listenerHealth?: {
    status?: string;
    label?: string;
    message?: string;
    updatedAt?: string;
    event?: string;
  } | null;
  systemLogs?: DisplaySystemLogRow[] | null;
  source?: string;
};

export type NormalizedBrief = {
  date?: string;
  generatedAt?: string;
  summary: string;
  alertCount?: number;
  totalVolumeUsd?: number;
  highlights?: string[];
  signalThemes?: string[];
  topTransactions?: Array<{
    symbol: string;
    amountUsd: number;
    chain: string;
  }>;
};

export type DisplayTransactionRow = {
  id: string;
  timestamp: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: string;
  to: string;
  chain: string;
  hash: string;
  direction?: string;
};

export type DisplaySignalRow = {
  id: string;
  createdAt: string;
  rule: string;
  severity: string;
  score: number;
  confidence?: string;
  source: string;
  summary: string;
  evidenceTxHashes: string[];
};

export type DisplaySystemLogRow = {
  id?: string;
  timestamp: string;
  status: string;
  title: string;
  message: string;
};

export type NormalizedDashboard = {
  generatedAt: string;
  source: string;
  metrics: DashboardMetrics;
  latestBrief: NormalizedBrief;
  recentTransactions: DisplayTransactionRow[];
  recentSignals: DisplaySignalRow[];
  latestRun: {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  };
  listenerHealth: {
    status: string;
    label: string;
    message: string;
    updatedAt?: string;
    event?: string;
  };
  systemLogs: DisplaySystemLogRow[];
  sourceState: "connected" | "fallback";
};

export type MetricTone = "accent" | "good" | "warn" | "bad" | "neutral" | "soft";

export const FALLBACK_SOURCE = "local fallback";

export type WhaleStoryTone = "critical" | "watch" | "positive" | "neutral";

export type CuratedWalletCategory =
  | "exchange"
  | "market_maker"
  | "fund"
  | "custody"
  | "bridge"
  | "protocol"
  | "foundation"
  | "unknown";

export type CuratedWalletGrade = "A" | "B" | "C" | "D";

export type CuratedWalletEntry = {
  id: string;
  address: string;
  chain: string;
  label: string;
  category: CuratedWalletCategory;
  grade: CuratedWalletGrade;
  priority: number;
  enabled: boolean;
  aliases?: string[];
  note?: string;
  focusSymbols?: string[];
};

export type CuratedWalletMatch = {
  walletId: string;
  label: string;
  category: CuratedWalletCategory;
  grade: CuratedWalletGrade;
  priority: number;
  chain: string;
  address: string;
  matchReason: "address" | "owner_label" | "alias";
};

export type CuratedWatchlistItem = {
  id: string;
  symbol: string;
  title: string;
  note: string;
  badge: string;
  address: string;
  chain: string;
  enabled: boolean;
  category: CuratedWalletCategory;
  grade: CuratedWalletGrade;
  priority: number;
  tone: WhaleStoryTone;
  lastSeenAt?: string;
  relatedSignalCount: number;
};

export type WhaleStoryParticipant = {
  role: "from" | "to";
  label: string;
  address?: string;
  curatedWallet?: CuratedWalletMatch;
};

export type WhaleStory = {
  id: string;
  kind: "transaction" | "signal" | "brief" | "empty";
  title: string;
  body: string;
  meta: string;
  tone: WhaleStoryTone;
  hash?: string;
  symbol?: string;
  chain?: string;
  occurredAt?: string;
  priority: number;
  supportingSignalIds: string[];
  participants: WhaleStoryParticipant[];
};
