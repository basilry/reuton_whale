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
