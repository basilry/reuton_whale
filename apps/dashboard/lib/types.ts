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

export type AdminObservabilityRatioSummary = {
  count: number;
  ratio: number;
};

export type AdminBriefObservability = {
  windowHours: number;
  totalRuns: number;
  generated: AdminObservabilityRatioSummary;
  cached: AdminObservabilityRatioSummary;
  skippedInactive: AdminObservabilityRatioSummary;
  skippedBudget: AdminObservabilityRatioSummary;
  llmCallCount: number;
  latestGeneratedAt?: string;
};

export type AdminBroadcastObservability = {
  windowHours: number;
  totalExecutions: number;
  skippedEmpty: AdminObservabilityRatioSummary;
  skippedDuplicateContent: AdminObservabilityRatioSummary;
  latestMessageLength: number | null;
  latestMessageExceededCap: boolean | null;
  latestPeriodicSendAt?: string;
};

export type AdminLiveUpdateSection = "brief" | "news" | "watchlist" | "stories";

export type AdminLiveUpdateSectionObservability = {
  section: AdminLiveUpdateSection;
  source: string;
  lastUpdatedAt?: string;
  lastRevalidatedAt?: string;
  ageMinutes: number | null;
};

export type AdminLiveUpdatesObservability = {
  enabled: boolean;
  configured: boolean;
  state: "enabled" | "disabled";
  reason?: "feature_disabled" | "redis_missing" | "token_missing";
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  latestActivityAt?: string;
  lastEventId?: string;
  latestLatencyMs: number | null;
  reconnectCount: number;
  lastReconnectAt?: string;
  lastErrorAt?: string;
  sections: AdminLiveUpdateSectionObservability[];
};

export type AdminMarketSourceId =
  | "binance"
  | "upbit"
  | "bitflyer"
  | "kraken"
  | "fx"
  | "snapshot"
  | "fear_greed";

export type AdminMarketSourceTransport =
  | "websocket"
  | "rest"
  | "composite"
  | "external_api";

export type AdminMarketSourceStatus =
  | "ready"
  | "degraded"
  | "manual_check"
  | "unavailable";

export type AdminMarketSourceObservability = {
  id: AdminMarketSourceId;
  transport: AdminMarketSourceTransport;
  status: AdminMarketSourceStatus;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  freshnessSeconds: number | null;
  failureReason?: string;
};

export type AdminTelegramObservability = {
  subscriberCountActive: number;
  subscriberCountPaused: number;
  subscriberCountBlocked: number;
  subscriberCountDeactivated: number;
  unsubscribe24h: number;
  unsubscribeRate24h: number;
  channelMemberCountLatest: number | null;
  channelMemberDelta24h: number | null;
  lastChannelHealthAt?: string;
  lastBroadcastAt?: string;
  lastBroadcastDeliveryMode?: string;
  lastBroadcastStatus?: string;
};

export type AdminObservabilitySummary = {
  brief: AdminBriefObservability;
  periodic: AdminBroadcastObservability;
  liveUpdates: AdminLiveUpdatesObservability;
  marketSources: AdminMarketSourceObservability[];
  telegram: AdminTelegramObservability;
};

export type SourceFailureKind =
  | "auth"
  | "quota"
  | "schema"
  | "network"
  | "empty"
  | "config"
  | "unknown";

export type SourceHealth = {
  connected: boolean;
  mode: "live" | "fallback";
  label: string;
  description: string;
  source: string;
  lastUpdatedAt?: string;
  staleMinutes?: number | null;
  failureKind?: SourceFailureKind | null;
};

export type OpsServiceName =
  | "pipeline"
  | "listener"
  | "bot"
  | "dashboard"
  | "data_source";

export type OpsServiceStatus =
  | "healthy"
  | "degraded"
  | "down"
  | "waiting"
  | "config_required";

export type OpsServiceHealth = {
  name: OpsServiceName;
  title: string;
  status: OpsServiceStatus;
  label: string;
  summary: string;
  detail: string;
  updatedAt?: string;
  source?: string;
};

export type OperatorCheckStatus = "ok" | "warn" | "missing";

export type OperatorCheck = {
  key: string;
  label: string;
  status: OperatorCheckStatus;
  detail: string;
};

export type OpsSummary = {
  status: OpsServiceStatus;
  headline: string;
  detail: string;
  impactedServices: OpsServiceName[];
  updatedAt?: string;
};

export type BriefMarketMoodDriver = {
  label: string;
  value: string;
  direction?: string;
};

export type BriefMarketMood = {
  mood: string;
  score: number;
  drivers: BriefMarketMoodDriver[];
  asOf?: string;
};

export type DashboardBrief = {
  date?: string;
  generatedAt?: string;
  summary?: string;
  alertCount?: number;
  totalVolumeUsd?: number;
  highlights?: string[];
  signalThemes?: string[];
  note?: string;
  noteRaw?: string;
  marketMood?: BriefMarketMood;
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
  adminObservability?: AdminObservabilitySummary | null;
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
  sourceHealth?: Partial<SourceHealth> | null;
  serviceHealth?: Partial<Record<OpsServiceName, Partial<OpsServiceHealth>>> | null;
  operatorChecks?: OperatorCheck[] | null;
  opsSummary?: Partial<OpsSummary> | null;
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
  note?: string;
  noteRaw?: string;
  marketMood?: BriefMarketMood;
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
  windowStart?: string;
  windowEnd?: string;
  narrativeAi?: string;
  relatedWallets?: Array<
    | {
        address: string;
        label: string | undefined;
        chain: string | undefined;
      }
    | null
  >;
  relatedAssets?: Array<
    | {
        symbol: string;
        direction: string | undefined;
      }
    | null
  >;
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
  sourceHealth: SourceHealth;
  serviceHealth: Record<OpsServiceName, OpsServiceHealth>;
  operatorChecks: OperatorCheck[];
  opsSummary: OpsSummary;
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
  | "protocol_treasury"
  | "foundation"
  | "founder"
  | "celebrity"
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
  displayPriority?: number;
  enabled: boolean;
  entityId?: string;
  isRepresentative?: boolean;
  narrativeTags?: string[];
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
  noteVariantId?: string;
  badge: string;
  address: string;
  chain: string;
  enabled: boolean;
  category: CuratedWalletCategory;
  grade: CuratedWalletGrade;
  priority: number;
  displayPriority?: number;
  entityId?: string;
  isRepresentative?: boolean;
  narrativeTags?: string[];
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
  amountToken?: number;
  amountUsd?: number;
  explorerUrl?: string;
  counterpartyNote?: string;
  occurredAt?: string;
  generatedAt?: string;
  priority: number;
  supportingSignalIds: string[];
  participants: WhaleStoryParticipant[];
};
