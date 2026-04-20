import { JWT } from "google-auth-library";

import {
  compactString,
  newestFirst,
  parseFloatSafe,
  parseDateTimeSafe,
  parseIntSafe,
  parseJsonSafe,
  safeStringifyBounded,
  sanitizeForRsc,
} from "./format";
import {
  type DailyBriefRow,
  type SubscriberRow,
  type SignalRow,
  type SystemLogRow,
  type TgWhaleEventRow,
  type TransactionRow,
  type WatchedAddressRow,
} from "./schema";
import {
  buildCuratedWatchlistItems,
  getCuratedWalletRegistryMeta,
  listCuratedWalletEntries,
  loadCuratedWalletEntries,
  loadCuratedWalletEntriesWithMeta,
  persistCuratedWalletEnabled,
  toLegacyWatchlistEntries,
} from "./curated-wallets";
import { getDashboardEnv, getLiveUpdatesEnv, getRenderEnvState, SHEETS_SCOPES } from "./env";
import { getFearGreedData } from "./fear-greed";
import { getLiveUpdateStatus } from "./live-updates";
import { fetchLiveUpdateEvents } from "./live-updates.server";
import { loadRenderObservability } from "./render";
import {
  readDashboardSnapshot,
  readDashboardSnapshotSafe,
  readSheetRows,
} from "./sheets";
import { buildWhaleStories, buildWhaleStoryCards } from "./whale-stories";
import type {
  AdminChainCoverageEntry,
  AdminChainCoverageObservability,
  AdminChainRolloutEntry,
  AdminChainRolloutMode,
  AdminChainRolloutObservability,
  AdminChainRolloutStatus,
  AdminMarketSourceObservability,
  AdminRenderObservability,
  AdminObservabilitySummary,
  AdminLiveUpdateSectionObservability,
  AdminTgMirrorObservability,
  AdminTelegramObservability,
  BriefMarketMood,
  CuratedWalletEntry,
  CuratedWatchlistItem,
  DisplaySignalRow,
  OperatorCheck,
  OpsServiceHealth,
  OpsServiceName,
  OpsServiceStatus,
  OpsSummary,
  RenderApiError,
  RenderServiceKey,
  ServiceHealthRow,
  SourceFailureKind,
  SourceHealth,
  WhaleStory,
} from "./types";

export const LISTENER_STALE_MINUTES = 15;
export const PIPELINE_STALE_MINUTES = 20;
export const PIPELINE_DOWN_MINUTES = 45;
export const SOURCE_STALE_MINUTES = 30;
const ADMIN_OBSERVABILITY_WINDOW_HOURS = 24;
const ADMIN_OBSERVABILITY_WINDOW_MS = ADMIN_OBSERVABILITY_WINDOW_HOURS * 60 * 60 * 1000;
const TELEGRAM_MESSAGE_HARD_CAP = 1500;
const TELEGRAM_UNSUBSCRIBED_STATUSES = new Set(["paused", "blocked", "deactivated"]);
const CHAIN_ROLLOUT_ORDER = [
  "ETH",
  "ARB",
  "BASE",
  "BSC",
  "POLYGON",
  "SOL",
  "XRP",
  "TRX",
  "BTC",
  "DOGE",
] as const;
const CHAIN_ROLLOUT_INDEX = new Map<string, number>(
  CHAIN_ROLLOUT_ORDER.map((chain, index) => [chain, index] as const),
);
const CHAIN_ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  eth: "ETH",
  evm: "ETH",
  arbitrum: "ARB",
  arb: "ARB",
  base: "BASE",
  bsc: "BSC",
  bnb: "BSC",
  polygon: "POLYGON",
  matic: "POLYGON",
  solana: "SOL",
  sol: "SOL",
  ripple: "XRP",
  xrp: "XRP",
  tron: "TRX",
  trx: "TRX",
  dogecoin: "DOGE",
  doge: "DOGE",
};
const CHAIN_ROLLOUT_CONFIG: Record<
  string,
  {
    collectorMode: AdminChainRolloutMode;
    envName?: string;
    partialView: boolean;
  }
> = {
  ETH: { collectorMode: "always_on", partialView: false },
  ARB: { collectorMode: "always_on", partialView: false },
  BASE: { collectorMode: "always_on", partialView: false },
  BSC: { collectorMode: "always_on", partialView: false },
  POLYGON: { collectorMode: "always_on", partialView: false },
  SOL: { collectorMode: "always_on", partialView: false },
  XRP: { collectorMode: "env_flag", envName: "ENABLE_CHAIN_XRP", partialView: false },
  TRX: { collectorMode: "env_flag", envName: "ENABLE_CHAIN_TRX", partialView: false },
  BTC: { collectorMode: "env_flag", envName: "ENABLE_CHAIN_BTC", partialView: true },
  DOGE: { collectorMode: "env_flag", envName: "ENABLE_CHAIN_DOGE", partialView: true },
};
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const OPTIONAL_TAB_RANGE = "A:ZZ";
const PIPELINE_RUN_TYPES = new Set([
  "run_all",
  "signals",
  "curated_balance",
  "news_rss",
  "stories",
  "brief",
  "daily_brief",
  "broadcast_daily",
  "channel_health",
  "weekly_trend",
]);
const SERVICE_TITLES: Record<OpsServiceName, string> = {
  pipeline: "Pipeline",
  listener: "Listener",
  bot: "Bot",
  dashboard: "Dashboard",
  data_source: "Data source",
};

export interface RowCounts {
  transactions: number;
  daily_brief: number;
  signals: number;
  system_log: number;
  subscribers: number;
}

export interface LatestRunSummary {
  run_id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string;
  transactions_count: number | null;
  errors: number | string | null;
  /**
   * Bounded string form of the row's `details` column. We do NOT forward the
   * raw parsed object to the client — arbitrary deeply-nested or cyclic
   * payloads written by the Python pipeline (e.g., googleapis error objects
   * that get JSON-stringified) can crash React Server Components deserialization
   * with RangeError: Maximum call stack size exceeded when React replays the
   * server console stream to the browser.
   */
  details: string;
}

export interface DashboardMetrics {
  transactionCount: number;
  signalCount: number;
  dailyBriefCount: number;
  subscriberCount: number;
  latestRunStatus: string;
  latestRunErrorCount: number;
  lastUpdatedAt?: string;
  rowCounts: RowCounts;
  latestStatus: string | null;
  errorCount: number;
}

export interface ListenerHealth {
  status: "ok" | "waiting" | "auth_required" | "attention" | "unknown";
  label: string;
  message: string;
  updatedAt?: string;
  event?: string;
}

export interface OptionalSheetRow {
  [key: string]: string;
}

export interface DashboardBrief {
  date?: string;
  generatedAt?: string;
  summary: string;
  alertCount: number;
  totalVolumeUsd: number;
  highlights: string[];
  signalThemes: string[];
  note?: string;
  noteRaw?: string;
  marketMood?: BriefMarketMood;
  topTransactions: Array<{
    symbol: string;
    amountUsd: number;
    chain: string;
  }>;
}

export interface DashboardData {
  generatedAt: string;
  source: string;
  adminObservability: AdminObservabilitySummary | null;
  latestBrief: DashboardBrief | null;
  recentTransactions: TransactionRow[];
  recentSignals: Array<SignalRow | DisplaySignalRow>;
  curatedWallets: CuratedWalletEntry[];
  watchlist: CuratedWatchlistItem[];
  whaleStories: WhaleStory[];
  latestRun: (LatestRunSummary & {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  }) | null;
  listenerHealth: ListenerHealth;
  sourceHealth: SourceHealth;
  serviceHealth: Record<OpsServiceName, OpsServiceHealth>;
  operatorChecks: OperatorCheck[];
  opsSummary: OpsSummary;
  systemLogs: Array<{
    id: string;
    timestamp: string;
    status: string;
    title: string;
    message: string;
  }>;
  metrics: DashboardMetrics;
}

function envText(name: string): string {
  switch (name) {
    case "GOOGLE_SHEET_ID":
      return process.env.GOOGLE_SHEET_ID?.trim() ?? "";
    case "GOOGLE_CREDENTIALS_JSON":
      return process.env.GOOGLE_CREDENTIALS_JSON?.trim() ?? "";
    case "TELETHON_SESSION_STRING":
      return process.env.TELETHON_SESSION_STRING?.trim() ?? "";
    case "TELETHON_API_ID":
      return process.env.TELETHON_API_ID?.trim() ?? "";
    case "TELETHON_API_HASH":
      return process.env.TELETHON_API_HASH?.trim() ?? "";
    case "ANTHROPIC_API_KEY":
      return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
    case "GEMINI_API_KEY":
      return process.env.GEMINI_API_KEY?.trim() ?? "";
    case "GROQ_API_KEY":
      return process.env.GROQ_API_KEY?.trim() ?? "";
    case "DASHBOARD_PASSWORD":
      return process.env.DASHBOARD_PASSWORD?.trim() ?? "";
    case "TELEGRAM_BOT_TOKEN":
      return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
    case "TELEGRAM_BROADCAST_CHAT":
      return process.env.TELEGRAM_BROADCAST_CHAT?.trim() ?? "";
    case "NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME":
      return process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME?.trim() ?? "";
    case "NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL":
      return process.env.NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL?.trim() ?? "";
    case "NODE_ENV":
      return process.env.NODE_ENV?.trim() ?? "";
    case "ENABLE_CHAIN_XRP":
      return process.env.ENABLE_CHAIN_XRP?.trim() ?? "";
    case "ENABLE_CHAIN_TRX":
      return process.env.ENABLE_CHAIN_TRX?.trim() ?? "";
    case "ENABLE_CHAIN_BTC":
      return process.env.ENABLE_CHAIN_BTC?.trim() ?? "";
    case "ENABLE_CHAIN_DOGE":
      return process.env.ENABLE_CHAIN_DOGE?.trim() ?? "";
    default:
      return "";
  }
}

function envEnabled(name: string, fallback = false): boolean {
  const value = envText(name).toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

function latestTimestampFromIterable(
  values: Iterable<string | undefined | null>,
): string | undefined {
  let latest: { value: string; time: number } | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = parseDateTimeSafe(value);
    if (parsed == null) {
      continue;
    }
    if (!latest || parsed > latest.time) {
      latest = { value, time: parsed };
    }
  }
  return latest?.value;
}

function latestTimestamp(...values: Array<string | undefined | null>): string | undefined {
  return latestTimestampFromIterable(values);
}

function minutesSince(value: string | undefined, nowMs = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const parsed = parseDateTimeSafe(value);
  if (parsed == null) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - parsed) / 60000));
}

function secondsSince(value: string | undefined, nowMs = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const parsed = parseDateTimeSafe(value);
  if (parsed == null) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - parsed) / 1000));
}

let optionalAccessTokenPromise: Promise<string> | null = null;

async function getOptionalSheetsAccessToken(): Promise<string> {
  if (!optionalAccessTokenPromise) {
    const env = getDashboardEnv();
    const auth = new JWT({
      email: env.credentials.client_email,
      key: env.credentials.private_key,
      scopes: [...SHEETS_SCOPES],
      projectId: env.credentials.project_id,
      subject: undefined,
    });

    optionalAccessTokenPromise = auth.authorize().then((tokens) => {
      const token = tokens.access_token;
      if (!token) {
        throw new Error("Failed to authorize Google Sheets client");
      }
      return token;
    });
  }

  return optionalAccessTokenPromise;
}

function rowHasMeaningfulContent(row: OptionalSheetRow): boolean {
  return Object.values(row).some((value) => compactString(value) !== "");
}

async function readOptionalSheetRows(tabName: string): Promise<OptionalSheetRow[]> {
  try {
    const env = getDashboardEnv();
    const token = await getOptionalSheetsAccessToken();
    const range = `${tabName}!${OPTIONAL_TAB_RANGE}`;
    const url = new URL(`${SHEETS_API_BASE}/${env.sheetId}/values/${encodeURIComponent(range)}`);
    url.searchParams.set("majorDimension", "ROWS");
    url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const text = `${response.status} ${response.statusText} ${body}`.toLowerCase();
      if (text.includes("unable to parse range") || text.includes("range") || text.includes("not found")) {
        return [];
      }
      throw new Error(`Optional Sheets tab request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { values?: string[][] };
    const values = payload.values ?? [];
    if (values.length <= 1) {
      return [];
    }

    const headers = values[0].map((value) => compactString(value));
    return values
      .slice(1)
      .map((rawRow) => {
        const row: OptionalSheetRow = {};
        headers.forEach((header, index) => {
          if (header) {
            row[header] = rawRow[index] ?? "";
          }
        });
        return row;
      })
      .filter(rowHasMeaningfulContent);
  } catch (error) {
    console.warn(
      `[metrics] Optional tab ${tabName} unavailable`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

async function readWatchedAddressRows(): Promise<WatchedAddressRow[]> {
  const rows = await readOptionalSheetRows("watched_addresses");
  return rows.map((row) => ({
    address: row.address ?? "",
    chain: row.chain ?? "",
    category: row.category ?? "",
    label: row.label ?? "",
    source: row.source ?? "",
    confidence: row.confidence ?? "",
    enabled: row.enabled ?? "",
    added_at: row.added_at ?? "",
    notes: row.notes ?? "",
  }));
}

function rowValue(row: OptionalSheetRow | null | undefined, keys: string[]): string {
  if (!row) {
    return "";
  }
  for (const key of keys) {
    const value = compactString(row[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function parseServiceHealthStatus(value: string): ServiceHealthRow["status"] {
  switch (value.trim().toLowerCase()) {
    case "healthy":
    case "ok":
    case "live":
      return "healthy";
    case "degraded":
    case "warn":
    case "warning":
    case "stale":
      return "degraded";
    case "waiting":
    case "idle":
      return "waiting";
    case "down":
    case "error":
    case "failed":
      return "down";
    case "config_required":
    case "missing_config":
    case "auth_required":
      return "config_required";
    default:
      return "unknown";
  }
}

function parseChainList(value: string): string[] {
  return value
    .split(/[,\n|]/)
    .map((item) => compactString(item).toUpperCase())
    .filter(Boolean);
}

function parseEnvFlag(name: string | null): boolean {
  if (!name) {
    return true;
  }
  const raw = process.env[name];
  if (raw == null) {
    return false;
  }
  return compactString(raw).toLowerCase() === "true" || compactString(raw) === "1";
}

function canonicalWatchChain(value: string): string {
  const raw = compactString(value).toLowerCase();
  if (!raw) {
    return "";
  }
  return CHAIN_ALIASES[raw] ?? raw.toUpperCase();
}

function normalizeChainCoverageEntry(
  chain: unknown,
  count: unknown,
): AdminChainCoverageEntry | null {
  const chainName = compactString(String(chain ?? "")).toUpperCase();
  if (!chainName) {
    return null;
  }

  if (typeof count === "number" && Number.isFinite(count)) {
    return { chain: chainName, count };
  }

  if (typeof count === "string" && count.trim()) {
    const parsed = Number(count);
    return {
      chain: chainName,
      count: Number.isFinite(parsed) ? parsed : null,
    };
  }

  return { chain: chainName, count: null };
}

function parseChainCoverageEntries(value: string): AdminChainCoverageEntry[] {
  const compactValue = compactString(value);
  if (!compactValue) {
    return [];
  }

  const fromJson = parseJsonSafe<unknown>(compactValue);
  if (fromJson && typeof fromJson === "object") {
    if (Array.isArray(fromJson)) {
      return fromJson
        .map((item) => {
          if (typeof item === "string") {
            const [chain, count] = item.split(/[:=]/, 2);
            return normalizeChainCoverageEntry(chain, count);
          }
          if (!item || typeof item !== "object") {
            return null;
          }
          const record = item as Record<string, unknown>;
          return normalizeChainCoverageEntry(
            record.chain ?? record.name ?? record.id,
            record.count ?? record.value,
          );
        })
        .filter((item): item is AdminChainCoverageEntry => item !== null);
    }

    return Object.entries(fromJson)
      .map(([chain, count]) => normalizeChainCoverageEntry(chain, count))
      .filter((item): item is AdminChainCoverageEntry => item !== null);
  }

  return compactValue
    .split(/[,\n|]/)
    .map((item) => compactString(item))
    .filter(Boolean)
    .map((item) => {
      const pair = item.match(/^([A-Za-z0-9_-]+)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/);
      if (pair) {
        return normalizeChainCoverageEntry(pair[1], pair[2]);
      }

      const tokens = item.split(/\s+/, 2);
      if (tokens.length === 2) {
        return normalizeChainCoverageEntry(tokens[0], tokens[1]);
      }

      return normalizeChainCoverageEntry(item, null);
    })
    .filter((item): item is AdminChainCoverageEntry => item !== null);
}

function parseServiceHealthRow(row: OptionalSheetRow | null | undefined): ServiceHealthRow | null {
  if (!row) {
    return null;
  }

  const ts = rowValue(row, ["ts", "updated_at", "created_at"]);
  const service = rowValue(row, ["service", "service_name"]);
  const component = rowValue(row, ["component", "name"]);

  if (!ts && !service && !component) {
    return null;
  }

  const processedCount = rowNumber(row, ["processed_count"]);
  const lagSeconds = rowNumber(row, ["lag_seconds"]);
  const durationMs = rowNumber(row, ["duration_ms"]);
  const supportedChains = parseChainList(rowValue(row, ["supported_chains"]));
  const unsupportedChainCount = rowNumber(row, ["unsupported_chain_count"]);
  const unsupportedChains = parseChainCoverageEntries(
    rowValue(row, ["unsupported_chain_names"]),
  );
  const perChainEventCount = parseChainCoverageEntries(
    rowValue(row, ["per_chain_event_count"]),
  );

  return {
    ts,
    service,
    component,
    status: parseServiceHealthStatus(rowValue(row, ["status", "state"])),
    heartbeatKey: rowValue(row, ["heartbeat_key"]) || undefined,
    details: rowValue(row, ["details", "detail", "message"]) || undefined,
    error: rowValue(row, ["error", "hint"]) || undefined,
    instanceId: rowValue(row, ["instance_id"]) || undefined,
    jobName: rowValue(row, ["job_name"]) || undefined,
    lastSuccessAt: rowValue(row, ["last_success_at"]) || undefined,
    lastFailureAt: rowValue(row, ["last_failure_at"]) || undefined,
    ...(processedCount == null ? {} : { processedCount }),
    ...(lagSeconds == null ? {} : { lagSeconds }),
    ...(durationMs == null ? {} : { durationMs }),
    sourceName: rowValue(row, ["source_name", "source", "origin"]) || undefined,
    ...(supportedChains.length === 0 ? {} : { supportedChains }),
    ...(unsupportedChainCount == null ? {} : { unsupportedChainCount }),
    ...(unsupportedChains.length === 0 ? {} : { unsupportedChains }),
    ...(perChainEventCount.length === 0 ? {} : { perChainEventCount }),
  };
}

function buildChainCoverageObservability(
  serviceHealthRows: OptionalSheetRow[],
): AdminChainCoverageObservability | null {
  const coverageRows = newestFirst(serviceHealthRows, (candidate) => {
    const parsed = parseServiceHealthRow(candidate);
    return (
      parseDateTimeSafe(parsed?.lastSuccessAt ?? "") ??
      parseDateTimeSafe(parsed?.ts ?? "") ??
      0
    );
  })
    .map((candidate) => parseServiceHealthRow(candidate))
    .filter((row): row is ServiceHealthRow => row !== null)
    .filter((row) => serviceHealthAliases(row).some((alias) => ["pipeline", "run_all", "signals"].includes(alias)))
    .filter((row) => {
      return (
        (row.supportedChains?.length ?? 0) > 0 ||
        (row.unsupportedChainCount ?? 0) > 0 ||
        (row.unsupportedChains?.length ?? 0) > 0 ||
        (row.perChainEventCount?.length ?? 0) > 0
      );
    });
  const row = coverageRows[0] ?? null;
  if (!row) {
    return null;
  }

  const supportedChains = row.supportedChains ?? [];
  const unsupportedChains = row.unsupportedChains ?? [];
  const perChainEventCount = row.perChainEventCount ?? [];
  const unsupportedChainCount =
    row.unsupportedChainCount ??
    unsupportedChains.reduce((sum, item) => sum + Math.max(0, item.count ?? 0), 0);

  const hasCoverage =
    supportedChains.length > 0 ||
    unsupportedChainCount > 0 ||
    unsupportedChains.length > 0 ||
    perChainEventCount.length > 0;

  if (!hasCoverage) {
    return null;
  }

  return {
    observedAt: latestTimestamp(row.lastSuccessAt, row.ts),
    source:
      row.sourceName ||
      row.heartbeatKey ||
      row.jobName ||
      row.component ||
      row.service ||
      "service_health",
    supportedChains,
    unsupportedChainCount,
    unsupportedChains,
    perChainEventCount,
  };
}

function buildChainRolloutObservability(args: {
  watchedAddressRows: WatchedAddressRow[];
  chainCoverage: AdminChainCoverageObservability | null;
}): AdminChainRolloutObservability {
  const seedCounts = new Map<string, number>();
  for (const row of args.watchedAddressRows) {
    const enabledValue = compactString(row.enabled).toLowerCase();
    if (enabledValue === "false" || enabledValue === "0" || enabledValue === "no") {
      continue;
    }
    const chain = canonicalWatchChain(row.chain);
    if (!chain) {
      continue;
    }
    seedCounts.set(chain, (seedCounts.get(chain) ?? 0) + 1);
  }

  const eventCounts = new Map<string, number>();
  for (const entry of args.chainCoverage?.perChainEventCount ?? []) {
    if (!entry.chain || entry.count == null) {
      continue;
    }
    eventCounts.set(canonicalWatchChain(entry.chain), entry.count);
  }

  const supportedChains = new Set(
    (args.chainCoverage?.supportedChains ?? [])
      .map((chain) => canonicalWatchChain(chain))
      .filter(Boolean),
  );
  const latestWatchedSeedAt = latestTimestampFromIterable(
    args.watchedAddressRows
      .map((row) => compactString(row.added_at) || undefined)
      .filter((value): value is string => Boolean(value)),
  );
  const chains = new Set<string>([
    ...CHAIN_ROLLOUT_ORDER,
    ...seedCounts.keys(),
    ...eventCounts.keys(),
    ...supportedChains.values(),
  ]);

  const entries: AdminChainRolloutEntry[] = Array.from(chains)
    .sort((left, right) => {
      const leftIndex = CHAIN_ROLLOUT_INDEX.get(left);
      const rightIndex = CHAIN_ROLLOUT_INDEX.get(right);
      if (leftIndex != null && rightIndex != null) {
        return leftIndex - rightIndex;
      }
      if (leftIndex != null) {
        return -1;
      }
      if (rightIndex != null) {
        return 1;
      }
      return left.localeCompare(right, "en");
    })
    .map((chain) => {
      const config = CHAIN_ROLLOUT_CONFIG[chain] ?? {
        collectorMode: supportedChains.has(chain) ? "always_on" : "unmanaged",
        partialView: false,
      };
      const collectorEnabled =
        config.collectorMode === "always_on"
          ? true
          : config.collectorMode === "env_flag"
            ? parseEnvFlag(config.envName ?? null)
            : false;
      const seedAddressCount = seedCounts.get(chain) ?? 0;
      const recentEventCount = eventCounts.get(chain) ?? null;

      let status: AdminChainRolloutStatus = "idle";
      let statusLabel = "플래그와 seed address가 모두 대기 상태입니다";

      if (config.collectorMode === "unmanaged") {
        status = "unmanaged";
        statusLabel =
          seedAddressCount > 0
            ? "시드는 있지만 대시보드 rollout 매핑이 없습니다"
            : "미관리 체인";
      } else if (seedAddressCount > 0 && !collectorEnabled) {
        status = "seed_flag_off";
        statusLabel = `${config.envName ?? "collector"}가 꺼져 있어 수집되지 않습니다`;
      } else if (
        seedAddressCount === 0 &&
        collectorEnabled &&
        config.collectorMode === "env_flag"
      ) {
        status = "flag_on_no_seed";
        statusLabel = `${config.envName ?? "collector"}는 켜졌지만 seed address가 없습니다`;
      } else if (seedAddressCount > 0 && collectorEnabled) {
        status = recentEventCount != null && recentEventCount > 0 ? "collecting" : "seed_ready";
        statusLabel =
          status === "collecting"
            ? config.partialView
              ? "부분 관측으로 최근 이벤트를 수집 중"
              : "최근 이벤트가 정상 수집됨"
            : config.partialView
              ? "부분 관측 준비 완료, 최근 이벤트만 없었습니다"
              : "준비 완료, 최근 이벤트만 없었습니다";
      } else if (config.collectorMode === "always_on") {
        status = "idle";
        statusLabel = "상시 수집기지만 현재 seed address가 없습니다";
      }

      return {
        chain,
        seedAddressCount,
        collectorEnabled,
        collectorMode: config.collectorMode,
        flagEnvName: config.envName,
        partialView: config.partialView,
        recentEventCount,
        status,
        statusLabel,
      };
    });

  return {
    observedAt: latestTimestamp(args.chainCoverage?.observedAt, latestWatchedSeedAt),
    source: args.chainCoverage?.source
      ? `${args.chainCoverage.source} + watched_addresses + env`
      : "watched_addresses + env",
    seedButFlagDisabled: entries
      .filter((entry) => entry.status === "seed_flag_off")
      .map((entry) => entry.chain),
    flagEnabledButNoSeed: entries
      .filter((entry) => entry.status === "flag_on_no_seed")
      .map((entry) => entry.chain),
    entries,
  };
}

function serviceHealthAliases(row: ServiceHealthRow | null): string[] {
  if (!row) {
    return [];
  }

  const tokens = [
    row.service,
    row.component,
    row.service && row.component ? `${row.service}.${row.component}` : "",
    row.heartbeatKey,
    row.jobName,
    row.sourceName,
  ];

  return tokens
    .map((value) => compactString(value).toLowerCase())
    .filter(Boolean);
}

function describeServiceHealthMetrics(row: ServiceHealthRow | null): string | undefined {
  if (!row) {
    return undefined;
  }

  const segments: string[] = [];

  if (row.lastSuccessAt) {
    segments.push(`최근 성공: ${row.lastSuccessAt}`);
  }

  if (row.lastFailureAt) {
    segments.push(`최근 실패: ${row.lastFailureAt}`);
  }

  if (row.processedCount != null) {
    segments.push(`처리 ${row.processedCount}건`);
  }

  if (row.lagSeconds != null) {
    segments.push(`지연 ${row.lagSeconds}s`);
  }

  if (row.durationMs != null) {
    segments.push(`소요 ${row.durationMs}ms`);
  }

  if (row.instanceId) {
    segments.push(`인스턴스 ${row.instanceId}`);
  }

  if (row.sourceName) {
    segments.push(`소스 ${row.sourceName}`);
  }

  return segments.length > 0 ? segments.join(" · ") : undefined;
}

function latestSystemLog(rows: SystemLogRow[]): SystemLogRow | null {
  if (rows.length === 0) {
    return null;
  }

  return newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
  })[0] ?? null;
}

function latestPipelineLog(rows: SystemLogRow[]): SystemLogRow | null {
  const pipelineRows = rows.filter((row) => PIPELINE_RUN_TYPES.has(row.run_type));
  return latestSystemLog(pipelineRows);
}

function latestListenerLog(rows: SystemLogRow[]): SystemLogRow | null {
  const listenerRows = rows.filter((row) => row.run_type === "telethon_listener");
  return latestSystemLog(listenerRows);
}

function latestTgWhaleEvent(rows: TgWhaleEventRow[]): TgWhaleEventRow | null {
  if (rows.length === 0) {
    return null;
  }

  return newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.collected_at) ?? parseDateTimeSafe(row.tg_date);
  })[0] ?? null;
}

function latestBrief(rows: DailyBriefRow[]): DailyBriefRow | null {
  if (rows.length === 0) {
    return null;
  }

  return newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.date);
  })[0] ?? null;
}

function latestOptionalRow(rows: OptionalSheetRow[], keys: string[]): OptionalSheetRow | null {
  if (rows.length === 0) {
    return null;
  }

  return newestFirst(rows, (row) => {
    const value = rowValue(row, keys);
    return parseDateTimeSafe(value);
  })[0] ?? null;
}

function earliestOptionalRow(rows: OptionalSheetRow[], keys: string[]): OptionalSheetRow | null {
  let earliest: { row: OptionalSheetRow; time: number } | null = null;

  for (const row of rows) {
    const parsed = parseDateTimeSafe(rowValue(row, keys));
    if (parsed == null) {
      continue;
    }
    if (!earliest || parsed < earliest.time) {
      earliest = { row, time: parsed };
    }
  }

  return earliest?.row ?? null;
}

function findServiceHealthOverride(
  rows: OptionalSheetRow[],
  aliases: string[],
): OptionalSheetRow | null {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  const candidates = rows.filter((row) => {
    const parsed = parseServiceHealthRow(row);
    return serviceHealthAliases(parsed).some((alias) => normalizedAliases.includes(alias));
  });
  return latestOptionalRow(candidates, ["last_success_at", "checked_at", "updated_at", "ts", "created_at"]);
}

function parseSourceFailureKind(errorMessage: string): SourceFailureKind | null {
  const text = errorMessage.toLowerCase();
  if (!text) {
    return null;
  }
  if (text.includes("auth") || text.includes("permission") || text.includes("unauthorized")) {
    return "auth";
  }
  if (text.includes("quota") || text.includes("rate")) {
    return "quota";
  }
  if (text.includes("schema") || text.includes("header") || text.includes("column")) {
    return "schema";
  }
  if (text.includes("network") || text.includes("timeout") || text.includes("connection")) {
    return "network";
  }
  return "unknown";
}

function detailsPayload(row: SystemLogRow | null): Record<string, unknown> {
  if (!row) {
    return {};
  }

  const parsed = parseJsonSafe<Record<string, unknown>>(row.details);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const payload = parsed.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  return parsed;
}

function normalizeListenerHealth(
  systemLogs: SystemLogRow[],
  tgEvents: TgWhaleEventRow[],
  generatedAt: string
): ListenerHealth {
  const latest = latestListenerLog(systemLogs);
  if (!latest) {
    const latestEvent = latestTgWhaleEvent(tgEvents);
    if (!latestEvent) {
      return {
        status: "unknown",
        label: "확인 필요",
        message: "Telegram listener heartbeat 또는 tg_whale_events 기록이 아직 없습니다.",
      };
    }

    const updatedAt = latestEvent.collected_at || latestEvent.tg_date || generatedAt;
    const updatedAtMs = parseDateTimeSafe(updatedAt);
    const ageMinutes = updatedAtMs == null ? null : (Date.now() - updatedAtMs) / 60000;

    if (ageMinutes != null && ageMinutes > LISTENER_STALE_MINUTES) {
      return {
        status: "attention",
        label: "확인 필요",
        message: `listener heartbeat는 없지만 최신 tg_whale_events 기록이 ${LISTENER_STALE_MINUTES}분을 넘었습니다.`,
        updatedAt,
        event: "tg_whale_events",
      };
    }

    return {
      status: "ok",
      label: "정상",
      message: "listener heartbeat는 없지만 최신 tg_whale_events 기록으로 활동이 확인됩니다.",
      updatedAt,
      event: "tg_whale_events",
    };
  }

  const updatedAt = latest.finished_at || latest.started_at || generatedAt;
  const updatedAtMs = parseDateTimeSafe(updatedAt);
  const ageMinutes = updatedAtMs == null ? null : (Date.now() - updatedAtMs) / 60000;
  const payload = detailsPayload(latest);
  const event = compactString(payload.event);
  const reason = compactString(payload.reason);

  if (latest.status === "error" && (event === "auth_error" || reason.includes("auth"))) {
    return {
      status: "auth_required",
      label: "인증 필요",
      message: "Telethon 세션 인증이 필요합니다. TELETHON_SESSION_STRING 또는 최초 로그인 상태를 확인하세요.",
      updatedAt,
      event,
    };
  }

  if (latest.status === "error") {
    return {
      status: "attention",
      label: "확인 필요",
      message: "Telegram listener 처리 중 오류가 기록되었습니다. Render 로그와 system_log를 확인하세요.",
      updatedAt,
      event,
    };
  }

  if (ageMinutes != null && ageMinutes > LISTENER_STALE_MINUTES) {
    return {
      status: "attention",
      label: "확인 필요",
      message: `최근 ${LISTENER_STALE_MINUTES}분 이내 listener heartbeat가 없습니다.`,
      updatedAt,
      event,
    };
  }

  if (event === "message_processed") {
    const symbol = compactString(payload.symbol);
    const chain = compactString(payload.blockchain);
    return {
      status: "ok",
      label: "정상",
      message: [symbol, chain].filter(Boolean).length
        ? `최근 ${[symbol, chain].filter(Boolean).join(" / ")} 이벤트를 수집했습니다.`
        : "최근 Telegram whale 이벤트를 수집했습니다.",
      updatedAt,
      event,
    };
  }

  return {
    status: "waiting",
    label: "대기 중",
    message: "Telegram listener가 실행 중이며 채널 메시지를 기다리고 있습니다.",
    updatedAt,
    event,
  };
}

function normalizeLatestRun(row: SystemLogRow): LatestRunSummary {
  const transactionsCount = parseIntSafe(compactString(row.transactions_count));
  const errorText = compactString(row.errors);
  const errors = parseIntSafe(errorText) ?? (errorText || null);
  // IMPORTANT: we always return `details` as a bounded string. Forwarding raw
  // parsed JSON here can leak unbounded/deeply-nested payloads to the RSC
  // client and trigger "Maximum call stack size exceeded" during React's
  // server→client console replay (see comment on `LatestRunSummary.details`).
  const parsedDetails = parseJsonSafe(row.details);
  const details = safeStringifyBounded(parsedDetails ?? row.details, 1000);

  return {
    run_id: row.run_id,
    run_type: row.run_type,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    transactions_count: transactionsCount,
    errors,
    details,
  };
}

function errorCountForRun(row: SystemLogRow | null): number {
  if (!row) {
    return 0;
  }

  const errors = compactString(row.errors);
  if (!errors) {
    return 0;
  }

  const parsed = parseJsonSafe<unknown>(errors);
  if (Array.isArray(parsed)) {
    return parsed.length;
  }
  const parsedCount = parseIntSafe(errors);
  return parsedCount ?? 1;
}

function normalizeTopTransactions(row: DailyBriefRow | null): DashboardBrief["topTransactions"] {
  if (!row) {
    return [];
  }

  const parsed = parseJsonSafe<unknown>(row.top_transactions);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const amountUsd = parseFloatSafe(String(record.amount_usd ?? record.amountUsd ?? ""));
      return {
        symbol: compactString(String(record.symbol ?? "")) || "UNKNOWN",
        amountUsd: amountUsd ?? 0,
        chain: compactString(String(record.chain ?? record.blockchain ?? "")) || "Unknown",
      };
    })
    .filter((item): item is DashboardBrief["topTransactions"][number] => item !== null);
}

function normalizeStringList(value: string | undefined): string[] {
  const raw = compactString(value);
  if (!raw) {
    return [];
  }

  const parsed = parseJsonSafe<unknown>(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => compactString(String(item)))
      .filter(Boolean);
  }

  return raw
    .split(/[,\n|]/)
    .map((item) => compactString(item))
    .filter(Boolean);
}

function normalizeDashboardSignal(row: SignalRow): DisplaySignalRow {
  const extra = parseJsonSafe<Record<string, unknown>>(row.extra_json) ?? {};
  const rawRelatedWallets = Array.isArray(extra.related_wallets)
    ? extra.related_wallets
    : [];
  const rawRelatedAssets = Array.isArray(extra.related_assets)
    ? extra.related_assets
    : [];

  return {
    id: compactString(row.signal_id) || compactString(row.created_at),
    createdAt: compactString(row.created_at),
    rule: compactString(row.rule) || "signal",
    severity: compactString(row.severity) || "unknown",
    score: parseFloatSafe(compactString(row.score)) ?? 0,
    confidence: compactString(row.confidence) || undefined,
    source: compactString(row.source) || "system",
    summary: compactString(row.summary) || "",
    evidenceTxHashes: normalizeStringList(row.evidence_tx_hashes),
    windowStart: compactString(row.window_start) || undefined,
    windowEnd: compactString(row.window_end) || undefined,
    narrativeAi:
      compactString(String(extra.narrative_ai ?? extra.narrativeAi ?? "")) || undefined,
    relatedWallets: rawRelatedWallets
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const address = compactString(String(record.address ?? ""));
        if (!address) {
          return null;
        }
        return {
          address,
          label: compactString(String(record.label ?? "")) || undefined,
          chain: compactString(String(record.chain ?? "")) || undefined,
        };
      })
      .filter((item): item is NonNullable<DisplaySignalRow["relatedWallets"]>[number] => Boolean(item)),
    relatedAssets: rawRelatedAssets
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const symbol = compactString(String(record.symbol ?? ""));
        if (!symbol) {
          return null;
        }
        return {
          symbol,
          direction: compactString(String(record.direction ?? "")) || undefined,
        };
      })
      .filter((item): item is NonNullable<DisplaySignalRow["relatedAssets"]>[number] => Boolean(item)),
  };
}

function normalizeBriefMarketMoodDriver(value: unknown): BriefMarketMood["drivers"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const label = compactString(String(row.label ?? ""));
  const valueText = compactString(String(row.value ?? ""));
  if (!label || !valueText) {
    return null;
  }

  return {
    label,
    value: valueText,
    direction: compactString(String(row.direction ?? "")) || undefined,
  };
}

function normalizeBriefMarketMood(value: unknown): BriefMarketMood | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  const mood = compactString(String(row.mood ?? ""));
  if (!mood) {
    return undefined;
  }

  const drivers = Array.isArray(row.drivers)
    ? row.drivers
        .map((item) => normalizeBriefMarketMoodDriver(item))
        .filter((item): item is BriefMarketMood["drivers"][number] => item !== null)
    : [];

  return {
    mood,
    score: parseFloatSafe(compactString(String(row.score ?? ""))) ?? 0,
    drivers,
    asOf: compactString(String(row.as_of ?? row.asOf ?? "")) || undefined,
  };
}

function parseBriefNote(value: string | undefined): {
  note?: string;
  noteRaw?: string;
  marketMood?: BriefMarketMood;
} {
  const noteRaw = compactString(value);
  if (!noteRaw) {
    return {};
  }

  const [notePart, metaPart] = noteRaw.split("||meta:", 2);
  const messageMarker = "|message=";
  const markerIndex = notePart.indexOf(messageMarker);
  const note =
    markerIndex >= 0
      ? compactString(notePart.slice(markerIndex + messageMarker.length))
      : compactString(notePart);

  const meta = metaPart ? parseJsonSafe<Record<string, unknown>>(metaPart) : null;

  return {
    note: note || undefined,
    noteRaw,
    marketMood: normalizeBriefMarketMood(meta?.market_mood),
  };
}

function normalizeBrief(row: DailyBriefRow | null): DashboardBrief | null {
  if (!row) {
    return null;
  }

  const parsedNote = parseBriefNote(row.note);

  return {
    date: row.date || undefined,
    generatedAt: row.created_at || undefined,
    summary: row.summary,
    alertCount: parseIntSafe(compactString(row.alert_count)) ?? 0,
    totalVolumeUsd: parseFloatSafe(compactString(row.total_volume_usd)) ?? 0,
    highlights: normalizeStringList(row.highlights),
    signalThemes: normalizeStringList(row.signal_themes),
    note: parsedNote.note,
    noteRaw: parsedNote.noteRaw,
    marketMood: parsedNote.marketMood,
    topTransactions: normalizeTopTransactions(row),
  };
}

function humanizeLogMessage(row: SystemLogRow): string {
  const details = compactString(row.details);
  if (details) {
    try {
      const parsed = JSON.parse(details);
      if (typeof parsed === "object" && parsed !== null) {
        const parts: string[] = [];
        if (parsed.stage) parts.push(`[${parsed.stage}]`);
        if (parsed.message) parts.push(parsed.message);
        if (parsed.event) parts.push(parsed.event);
        if (parsed.count) parts.push(`(${parsed.count}건 처리)`);
        if (parts.length > 0) return parts.join(" ");
      }
    } catch {
      // not JSON, use as-is with truncation
    }
    return details.length > 120 ? details.slice(0, 120) + "..." : details;
  }
  return "";
}

function normalizeSystemLogRows(rows: SystemLogRow[]) {
  return rows.map((row) => {
    const errorCount = errorCountForRun(row);
    const humanized = humanizeLogMessage(row);
    // IMPORTANT: only forward lean display-safe fields to the RSC client.
    // Previously this spread `...normalizeLatestRun(row)` which leaked a
    // raw (potentially huge / deeply-nested) `details` payload into every
    // system log entry, triggering "Maximum call stack size exceeded" during
    // React's server→client console replay. Keep the shape aligned with
    // `DisplaySystemLogRow` in lib/types.ts.
    return {
      id: row.run_id,
      timestamp: row.finished_at || row.started_at,
      status: row.status,
      title: row.run_type || "Pipeline run",
      message:
        humanized ||
        (errorCount > 0 ? `${errorCount}건 오류 발생` : "정상 완료"),
      errorCount,
      updatedAt: row.finished_at || row.started_at,
    };
  });
}

function summarizeNewsRss(row: SystemLogRow | null): {
  summary?: string;
  detail?: string;
} {
  if (!row) {
    return {};
  }

  const details = parseJsonSafe<Record<string, unknown>>(row.details);
  const feedsOk = parseIntSafe(compactString(String(details?.feeds_ok ?? ""))) ?? 0;
  const feedsFailed = parseIntSafe(compactString(String(details?.feeds_failed ?? ""))) ?? 0;
  const itemsNew = parseIntSafe(compactString(String(details?.items_new ?? ""))) ?? 0;
  const updatedAt = row.finished_at || row.started_at;

  const summary =
    feedsOk || feedsFailed
      ? feedsFailed > 0
        ? `news_rss는 ${feedsOk}개 피드 정상, ${feedsFailed}개 피드 실패 상태입니다. 신규 기사 ${itemsNew}건을 적재했습니다.`
        : `news_rss는 ${feedsOk}개 피드를 정상 수집했고 신규 기사 ${itemsNew}건을 적재했습니다.`
      : undefined;

  const detail = updatedAt
    ? `최근 news_rss 시각: ${updatedAt}`
    : undefined;

  return {
    summary,
    detail,
  };
}

function normalizeOpsStatusValue(
  value: string,
  fallback: OpsServiceStatus,
): OpsServiceStatus {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "healthy":
    case "ok":
    case "connected":
    case "live":
      return "healthy";
    case "degraded":
    case "warn":
    case "warning":
    case "stale":
      return "degraded";
    case "down":
    case "error":
    case "failed":
      return "down";
    case "waiting":
    case "idle":
    case "shadow":
      return "waiting";
    case "config_required":
    case "missing_config":
    case "auth_required":
      return "config_required";
    default:
      return fallback;
  }
}

function withOptionalServiceOverride(
  name: OpsServiceName,
  fallback: OpsServiceHealth,
  overrideRow: OptionalSheetRow | null,
): OpsServiceHealth {
  if (!overrideRow) {
    return fallback;
  }

  const parsed = parseServiceHealthRow(overrideRow);
  const updatedAt = latestTimestamp(
    parsed?.lastSuccessAt,
    parsed?.lastFailureAt,
    parsed?.ts,
    rowValue(overrideRow, ["checked_at", "updated_at", "created_at"]),
  );
  const metricsDetail = describeServiceHealthMetrics(parsed);
  const summaryOverride =
    rowValue(overrideRow, ["summary", "message", "detail"]) ||
    parsed?.details ||
    fallback.summary;
  const detailSegments = [
    rowValue(overrideRow, ["detail", "error", "hint"]) || parsed?.error || fallback.detail,
    metricsDetail,
  ].filter(Boolean);

  return {
    ...fallback,
    name,
    label: rowValue(overrideRow, ["label", "state_label", "status_label"]) || fallback.label,
    status: normalizeOpsStatusValue(
      rowValue(overrideRow, ["status", "state"]),
      fallback.status,
    ),
    summary: summaryOverride,
    detail: detailSegments.join(" · "),
    updatedAt: updatedAt || fallback.updatedAt,
    source:
      rowValue(overrideRow, ["source", "origin"]) ||
      parsed?.sourceName ||
      fallback.source,
  };
}

function renderApiErrorMessage(error: RenderApiError | undefined): string {
  if (!error) {
    return "Render API 상태를 아직 확인하지 못했습니다.";
  }

  switch (error.code) {
    case "config_missing":
      return `Render API 연동에 필요한 env가 누락되었습니다: ${error.missingEnv.join(", ")}`;
    case "auth_failed":
      return "Render API 인증에 실패했습니다. RENDER_API_KEY 만료 또는 삭제 가능성이 있습니다.";
    case "forbidden":
      return "Render API 권한이 부족합니다. key scope 또는 owner 접근 권한을 확인하세요.";
    case "not_found":
      return "Render 리소스를 찾지 못했습니다. 서비스 ID 또는 owner 연결을 확인하세요.";
    case "bad_request":
      return "Render API 요청 형식 오류가 발생했습니다. 서비스 식별자와 요청 파라미터를 확인하세요.";
    case "rate_limited":
      return error.retryAfterMs != null
        ? `Render API rate limit에 도달했습니다. 약 ${Math.ceil(error.retryAfterMs / 1000)}초 후 재시도합니다.`
        : "Render API rate limit에 도달했습니다. 잠시 후 다시 조회하세요.";
    case "upstream":
      return `Render API 상류 오류(${error.httpStatus})가 발생했습니다.`;
    case "network":
      return "Render API 네트워크 오류가 발생했습니다. 일시적 연결 문제일 수 있습니다.";
    case "timeout":
      return `Render API 응답이 ${error.afterMs}ms 안에 도착하지 않았습니다.`;
    case "internal":
      return "Render 통합 내부 오류가 발생했습니다. 서버 로그에서 상세 원인을 확인하세요.";
    default:
      return "Render API 상태를 아직 확인하지 못했습니다.";
  }
}

function renderDeployStatusLabel(
  status: AdminRenderObservability["deploys"][number]["status"] | undefined,
): string | undefined {
  switch (status) {
    case "live":
      return "배포 live";
    case "deploying":
      return "배포 진행 중";
    case "failed":
      return "배포 실패";
    case "inactive":
      return "배포 비활성";
    default:
      return undefined;
  }
}

function renderServiceStatusLabel(
  service: AdminRenderObservability["services"][number],
): string {
  switch (service.status.kind) {
    case "live":
      return "Render live";
    case "deploying":
      return "Render 배포 중";
    case "failed":
      return `Render 배포 실패 (${service.status.reason})`;
    case "suspended":
      return service.status.suspenders.length > 0
        ? `Render suspended (${service.status.suspenders.join(", ")})`
        : "Render suspended";
    case "unknown":
    default:
      return "Render 상태 확인 필요";
  }
}

function renderServiceStatusToOpsStatus(args: {
  service: AdminRenderObservability["services"][number];
  instances: AdminRenderObservability["instances"];
  logs: AdminRenderObservability["logs"];
}): OpsServiceStatus | null {
  switch (args.service.status.kind) {
    case "failed":
    case "suspended":
      return "down";
    case "deploying":
      return "degraded";
    case "unknown":
      return null;
    case "live": {
      const runningInstances = args.instances.filter((instance) => instance.state === "running");
      const errorLogs = args.logs.filter((log) => log.level === "error");
      if (args.service.type === "worker" && args.instances.length > 0 && runningInstances.length === 0) {
        return "degraded";
      }
      if (errorLogs.length > 0) {
        return "degraded";
      }
      return "healthy";
    }
    default:
      return null;
  }
}

function opsStatusPriority(status: OpsServiceStatus): number {
  switch (status) {
    case "healthy":
      return 0;
    case "waiting":
      return 1;
    case "degraded":
      return 2;
    case "config_required":
      return 3;
    case "down":
      return 4;
    default:
      return 0;
  }
}

function chooseMoreSevereStatus(
  current: OpsServiceStatus,
  candidate: OpsServiceStatus | null,
): OpsServiceStatus {
  if (!candidate) {
    return current;
  }

  return opsStatusPriority(candidate) > opsStatusPriority(current) ? candidate : current;
}

function renderStatusLabelForOpsStatus(
  status: OpsServiceStatus,
  fallback: string,
): string {
  switch (status) {
    case "down":
      return fallback.includes("실패") || fallback.includes("suspended") ? fallback : "플랫폼 주의";
    case "degraded":
      return fallback.includes("배포") ? fallback : "플랫폼 주의";
    default:
      return fallback;
  }
}

function mergeRenderServiceHealth(args: {
  base: OpsServiceHealth;
  render: AdminRenderObservability;
  serviceKey: RenderServiceKey;
}): OpsServiceHealth {
  if (args.render.state !== "ready" && args.render.state !== "degraded") {
    return args.base;
  }

  const service = args.render.services.find((item) => item.key === args.serviceKey);

  if (!service) {
    return args.base;
  }

  const relatedInstances = args.render.instances.filter((item) => item.serviceKey === args.serviceKey);
  const relatedLogs = args.render.logs.filter((item) => item.serviceKey === args.serviceKey);
  const platformStatus = renderServiceStatusToOpsStatus({
    service,
    instances: relatedInstances,
    logs: relatedLogs,
  });
  const mergedStatus = chooseMoreSevereStatus(args.base.status, platformStatus);
  const runningInstances = relatedInstances.filter((item) => item.state === "running").length;
  const errorLogs = relatedLogs.filter((item) => item.level === "error").length;
  const warnLogs = relatedLogs.filter((item) => item.level === "warn").length;
  const detailSegments = [
    args.base.detail,
    renderServiceStatusLabel(service),
    renderDeployStatusLabel(service.lastDeployStatus),
    relatedInstances.length > 0
      ? `인스턴스 ${relatedInstances.length}개 (running ${runningInstances})`
      : undefined,
    errorLogs > 0 ? `최근 ${args.render.logWindowMinutes}분 오류 ${errorLogs}건` : undefined,
    warnLogs > 0 ? `warn ${warnLogs}건` : undefined,
    service.lastDeployAt ? `최근 배포: ${service.lastDeployAt}` : undefined,
    service.schedule ? `스케줄: ${service.schedule}` : undefined,
  ].filter(Boolean);
  const summary = [
    args.base.summary,
    renderServiceStatusLabel(service),
    renderDeployStatusLabel(service.lastDeployStatus),
    errorLogs > 0 ? `오류 로그 ${errorLogs}건` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    ...args.base,
    status: mergedStatus,
    label:
      mergedStatus !== args.base.status
        ? renderStatusLabelForOpsStatus(mergedStatus, renderServiceStatusLabel(service))
        : args.base.label,
    summary,
    detail: detailSegments.join(" · "),
    updatedAt: latestTimestamp(
      args.base.updatedAt,
      service.updatedAt,
      service.lastDeployAt,
      args.render.lastLogAt,
    ),
    source: args.base.source ? `${args.base.source} + render` : "render",
  };
}

function buildSourceHealth(args: {
  source: string;
  generatedAt: string;
  latestRunUpdatedAt?: string;
  transactionUpdatedAt?: string;
  signalUpdatedAt?: string;
  briefUpdatedAt?: string;
  latestNewsRssRow?: SystemLogRow | null;
  rowCounts: RowCounts;
}): SourceHealth {
  const lastUpdatedAt =
    latestTimestamp(
      args.latestRunUpdatedAt,
      args.transactionUpdatedAt,
      args.signalUpdatedAt,
      args.briefUpdatedAt,
    ) ?? args.generatedAt;
  const staleMinutes = minutesSince(lastUpdatedAt);
  const totalRows =
    args.rowCounts.transactions +
    args.rowCounts.daily_brief +
    args.rowCounts.signals +
    args.rowCounts.system_log;
  const newsRss = summarizeNewsRss(args.latestNewsRssRow ?? null);

  if (totalRows === 0) {
    return {
      connected: true,
      mode: "live",
      label: "Live Sheets",
      description: [
        "Google Sheets 연결은 되었지만 운영 탭이 아직 비어 있습니다.",
        newsRss.summary,
      ]
        .filter(Boolean)
        .join(" "),
      source: args.source,
      lastUpdatedAt,
      staleMinutes,
      failureKind: "empty",
    };
  }

  if (staleMinutes != null && staleMinutes > SOURCE_STALE_MINUTES) {
    return {
      connected: true,
      mode: "live",
      label: "Stale",
      description: [
        `최근 ${staleMinutes}분 동안 운영 데이터 갱신이 없어 확인이 필요합니다.`,
        newsRss.summary,
      ]
        .filter(Boolean)
        .join(" "),
      source: args.source,
      lastUpdatedAt,
      staleMinutes,
      failureKind: null,
    };
  }

  return {
    connected: true,
    mode: "live",
    label: "Live Sheets",
    description: [
      "Google Sheets 운영 데이터를 정상적으로 읽고 있습니다.",
      newsRss.summary,
    ]
      .filter(Boolean)
      .join(" "),
    source: args.source,
    lastUpdatedAt,
    staleMinutes,
    failureKind: null,
  };
}

function buildPipelineService(args: {
  latestRun: DashboardData["latestRun"];
  overrideRow: OptionalSheetRow | null;
}): OpsServiceHealth {
  const updatedAt = args.latestRun?.updatedAt;
  const ageMinutes = minutesSince(updatedAt);
  let status: OpsServiceStatus = "waiting";
  let label = "대기";
  let summary = "최근 파이프라인 실행 기록이 아직 없습니다.";
  let detail = "system_log에서 최신 파이프라인 run_type을 찾지 못했습니다.";

  if (args.latestRun) {
    summary = args.latestRun.message || "최근 파이프라인 실행을 확인했습니다.";
    detail = updatedAt
      ? `최근 실행 시각: ${updatedAt}`
      : "최근 실행 시각이 기록되지 않았습니다.";

    if (args.latestRun.status.toLowerCase().includes("failed")) {
      status = "down";
      label = "실패";
    } else if (ageMinutes != null && ageMinutes > PIPELINE_DOWN_MINUTES) {
      status = "down";
      label = "정지 추정";
      summary = `최근 ${ageMinutes}분 동안 파이프라인 완료 기록이 없습니다.`;
    } else if (
      args.latestRun.errorCount > 0 ||
      args.latestRun.status.toLowerCase().includes("warn") ||
      args.latestRun.status.toLowerCase().includes("error") ||
      (ageMinutes != null && ageMinutes > PIPELINE_STALE_MINUTES)
    ) {
      status = "degraded";
      label = "주의";
    } else {
      status = "healthy";
      label = "정상";
    }
  }

  return withOptionalServiceOverride(
    "pipeline",
    {
      name: "pipeline",
      title: SERVICE_TITLES.pipeline,
      status,
      label,
      summary,
      detail,
      updatedAt,
      source: "system_log",
    },
    args.overrideRow,
  );
}

function buildListenerService(args: {
  listenerHealth: ListenerHealth;
  overrideRow: OptionalSheetRow | null;
}): OpsServiceHealth {
  const status: OpsServiceStatus =
    args.listenerHealth.status === "ok"
      ? "healthy"
      : args.listenerHealth.status === "auth_required"
        ? "config_required"
        : args.listenerHealth.status === "attention"
          ? "degraded"
          : "waiting";

  return withOptionalServiceOverride(
    "listener",
    {
      name: "listener",
      title: SERVICE_TITLES.listener,
      status,
      label: args.listenerHealth.label,
      summary: args.listenerHealth.message,
      detail:
        args.listenerHealth.updatedAt
          ? `최근 상태 시각: ${args.listenerHealth.updatedAt}`
          : "listener heartbeat 또는 tg_whale_events 기록이 아직 없습니다.",
      updatedAt: args.listenerHealth.updatedAt,
      source: "system_log/tg_whale_events",
    },
    args.overrideRow,
  );
}

function buildBotService(args: {
  subscriberCount: number;
  latestBroadcastLog: SystemLogRow | null;
  latestChannelHealth: OptionalSheetRow | null;
  overrideRow: OptionalSheetRow | null;
}): OpsServiceHealth {
  const tokenConfigured = Boolean(envText("TELEGRAM_BOT_TOKEN"));
  const broadcastChatConfigured = Boolean(
    envText("TELEGRAM_BROADCAST_CHAT") ||
      envText("NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME") ||
      envText("NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL"),
  );
  const broadcastEnabled = envEnabled("TELEGRAM_BROADCAST_ENABLED", false);
  const dryRun = envEnabled("TELEGRAM_BROADCAST_DRY_RUN", true);
  const channelStatus = rowValue(args.latestChannelHealth, ["status"]);
  const channelError = rowValue(args.latestChannelHealth, ["error"]);
  const channelUpdatedAt = rowValue(args.latestChannelHealth, ["ts", "updated_at"]);
  const broadcastUpdatedAt =
    args.latestBroadcastLog?.finished_at || args.latestBroadcastLog?.started_at;

  let status: OpsServiceStatus = "waiting";
  let label = "대기";
  let summary = "Telegram bot 상태를 아직 충분히 확인하지 못했습니다.";
  let detail = "구독자 수, broadcast_daily, channel_health를 함께 봅니다.";

  if (!tokenConfigured) {
    status = "config_required";
    label = "토큰 누락";
    summary = "TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.";
    detail = "구독 봇과 브로드캐스트 모두 동작할 수 없습니다.";
  } else if (!broadcastChatConfigured) {
    status = "config_required";
    label = "채널 미설정";
    summary = "공개 채널 또는 broadcast chat 설정이 없습니다.";
    detail = "TELEGRAM_BROADCAST_CHAT 또는 NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME을 확인하세요.";
  } else if (channelStatus === "error") {
    status = "down";
    label = "채널 오류";
    summary = channelError || "Telegram 공개 채널 헬스 체크가 실패했습니다.";
    detail = channelUpdatedAt
      ? `최근 channel_health 시각: ${channelUpdatedAt}`
      : "channel_health 기록이 없습니다.";
  } else if (!broadcastEnabled || dryRun) {
    status = "waiting";
    label = "Shadow";
    summary = dryRun
      ? "브로드캐스트가 dry-run 상태입니다."
      : "브로드캐스트가 비활성화되어 있습니다.";
    detail = "운영 전환 전 shadow 모드 구성을 유지하고 있습니다.";
  } else if (args.latestBroadcastLog?.status.toLowerCase().includes("failed")) {
    status = "down";
    label = "발송 실패";
    summary = compactString(args.latestBroadcastLog.details) || "최근 broadcast_daily 실행이 실패했습니다.";
    detail = broadcastUpdatedAt
      ? `최근 broadcast_daily 시각: ${broadcastUpdatedAt}`
      : "최근 broadcast_daily 실행 기록이 없습니다.";
  } else if (channelStatus === "ok" || args.subscriberCount > 0) {
    status = "healthy";
    label = "정상";
    summary =
      args.subscriberCount > 0
        ? `${args.subscriberCount.toLocaleString("ko-KR")}명의 구독자에게 알림을 보낼 준비가 되어 있습니다.`
        : "공개 채널과 봇 토큰 구성이 확인되었습니다.";
    detail = channelUpdatedAt
      ? `최근 channel_health 시각: ${channelUpdatedAt}`
      : broadcastUpdatedAt
        ? `최근 broadcast_daily 시각: ${broadcastUpdatedAt}`
        : "최근 bot 헬스 기록이 없습니다.";
  }

  return withOptionalServiceOverride(
    "bot",
    {
      name: "bot",
      title: SERVICE_TITLES.bot,
      status,
      label,
      summary,
      detail,
      updatedAt: latestTimestamp(channelUpdatedAt, broadcastUpdatedAt),
      source: args.latestChannelHealth ? "channel_health" : "subscribers/system_log",
    },
    args.overrideRow,
  );
}

function buildDashboardService(args: {
  sourceHealth: SourceHealth;
  overrideRow: OptionalSheetRow | null;
}): OpsServiceHealth {
  const passwordConfigured = Boolean(envText("DASHBOARD_PASSWORD"));
  const production = envText("NODE_ENV") === "production";

  let status: OpsServiceStatus = args.sourceHealth.connected ? "healthy" : "degraded";
  let label = args.sourceHealth.connected ? "연결됨" : "미리보기";
  let summary = args.sourceHealth.connected
    ? "운영 화면이 실제 데이터를 기반으로 렌더링됩니다."
    : "운영 화면이 fallback preview 상태입니다.";
  const detail = passwordConfigured
    ? "admin API가 세션/패스워드 보호 상태입니다."
    : production
      ? "프로덕션에서 DASHBOARD_PASSWORD 설정이 필요합니다."
      : "개발 모드에서는 패스워드 없이 접근할 수 있습니다.";

  if (production && !passwordConfigured) {
    status = "config_required";
    label = "보호 설정 필요";
    summary = "프로덕션 admin API 보호 비밀번호가 설정되지 않았습니다.";
  }

  return withOptionalServiceOverride(
    "dashboard",
    {
      name: "dashboard",
      title: SERVICE_TITLES.dashboard,
      status,
      label,
      summary,
      detail,
      updatedAt: args.sourceHealth.lastUpdatedAt,
      source: "nextjs",
    },
    args.overrideRow,
  );
}

function buildDataSourceService(args: {
  sourceHealth: SourceHealth;
  overrideRow: OptionalSheetRow | null;
}): OpsServiceHealth {
  let status: OpsServiceStatus = "healthy";
  let label = args.sourceHealth.label;

  if (!args.sourceHealth.connected) {
    status = args.sourceHealth.failureKind === "config" ? "config_required" : "down";
  } else if (args.sourceHealth.failureKind === "empty") {
    status = "waiting";
    label = "데이터 없음";
  } else if (
    args.sourceHealth.staleMinutes != null &&
    args.sourceHealth.staleMinutes > SOURCE_STALE_MINUTES
  ) {
    status = "degraded";
    label = "Stale";
  }

  return withOptionalServiceOverride(
    "data_source",
    {
      name: "data_source",
      title: SERVICE_TITLES.data_source,
      status,
      label,
      summary: args.sourceHealth.description,
      detail:
        args.sourceHealth.lastUpdatedAt
          ? `최근 데이터 시각: ${args.sourceHealth.lastUpdatedAt}`
          : "최근 데이터 시각을 아직 확인하지 못했습니다.",
      updatedAt: args.sourceHealth.lastUpdatedAt,
      source: args.sourceHealth.source,
    },
    args.overrideRow,
  );
}

function buildOperatorChecks(args: {
  sourceHealth: SourceHealth;
  services: Record<OpsServiceName, OpsServiceHealth>;
  curatedRegistryMeta: ReturnType<typeof getCuratedWalletRegistryMeta>;
  render: AdminRenderObservability;
}): OperatorCheck[] {
  const checks: OperatorCheck[] = [];
  const sheetId = envText("GOOGLE_SHEET_ID");
  const credentials = envText("GOOGLE_CREDENTIALS_JSON");
  const telethonConfigured = Boolean(envText("TELETHON_SESSION_STRING")) ||
    (Boolean(envText("TELETHON_API_ID")) && Boolean(envText("TELETHON_API_HASH")));
  const llmConfigured = Boolean(
    envText("ANTHROPIC_API_KEY") || envText("GEMINI_API_KEY") || envText("GROQ_API_KEY"),
  );
  const liveUpdatesEnv = getLiveUpdatesEnv();
  const renderEnv = getRenderEnvState();

  checks.push({
    key: "google_sheets",
    label: "Google Sheets",
    status:
      sheetId && credentials && args.sourceHealth.connected
        ? "ok"
        : sheetId && credentials
          ? "warn"
          : "missing",
    detail:
      sheetId && credentials
        ? args.sourceHealth.description
        : "GOOGLE_SHEET_ID 또는 GOOGLE_CREDENTIALS_JSON이 누락되었습니다.",
  });
  checks.push({
    key: "curated_watchlist",
    label: "Curated watchlist",
    status:
      args.curatedRegistryMeta.source === "curated_wallets"
        ? "ok"
        : args.curatedRegistryMeta.source === "watched_addresses" ||
            args.curatedRegistryMeta.source === "seed"
          ? "warn"
          : "missing",
    detail:
      args.curatedRegistryMeta.source === "curated_wallets"
        ? `표준 curated_wallets 탭에서 ${args.curatedRegistryMeta.rowCount}개 주소를 불러왔습니다.`
        : args.curatedRegistryMeta.source === "watched_addresses"
          ? `legacy watched_addresses 탭에서 ${args.curatedRegistryMeta.rowCount}개 주소를 fallback으로 불러왔습니다.`
          : args.curatedRegistryMeta.source === "seed"
            ? `시트 registry가 비어 seed ${args.curatedRegistryMeta.rowCount}개를 사용 중입니다.`
            : "curated_wallets / watched_addresses가 비어 있고 seed fallback도 비활성화되어 있습니다.",
  });
  checks.push({
    key: "dashboard_password",
    label: "Admin 보호 비밀번호",
    status:
      envText("NODE_ENV") === "production"
        ? envText("DASHBOARD_PASSWORD")
          ? "ok"
          : "missing"
        : envText("DASHBOARD_PASSWORD")
          ? "ok"
          : "warn",
    detail:
      envText("NODE_ENV") === "production"
        ? envText("DASHBOARD_PASSWORD")
          ? "프로덕션 보호 비밀번호가 설정되어 있습니다."
          : "프로덕션에서는 DASHBOARD_PASSWORD가 필수입니다."
        : envText("DASHBOARD_PASSWORD")
          ? "로컬에서도 admin 보호 비밀번호를 사용 중입니다."
          : "개발 모드에서는 비밀번호 없이도 접근할 수 있습니다.",
  });
  checks.push({
    key: "live_updates",
    label: "SSE live updates",
    status: liveUpdatesEnv.enabled
      ? liveUpdatesEnv.configured
        ? "ok"
        : "missing"
      : "warn",
    detail: liveUpdatesEnv.enabled
      ? liveUpdatesEnv.configured
        ? "WHALESCOPE_SSE_ENABLED와 Redis REST 구성이 모두 감지되었습니다."
        : liveUpdatesEnv.configurationReason === "redis_missing"
          ? "WHALESCOPE_SSE_ENABLED는 켜져 있지만 WHALESCOPE_REDIS_REST_URL이 없어 /api/stream이 disabled 상태가 됩니다."
          : "WHALESCOPE_SSE_ENABLED는 켜져 있지만 WHALESCOPE_REDIS_REST_TOKEN이 없어 /api/stream이 disabled 상태가 됩니다."
      : "실시간 자동 새로고침이 비활성화되어 있어 배포 검증은 수동 새로고침 기준으로만 가능합니다.",
  });
  checks.push({
    key: "render_platform",
    label: "Render platform",
    status: renderEnv.configured
      ? args.render.state === "error" || args.render.state === "degraded"
        ? "warn"
        : "ok"
      : "missing",
    detail: !renderEnv.configured
      ? `Render API env가 누락되었습니다: ${renderEnv.missingEnv.join(", ")}`
      : args.render.state === "error"
        ? renderApiErrorMessage(args.render.error)
        : args.render.errors.length > 0
          ? [
              `Render 일부 엔드포인트가 degraded 상태입니다.`,
              ...args.render.errors
                .slice(0, 2)
                .map((item) => `${item.endpoint}: ${renderApiErrorMessage(item.error)}`),
            ].join(" ")
          : `${args.render.services.length}개 Render 서비스와 최근 ${args.render.logWindowMinutes}분 플랫폼 로그를 관측 중입니다.`,
  });
  checks.push({
    key: "telegram_bot",
    label: "Telegram bot token",
    status: envText("TELEGRAM_BOT_TOKEN") ? "ok" : "missing",
    detail: envText("TELEGRAM_BOT_TOKEN")
      ? args.services.bot.summary
      : "TELEGRAM_BOT_TOKEN이 없어 구독 봇/브로드캐스트가 동작하지 않습니다.",
  });
  checks.push({
    key: "telegram_channel",
    label: "Telegram channel",
    status:
      envText("TELEGRAM_BROADCAST_CHAT") ||
      envText("NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME") ||
      envText("NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL")
        ? "ok"
        : "missing",
    detail:
      envText("TELEGRAM_BROADCAST_CHAT") ||
      envText("NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME") ||
      envText("NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL")
        ? "공개 채널 또는 broadcast chat 식별자가 설정되어 있습니다."
        : "TELEGRAM_BROADCAST_CHAT 또는 public channel username이 필요합니다.",
  });
  checks.push({
    key: "telethon_listener",
    label: "Telethon listener",
    status:
      args.services.listener.status === "config_required"
        ? "missing"
        : telethonConfigured
          ? "ok"
          : "warn",
    detail:
      args.services.listener.status === "config_required"
        ? args.services.listener.summary
        : telethonConfigured
          ? "TELETHON_API_ID/HASH와 세션 구성이 감지되었습니다."
          : "API ID/HASH는 있지만 인증 세션이 없을 수 있습니다.",
  });
  checks.push({
    key: "llm_provider",
    label: "LLM provider",
    status: llmConfigured ? "ok" : "warn",
    detail: llmConfigured
      ? "Anthropic/Gemini/Groq 중 하나 이상이 설정되어 브리핑 생성이 가능합니다."
      : "LLM provider가 없으면 brief/stories 파이프라인이 제한됩니다.",
  });

  return checks;
}

function buildOpsSummary(
  services: Record<OpsServiceName, OpsServiceHealth>,
): OpsSummary {
  const entries = Object.values(services);
  const down = entries.filter((item) => item.status === "down");
  const config = entries.filter((item) => item.status === "config_required");
  const degraded = entries.filter((item) => item.status === "degraded");
  const waiting = entries.filter((item) => item.status === "waiting");

  let status: OpsServiceStatus = "healthy";
  let headline = "주요 운영 구성요소가 안정적으로 동작 중입니다.";
  let detail = "Pipeline, Listener, Bot, Dashboard, Data source 모두 정상 범위입니다.";
  let impactedServices: OpsServiceName[] = [];

  if (down.length > 0) {
    status = "down";
    impactedServices = down.map((item) => item.name);
    headline = "일부 운영 구성요소가 중단됐습니다.";
    detail = `${down.map((item) => item.title).join(", ")} 상태를 우선 확인해야 합니다.`;
  } else if (config.length > 0) {
    status = "config_required";
    impactedServices = config.map((item) => item.name);
    headline = "운영 전환 전에 설정 보완이 필요합니다.";
    detail = `${config.map((item) => item.title).join(", ")} 설정을 점검하세요.`;
  } else if (degraded.length > 0) {
    status = "degraded";
    impactedServices = degraded.map((item) => item.name);
    headline = "운영 상태에 주의가 필요합니다.";
    detail = `${degraded.map((item) => item.title).join(", ")}가 stale 또는 warning 상태입니다.`;
  } else if (waiting.length > 0) {
    status = "waiting";
    impactedServices = waiting.map((item) => item.name);
    headline = "일부 구성요소가 대기 상태입니다.";
    detail = `${waiting.map((item) => item.title).join(", ")}가 아직 shadow 또는 idle 상태입니다.`;
  }

  return {
    status,
    headline,
    detail,
    impactedServices,
    updatedAt: latestTimestampFromIterable(entries.map((item) => item.updatedAt)),
  };
}

function rowTimestampMs(row: OptionalSheetRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = rowValue(row, [key]);
    if (!value) {
      continue;
    }
    const parsed = parseDateTimeSafe(value);
    if (parsed != null) {
      return parsed;
    }
  }
  return null;
}

function rowsWithinWindow(
  rows: OptionalSheetRow[],
  keys: string[],
  sinceMs: number,
): OptionalSheetRow[] {
  return rows.filter((row) => {
    const parsed = rowTimestampMs(row, keys);
    return parsed != null && parsed >= sinceMs;
  });
}

function rowBoolean(row: OptionalSheetRow | null | undefined, keys: string[]): boolean | null {
  const value = rowValue(row, keys).toLowerCase();
  if (!value) {
    return null;
  }
  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }
  return null;
}

function rowNumber(row: OptionalSheetRow | null | undefined, keys: string[]): number | null {
  const text = rowValue(row, keys);
  if (!text) {
    return null;
  }
  return parseFloatSafe(text);
}

function ratioSummary(count: number, total: number) {
  return {
    count,
    ratio: total > 0 ? count / total : 0,
  };
}

function briefDecisionKey(row: OptionalSheetRow): string {
  return rowValue(row, ["decision", "status", "result"]).toLowerCase();
}

function countBriefLlmCalls(rows: OptionalSheetRow[]): number {
  return rows.filter((row) => {
    const llmCalled = rowBoolean(row, ["llm_called", "llmCall"]);
    if (llmCalled != null) {
      return llmCalled;
    }
    const decision = briefDecisionKey(row);
    if (decision === "generated") {
      return true;
    }
    const tokensIn = rowNumber(row, ["tokens_in", "tokensIn"]) ?? 0;
    const tokensOut = rowNumber(row, ["tokens_out", "tokensOut"]) ?? 0;
    const costUsd = rowNumber(row, ["cost_usd", "costUsd"]) ?? 0;
    return tokensIn > 0 || tokensOut > 0 || costUsd > 0;
  }).length;
}

function fallbackBriefLlmCalls(rows: OptionalSheetRow[], sinceMs: number): number {
  return rowsWithinWindow(rows, ["ts"], sinceMs).filter((row) => {
    const pipeline = rowValue(row, ["pipeline"]).toLowerCase();
    if (pipeline !== "brief") {
      return false;
    }
    const decision = rowValue(row, ["decision"]).toLowerCase();
    if (decision === "blocked_cap") {
      return false;
    }
    const tokensIn = rowNumber(row, ["tokens_in"]) ?? 0;
    const tokensOut = rowNumber(row, ["tokens_out"]) ?? 0;
    const costUsd = rowNumber(row, ["cost_usd"]) ?? 0;
    return tokensIn > 0 || tokensOut > 0 || costUsd > 0 || decision === "generated";
  }).length;
}

function latestGeneratedBriefAt(
  briefLedgerRows: OptionalSheetRow[],
  latestBrief: DashboardBrief | null,
): string | undefined {
  const generatedRows = briefLedgerRows.filter((row) => briefDecisionKey(row) === "generated");
  const latestGeneratedRow = latestOptionalRow(generatedRows, ["ts", "created_at", "updated_at"]);
  return (
    rowValue(latestGeneratedRow, ["ts", "created_at", "updated_at"]) ||
    latestBrief?.generatedAt ||
    latestBrief?.date
  );
}

function eventMetaString(
  update: { meta?: Record<string, string | number | boolean> } | undefined,
  key: string,
): string | undefined {
  const value = update?.meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildLiveUpdateSections(args: {
  latestBrief: DashboardBrief | null;
  latestNewsRssLog: SystemLogRow | null;
  serviceHealthRows: OptionalSheetRow[];
  liveEventsBySection: Map<string, { ts: string; meta?: Record<string, string | number | boolean> }>;
}): AdminLiveUpdateSectionObservability[] {
  const latestStoriesHeartbeat = parseServiceHealthRow(findServiceHealthOverride(args.serviceHealthRows, [
    "pipeline.stories",
    "stories",
  ]));
  const latestWatchlistHeartbeat = parseServiceHealthRow(findServiceHealthOverride(args.serviceHealthRows, [
    "pipeline.curated_balance",
    "curated_balance",
    "watchlist",
  ]));
  const latestBriefHeartbeat = parseServiceHealthRow(findServiceHealthOverride(args.serviceHealthRows, [
    "pipeline.brief",
    "brief",
  ]));

  const sections: Array<{
    section: AdminLiveUpdateSectionObservability["section"];
    source: string;
    lastUpdatedAt?: string;
    lastRevalidatedAt?: string;
  }> = [
    {
      section: "brief",
      source: args.latestBrief?.generatedAt ? "daily_brief" : "service_health",
      lastUpdatedAt: latestTimestamp(
        args.liveEventsBySection.get("brief")?.ts,
        args.latestBrief?.generatedAt,
        latestBriefHeartbeat?.lastSuccessAt,
        latestBriefHeartbeat?.ts,
      ),
      lastRevalidatedAt: latestTimestamp(
        eventMetaString(args.liveEventsBySection.get("brief"), "updatedAt"),
        args.latestBrief?.generatedAt,
        latestBriefHeartbeat?.lastSuccessAt,
      ),
    },
    {
      section: "news",
      source: args.latestNewsRssLog ? "system_log" : "service_health",
      lastUpdatedAt: latestTimestamp(
        args.liveEventsBySection.get("news")?.ts,
        args.latestNewsRssLog?.finished_at,
        args.latestNewsRssLog?.started_at,
      ),
      lastRevalidatedAt: latestTimestamp(
        eventMetaString(args.liveEventsBySection.get("news"), "updatedAt"),
        args.latestNewsRssLog?.finished_at,
      ),
    },
    {
      section: "watchlist",
      source: "service_health",
      lastUpdatedAt:
        latestTimestamp(
          args.liveEventsBySection.get("watchlist")?.ts,
          latestWatchlistHeartbeat?.lastSuccessAt,
          latestWatchlistHeartbeat?.ts,
        ) || undefined,
      lastRevalidatedAt:
        latestTimestamp(
          eventMetaString(args.liveEventsBySection.get("watchlist"), "updatedAt"),
          latestWatchlistHeartbeat?.lastSuccessAt,
          latestWatchlistHeartbeat?.ts,
        ) || undefined,
    },
    {
      section: "stories",
      source: "service_health",
      lastUpdatedAt:
        latestTimestamp(
          args.liveEventsBySection.get("stories")?.ts,
          latestStoriesHeartbeat?.lastSuccessAt,
          latestStoriesHeartbeat?.ts,
        ) || undefined,
      lastRevalidatedAt:
        latestTimestamp(
          eventMetaString(args.liveEventsBySection.get("stories"), "updatedAt"),
          latestStoriesHeartbeat?.lastSuccessAt,
          latestStoriesHeartbeat?.ts,
        ) || undefined,
    },
  ];

  return sections.map((section) => ({
    ...section,
    ageMinutes: minutesSince(section.lastUpdatedAt),
  }));
}

async function buildLiveUpdatesObservability(args: {
  latestBrief: DashboardBrief | null;
  latestNewsRssLog: SystemLogRow | null;
  serviceHealthRows: OptionalSheetRow[];
}) {
  const env = getLiveUpdatesEnv();
  const status = getLiveUpdateStatus(env);
  let liveEvents: Awaited<ReturnType<typeof fetchLiveUpdateEvents>> = [];

  if (env.enabled && env.configured) {
    try {
      liveEvents = await fetchLiveUpdateEvents(env);
    } catch (error) {
      console.warn(
        "[metrics] failed to fetch live update diagnostics",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const liveEventsBySection = new Map(
    liveEvents.map((event) => [event.section, event] as const),
  );
  const latestEvent = newestFirst(liveEvents, (event) => parseDateTimeSafe(event.ts))[0];
  const sections = buildLiveUpdateSections({
    ...args,
    liveEventsBySection,
  });

  return {
    enabled: env.enabled,
    configured: env.configured,
    state: status.state,
    reason: status.reason,
    pollIntervalMs: status.pollIntervalMs,
    heartbeatIntervalMs: status.heartbeatIntervalMs,
    latestActivityAt: latestTimestampFromIterable([
      latestEvent?.ts,
      ...sections.map((section) => section.lastUpdatedAt),
    ]),
    lastEventId: latestEvent?.version,
    latestLatencyMs:
      latestEvent?.ts != null && parseDateTimeSafe(latestEvent.ts) != null
        ? Math.max(0, Date.now() - (parseDateTimeSafe(latestEvent.ts) ?? 0))
        : null,
    reconnectCount: 0,
    lastReconnectAt: undefined,
    lastErrorAt: undefined,
    sections,
  };
}

function parseChannelMemberCount(row: OptionalSheetRow | null): number | null {
  return rowNumber(row, ["member_count", "members", "subscriber_count"]);
}

function manualMarketSourceReason(
  id: AdminMarketSourceObservability["id"],
): string {
  switch (id) {
    case "binance":
      return "배포 브라우저에서 WebSocket live/stale/down 상태를 최종 확인합니다.";
    case "upbit":
      return "배포 브라우저에서 WebSocket 연결과 정책 차단 여부를 최종 확인합니다.";
    case "bitflyer":
      return "배포 환경에서 REST 지연과 30초 내 가격 갱신 여부를 확인합니다.";
    case "kraken":
      return "배포 환경에서 REST 지연과 30초 내 가격 갱신 여부를 확인합니다.";
    case "fx":
      return "5분 polling 소스이므로 배포 환경 freshness와 fallback 체인을 확인합니다.";
    case "snapshot":
      return "REST 합성 스냅샷이므로 배포 환경 freshness와 카드 반영 시각을 확인합니다.";
    case "fear_greed":
      return "Alternative.me 실값과 사용자 홈 게이지 값을 함께 대조합니다.";
    default:
      return "배포 환경에서 최종 관측이 필요합니다.";
  }
}

function subscriberStatus(row: SubscriberRow): string {
  return compactString(row.status).toLowerCase();
}

function subscriberStatusChangedAt(row: SubscriberRow): string | undefined {
  return compactString((row as { status_changed_at?: string }).status_changed_at) || undefined;
}

function tgMirrorTimestampMs(row: TgWhaleEventRow): number | null {
  return (
    parseDateTimeSafe(compactString(row.collected_at)) ??
    parseDateTimeSafe(compactString(row.tg_date))
  );
}

function tgMirrorObservedAt(row: TgWhaleEventRow): string | undefined {
  return compactString(row.collected_at) || compactString(row.tg_date) || undefined;
}

function tgMirrorConfidence(row: TgWhaleEventRow): "high" | "medium" | "low" | "unknown" {
  const value = compactString(row.external_confidence || row.parsed_confidence).toLowerCase();
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "unknown";
}

function tgMirrorChannel(row: TgWhaleEventRow): string {
  return (
    compactString(row.external_display_name) ||
    compactString(row.external_channel) ||
    "미지정 채널"
  );
}

function buildTgMirrorObservability(args: {
  tgWhaleEventRows: TgWhaleEventRow[];
}): AdminTgMirrorObservability {
  const sinceMs = Date.now() - ADMIN_OBSERVABILITY_WINDOW_MS;
  const rows24h = args.tgWhaleEventRows.filter((row) => {
    const timestamp = tgMirrorTimestampMs(row);
    return timestamp != null && timestamp >= sinceMs;
  });
  const totalObserved = rows24h.length;
  const highCount = rows24h.filter((row) => tgMirrorConfidence(row) === "high").length;
  const mediumCount = rows24h.filter((row) => tgMirrorConfidence(row) === "medium").length;
  const lowCount = rows24h.filter((row) => tgMirrorConfidence(row) === "low").length;
  const unknownCount = rows24h.filter((row) => tgMirrorConfidence(row) === "unknown").length;
  const channelCounts = new Map<string, number>();
  for (const row of rows24h) {
    const channel = tgMirrorChannel(row);
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
  }
  const latestRow =
    newestFirst(rows24h, (row) => tgMirrorTimestampMs(row) ?? 0)[0] ?? null;

  return {
    windowHours: ADMIN_OBSERVABILITY_WINDOW_HOURS,
    totalObserved,
    latestObservedAt: latestRow ? tgMirrorObservedAt(latestRow) : undefined,
    high: ratioSummary(highCount, totalObserved),
    medium: ratioSummary(mediumCount, totalObserved),
    low: ratioSummary(lowCount, totalObserved),
    unknown: ratioSummary(unknownCount, totalObserved),
    channels: Array.from(channelCounts.entries())
      .map(([channel, count]) => ({ channel, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.channel.localeCompare(right.channel, "ko");
      }),
  };
}

function buildTelegramObservability(args: {
  subscriberRows: SubscriberRow[];
  channelHealthRows: OptionalSheetRow[];
  broadcastRows: OptionalSheetRow[];
}): AdminTelegramObservability {
  const sinceMs = Date.now() - ADMIN_OBSERVABILITY_WINDOW_MS;
  const activeRows = args.subscriberRows.filter((row) => subscriberStatus(row) === "active");
  const pausedRows = args.subscriberRows.filter((row) => subscriberStatus(row) === "paused");
  const blockedRows = args.subscriberRows.filter((row) => subscriberStatus(row) === "blocked");
  const deactivatedRows = args.subscriberRows.filter(
    (row) => subscriberStatus(row) === "deactivated",
  );
  const unsubscribe24h = args.subscriberRows.filter((row) => {
    const status = subscriberStatus(row);
    if (!TELEGRAM_UNSUBSCRIBED_STATUSES.has(status)) {
      return false;
    }
    const changedAt = subscriberStatusChangedAt(row);
    const changedMs = changedAt ? parseDateTimeSafe(changedAt) : null;
    return changedMs != null && changedMs >= sinceMs;
  }).length;

  const audienceTotal = Math.max(
    1,
    activeRows.length + pausedRows.length + blockedRows.length + deactivatedRows.length,
  );
  const latestChannelHealthRow = latestOptionalRow(
    args.channelHealthRows,
    ["ts", "updated_at", "created_at"],
  );
  const channelRows24h = rowsWithinWindow(
    args.channelHealthRows,
    ["ts", "updated_at", "created_at"],
    sinceMs,
  );
  const earliestChannelRow24h = earliestOptionalRow(
    channelRows24h,
    ["ts", "updated_at", "created_at"],
  );
  const latestChannelMemberCount = parseChannelMemberCount(latestChannelHealthRow);
  const previousChannelMemberCount = parseChannelMemberCount(earliestChannelRow24h);
  const latestBroadcastRow = latestOptionalRow(
    args.broadcastRows,
    ["ts", "created_at", "updated_at"],
  );

  return {
    subscriberCountActive: activeRows.length,
    subscriberCountPaused: pausedRows.length,
    subscriberCountBlocked: blockedRows.length,
    subscriberCountDeactivated: deactivatedRows.length,
    unsubscribe24h,
    unsubscribeRate24h: unsubscribe24h / audienceTotal,
    channelMemberCountLatest: latestChannelMemberCount,
    channelMemberDelta24h:
      latestChannelMemberCount != null && previousChannelMemberCount != null
        ? latestChannelMemberCount - previousChannelMemberCount
        : null,
    lastChannelHealthAt:
      rowValue(latestChannelHealthRow, ["ts", "updated_at", "created_at"]) || undefined,
    lastBroadcastAt:
      rowValue(latestBroadcastRow, ["ts", "created_at", "updated_at"]) || undefined,
    lastBroadcastDeliveryMode:
      rowValue(latestBroadcastRow, ["delivery_mode"]) || undefined,
    lastBroadcastStatus:
      rowValue(latestBroadcastRow, ["status"]) || undefined,
  };
}

async function buildMarketSourcesObservability(): Promise<AdminMarketSourceObservability[]> {
  const fearGreed = await getFearGreedData();
  const fearGreedLastSuccessAt = fearGreed.current?.timestamp;
  const fearGreedLastFailureAt =
    fearGreed.status === "unavailable" ? fearGreed.fetchedAt : undefined;

  return [
    {
      id: "binance",
      transport: "websocket",
      status: "manual_check",
      freshnessSeconds: null,
      failureReason: manualMarketSourceReason("binance"),
    },
    {
      id: "upbit",
      transport: "websocket",
      status: "manual_check",
      freshnessSeconds: null,
      failureReason: manualMarketSourceReason("upbit"),
    },
    {
      id: "bitflyer",
      transport: "rest",
      status: "manual_check",
      freshnessSeconds: null,
      failureReason: manualMarketSourceReason("bitflyer"),
    },
    {
      id: "kraken",
      transport: "rest",
      status: "manual_check",
      freshnessSeconds: null,
      failureReason: manualMarketSourceReason("kraken"),
    },
    {
      id: "fx",
      transport: "rest",
      status: "manual_check",
      freshnessSeconds: null,
      failureReason: manualMarketSourceReason("fx"),
    },
    {
      id: "snapshot",
      transport: "composite",
      status: "manual_check",
      freshnessSeconds: null,
      failureReason: manualMarketSourceReason("snapshot"),
    },
    {
      id: "fear_greed",
      transport: "external_api",
      status: fearGreed.status === "ready" ? "ready" : "unavailable",
      lastSuccessAt: fearGreedLastSuccessAt,
      lastFailureAt: fearGreedLastFailureAt,
      freshnessSeconds:
        fearGreed.status === "ready"
          ? secondsSince(fearGreedLastSuccessAt ?? fearGreed.fetchedAt)
          : null,
      failureReason:
        fearGreed.status === "ready"
          ? manualMarketSourceReason("fear_greed")
          : fearGreed.unavailableReason ?? manualMarketSourceReason("fear_greed"),
    },
  ];
}

function matchesPeriodicBroadcast(row: OptionalSheetRow): boolean {
  const kind = rowValue(row, ["kind", "run_type", "pipeline"]).toLowerCase();
  const dedupKey = rowValue(row, ["dedup_key", "slot_key"]).toLowerCase();
  return kind === "broadcast_periodic" || dedupKey.startsWith("broadcast_periodic:");
}

function periodicRunStatus(row: SystemLogRow): string {
  return compactString(row.status).toLowerCase();
}

function periodicRunDetails(row: SystemLogRow): string {
  return compactString(row.details).toLowerCase();
}

function parseMessageLengthFromLog(row: SystemLogRow | null): number | null {
  if (!row) {
    return null;
  }
  const match = compactString(row.details).match(/message_len=(\d+)/i);
  if (!match) {
    return null;
  }
  return parseIntSafe(match[1]) ?? null;
}

function latestPeriodicSendAt(
  broadcastRows: OptionalSheetRow[],
  periodicRows: SystemLogRow[],
): string | undefined {
  const sentRows = broadcastRows.filter((row) => {
    const deliveryMode = rowValue(row, ["delivery_mode"]).toLowerCase();
    const status = rowValue(row, ["status"]).toLowerCase();
    if (deliveryMode === "skipped") {
      return false;
    }
    if (status.startsWith("skipped")) {
      return false;
    }
    return true;
  });
  const latestBroadcastRow = latestOptionalRow(sentRows, ["ts", "created_at", "updated_at"]);
  const broadcastTs = rowValue(latestBroadcastRow, ["ts", "created_at", "updated_at"]);
  if (broadcastTs) {
    return broadcastTs;
  }

  const latestPeriodicRun = newestFirst(periodicRows, (row) => {
    return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
  }).find((row) => {
    const status = periodicRunStatus(row);
    return status === "completed" || status === "completed_with_errors";
  });
  return latestPeriodicRun?.finished_at || latestPeriodicRun?.started_at;
}

async function buildAdminObservabilitySummary(args: {
  briefLedgerRows: OptionalSheetRow[];
  llmBudgetRows: OptionalSheetRow[];
  broadcastRows: OptionalSheetRow[];
  subscriberRows: SubscriberRow[];
  watchedAddressRows: WatchedAddressRow[];
  tgWhaleEventRows: TgWhaleEventRow[];
  channelHealthRows: OptionalSheetRow[];
  systemLogRows: SystemLogRow[];
  latestBrief: DashboardBrief | null;
  latestNewsRssLog: SystemLogRow | null;
  serviceHealthRows: OptionalSheetRow[];
  render: AdminRenderObservability;
}): Promise<AdminObservabilitySummary> {
  const sinceMs = Date.now() - ADMIN_OBSERVABILITY_WINDOW_MS;
  const chainCoverage = buildChainCoverageObservability(args.serviceHealthRows);
  const chainRollout = buildChainRolloutObservability({
    watchedAddressRows: args.watchedAddressRows,
    chainCoverage,
  });
  const tgMirror = buildTgMirrorObservability({
    tgWhaleEventRows: args.tgWhaleEventRows,
  });
  const briefRows24h = rowsWithinWindow(args.briefLedgerRows, ["ts", "created_at", "updated_at"], sinceMs);
  const briefTotalRuns = briefRows24h.length;
  const briefGeneratedCount = briefRows24h.filter((row) => briefDecisionKey(row) === "generated").length;
  const briefCachedCount = briefRows24h.filter((row) => briefDecisionKey(row) === "cached").length;
  const briefSkippedInactiveCount = briefRows24h.filter(
    (row) => briefDecisionKey(row) === "skipped_inactive",
  ).length;
  const briefSkippedBudgetCount = briefRows24h.filter(
    (row) => briefDecisionKey(row) === "skipped_budget",
  ).length;
  const briefLlmCallCount =
    briefRows24h.length > 0
      ? countBriefLlmCalls(briefRows24h)
      : fallbackBriefLlmCalls(args.llmBudgetRows, sinceMs);

  const periodicRuns24h = args.systemLogRows.filter((row) => {
    if (compactString(row.run_type).toLowerCase() !== "broadcast_periodic") {
      return false;
    }
    const timestamp =
      parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
    return timestamp != null && timestamp >= sinceMs;
  });
  const periodicTotalExecutions = periodicRuns24h.length;
  const skippedEmptyCount = periodicRuns24h.filter((row) => {
    const status = periodicRunStatus(row);
    return status === "skipped_empty" || periodicRunDetails(row).includes("signals=0; transactions=0");
  }).length;
  const skippedDuplicateContentCount = periodicRuns24h.filter((row) => {
    const status = periodicRunStatus(row);
    const details = periodicRunDetails(row);
    return status === "skipped_duplicate_content" || details.includes("duplicate_content");
  }).length;

  const periodicBroadcastRows = args.broadcastRows.filter(matchesPeriodicBroadcast);
  const latestPeriodicBroadcastRow = latestOptionalRow(
    periodicBroadcastRows,
    ["ts", "created_at", "updated_at"],
  );
  const latestMessageLength =
    (rowNumber(latestPeriodicBroadcastRow, ["message_length", "message_len"]) ?? null) ??
    parseMessageLengthFromLog(
      newestFirst(periodicRuns24h, (row) => {
        return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
      })[0] ?? null,
    );
  const latestMessageExceededCap =
    rowBoolean(latestPeriodicBroadcastRow, ["over_cap", "is_over_cap", "truncated"]) ??
    (latestMessageLength != null ? latestMessageLength > TELEGRAM_MESSAGE_HARD_CAP : null);
  const [liveUpdates, marketSources] = await Promise.all([
    buildLiveUpdatesObservability({
      latestBrief: args.latestBrief,
      latestNewsRssLog: args.latestNewsRssLog,
      serviceHealthRows: args.serviceHealthRows,
    }),
    buildMarketSourcesObservability(),
  ]);
  const telegram = buildTelegramObservability({
    subscriberRows: args.subscriberRows,
    channelHealthRows: args.channelHealthRows,
    broadcastRows: args.broadcastRows,
  });

  return {
    brief: {
      windowHours: ADMIN_OBSERVABILITY_WINDOW_HOURS,
      totalRuns: briefTotalRuns,
      generated: ratioSummary(briefGeneratedCount, briefTotalRuns),
      cached: ratioSummary(briefCachedCount, briefTotalRuns),
      skippedInactive: ratioSummary(briefSkippedInactiveCount, briefTotalRuns),
      skippedBudget: ratioSummary(briefSkippedBudgetCount, briefTotalRuns),
      llmCallCount: briefLlmCallCount,
      latestGeneratedAt: latestGeneratedBriefAt(args.briefLedgerRows, args.latestBrief),
    },
    periodic: {
      windowHours: ADMIN_OBSERVABILITY_WINDOW_HOURS,
      totalExecutions: periodicTotalExecutions,
      skippedEmpty: ratioSummary(skippedEmptyCount, periodicTotalExecutions),
      skippedDuplicateContent: ratioSummary(
        skippedDuplicateContentCount,
        periodicTotalExecutions,
      ),
      latestMessageLength,
      latestMessageExceededCap,
      latestPeriodicSendAt: latestPeriodicSendAt(periodicBroadcastRows, periodicRuns24h),
    },
    liveUpdates,
    marketSources,
    chainCoverage,
    chainRollout,
    tgMirror,
    telegram,
    render: args.render,
  };
}

export async function getDashboardData(options?: {
  transactionLimit?: number;
  signalLimit?: number;
  systemLogLimit?: number;
  includeAdminExtras?: boolean;
}): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();
  const transactionLimit = options?.transactionLimit ?? 20;
  const signalLimit = options?.signalLimit ?? 20;
  const systemLogLimit = options?.systemLogLimit ?? 25;
  const includeAdminExtras = options?.includeAdminExtras ?? true;
  const emptyRenderObservability = (): AdminRenderObservability => ({
    provider: "render",
    state: "error",
    enabled: false,
    configured: false,
    missingEnv: [],
    fetchedAt: new Date().toISOString(),
    logWindowMinutes: 0,
    services: [],
    deploys: [],
    instances: [],
    logs: [],
    error: { code: "internal", errId: "admin_extras_skipped" },
    errors: [],
  });
  const [
    snapshotResult,
    curatedWalletBundle,
    serviceHealthRows,
    channelHealthRows,
    briefCostLedgerRows,
    broadcastLogRows,
    llmBudgetRows,
    watchedAddressRows,
    renderObservability,
  ] = await Promise.all([
    readDashboardSnapshotSafe(),
    loadCuratedWalletEntriesWithMeta(),
    readOptionalSheetRows("service_health"),
    readOptionalSheetRows("channel_health"),
    includeAdminExtras ? readOptionalSheetRows("brief_cost_ledger") : Promise.resolve([]),
    includeAdminExtras ? readOptionalSheetRows("broadcast_log") : Promise.resolve([]),
    includeAdminExtras ? readOptionalSheetRows("llm_budget_log") : Promise.resolve([]),
    includeAdminExtras ? readWatchedAddressRows() : Promise.resolve([]),
    includeAdminExtras
      ? loadRenderObservability().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[metrics/getDashboardData] loadRenderObservability failed:", message);
          const fallback = emptyRenderObservability();
          fallback.error = { code: "internal", errId: message.slice(0, 120) };
          return fallback;
        })
      : Promise.resolve(emptyRenderObservability()),
  ]);
  const snapshot = snapshotResult.snapshot;
  if (snapshotResult.failedTabs.length > 0) {
    console.error(
      "[metrics/getDashboardData] sheet tabs degraded:",
      snapshotResult.failedTabs.map((item) => `${item.tab}: ${item.error}`).join(" | "),
    );
  }
  const curatedWallets = curatedWalletBundle.wallets;
  const curatedRegistryMeta = curatedWalletBundle.meta;

  const recentTransactions = newestFirst(snapshot.transactions, (row) => {
    return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.timestamp);
  }).slice(0, transactionLimit);

  const recentSignalRows = newestFirst(snapshot.signals, (row) => {
    return parseDateTimeSafe(row.created_at);
  }).slice(0, signalLimit);
  const recentSignals = recentSignalRows
    .slice(0, signalLimit)
    .map((row) => normalizeDashboardSignal(row));

  const sortedSystemLogs = newestFirst(snapshot.system_log, (row) => {
    return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
  });
  const systemLogs = sortedSystemLogs.slice(0, systemLogLimit);

  const currentLatestRunRow = latestPipelineLog(sortedSystemLogs);
  const currentLatestRun = currentLatestRunRow
    ? normalizeLatestRun(currentLatestRunRow)
    : null;
  const latestNewsRssLog = latestSystemLog(
    sortedSystemLogs.filter((row) => row.run_type === "news_rss"),
  );
  const latestBroadcastLog = latestSystemLog(
    sortedSystemLogs.filter((row) => row.run_type === "broadcast_daily"),
  );
  const currentLatestBrief = latestBrief(snapshot.daily_brief);
  const normalizedBrief = normalizeBrief(currentLatestBrief);
  const adminObservability = includeAdminExtras
    ? await buildAdminObservabilitySummary({
        briefLedgerRows: briefCostLedgerRows,
        llmBudgetRows,
        broadcastRows: broadcastLogRows,
        subscriberRows: snapshot.subscribers,
        watchedAddressRows,
        tgWhaleEventRows: snapshot.tg_whale_events,
        channelHealthRows,
        systemLogRows: snapshot.system_log,
        latestBrief: normalizedBrief,
        latestNewsRssLog,
        serviceHealthRows,
        render: renderObservability,
      })
    : null;
  const latestRunErrorCount = errorCountForRun(currentLatestRunRow);
  const latestRunStatus = currentLatestRun?.status ?? "unknown";
  const latestRunUpdatedAt = currentLatestRun?.finished_at || currentLatestRun?.started_at || undefined;
  const transactionUpdatedAt = snapshot.transactionsLatestAt ?? undefined;
  const signalUpdatedAt = latestTimestampFromIterable(
    snapshot.signals.map((row) => row.created_at),
  );
  const briefUpdatedAt = currentLatestBrief?.created_at || currentLatestBrief?.date || undefined;
  const rowCounts: RowCounts = {
    transactions: snapshot.transactionsTotal,
    daily_brief: snapshot.daily_brief.length,
    signals: snapshot.signals.length,
    system_log: snapshot.system_log.length,
    subscribers: snapshot.subscribers.length,
  };
  const dataSourceOverrideRow = findServiceHealthOverride(serviceHealthRows, ["data_source", "google_sheets", "sheets"]);
  const dataSourceOverride = parseServiceHealthRow(dataSourceOverrideRow);
  const sourceHealthBase = buildSourceHealth({
    source: "google_sheets",
    generatedAt,
    latestRunUpdatedAt,
    transactionUpdatedAt,
    signalUpdatedAt,
    briefUpdatedAt,
    latestNewsRssRow: latestNewsRssLog,
    rowCounts,
  });
  const dataSourceOverrideError =
    dataSourceOverride?.error ||
    rowValue(dataSourceOverrideRow, ["error", "detail", "message"]);
  const sourceHealth: SourceHealth = {
    ...sourceHealthBase,
    failureKind: sourceHealthBase.failureKind ?? parseSourceFailureKind(dataSourceOverrideError),
  };
  const latestChannelHealth = latestOptionalRow(channelHealthRows, ["ts", "updated_at", "created_at"]);
  const listenerHealth = normalizeListenerHealth(sortedSystemLogs, snapshot.tg_whale_events, generatedAt);

  const dataShape = {
    generatedAt,
    latestBrief: normalizedBrief,
    recentTransactions,
    recentSignals: recentSignalRows,
  };

  const watchlist = buildDashboardWatchlist(dataShape, {
    wallets: curatedWallets.filter((entry) => entry.enabled),
  });
  const whaleStories = buildDashboardWhaleStories(dataShape, {
    wallets: curatedWallets,
  });
  const baseServiceHealth: Record<OpsServiceName, OpsServiceHealth> = {
    pipeline: buildPipelineService({
      latestRun: currentLatestRun
        ? {
            ...currentLatestRun,
            status: latestRunStatus,
            message:
              currentLatestRun.details == null || currentLatestRun.details === ""
                ? "Latest pipeline run recorded."
                : String(currentLatestRun.details),
            errorCount: latestRunErrorCount,
            updatedAt: latestRunUpdatedAt ?? new Date().toISOString(),
          }
        : null,
      overrideRow: findServiceHealthOverride(serviceHealthRows, ["pipeline", "run_all", "signals"]),
    }),
    listener: buildListenerService({
      listenerHealth,
      overrideRow: findServiceHealthOverride(serviceHealthRows, ["listener", "telethon_listener"]),
    }),
    bot: buildBotService({
      subscriberCount: snapshot.subscribers.length,
      latestBroadcastLog,
      latestChannelHealth,
      overrideRow: findServiceHealthOverride(serviceHealthRows, ["bot", "telegram_bot", "broadcast_bot"]),
    }),
    dashboard: buildDashboardService({
      sourceHealth,
      overrideRow: findServiceHealthOverride(serviceHealthRows, ["dashboard", "admin"]),
    }),
    data_source: buildDataSourceService({
      sourceHealth,
      overrideRow: dataSourceOverrideRow,
    }),
  };
  const serviceHealth: Record<OpsServiceName, OpsServiceHealth> = {
    ...baseServiceHealth,
    pipeline: mergeRenderServiceHealth({
      base: baseServiceHealth.pipeline,
      render: renderObservability,
      serviceKey: "pipeline",
    }),
    listener: mergeRenderServiceHealth({
      base: baseServiceHealth.listener,
      render: renderObservability,
      serviceKey: "listener",
    }),
    bot: mergeRenderServiceHealth({
      base: baseServiceHealth.bot,
      render: renderObservability,
      serviceKey: "bot",
    }),
  };
  const operatorChecks = buildOperatorChecks({
    sourceHealth,
    services: serviceHealth,
    curatedRegistryMeta,
    render: renderObservability,
  });
  const opsSummary = buildOpsSummary(serviceHealth);

  // IMPORTANT: Defensive RSC boundary guard.
  //
  // React Server Components serialize this payload to the client, and an
  // unhandled cycle / non-serializable value / pathologically deep sub-tree
  // anywhere in the object graph will crash the Flight serializer with
  // `RangeError: Maximum call stack size exceeded at Set.add` — Flight
  // uses a plain Set to dedupe written objects and the failure point is
  // inside its own recursion.
  //
  // We normalize each field as best we can upstream (see normalizeLatestRun,
  // normalizeSystemLogRows, normalizeDashboardSignal, etc.) but pipeline
  // writers can still emit surprising shapes into Google Sheets columns
  // (e.g., a gspread APIError's deeply-nested `response.request.response`
  // chain written as JSON into `system_log.details`). `sanitizeForRsc`
  // makes the return value robust regardless of what slips through:
  // cycles, Dates, Errors, Maps, Sets, Promises, and depth > 20 are all
  // replaced with safe representations. This is a cheap structural clone
  // at the dashboard request frequency and is worth the safety budget.
  return sanitizeForRsc({
    generatedAt,
    source: "google_sheets",
    adminObservability,
    latestBrief: normalizedBrief,
    recentTransactions,
    recentSignals,
    curatedWallets,
    watchlist,
    whaleStories,
    latestRun: currentLatestRun
      ? {
          ...currentLatestRun,
          status: latestRunStatus,
          message:
            currentLatestRun.details == null || currentLatestRun.details === ""
              ? "Latest pipeline run recorded."
              : String(currentLatestRun.details),
          errorCount: latestRunErrorCount,
          updatedAt: latestRunUpdatedAt ?? new Date().toISOString(),
        }
      : null,
    listenerHealth,
    sourceHealth,
    serviceHealth,
    operatorChecks,
    opsSummary,
    systemLogs: normalizeSystemLogRows(systemLogs),
    metrics: {
      transactionCount: snapshot.transactionsTotal,
      signalCount: snapshot.signals.length,
      dailyBriefCount: snapshot.daily_brief.length,
      subscriberCount: snapshot.subscribers.length,
      latestRunStatus,
      latestRunErrorCount,
      lastUpdatedAt: sourceHealth.lastUpdatedAt ?? latestRunUpdatedAt,
      rowCounts,
      latestStatus: currentLatestRun?.status ?? null,
      errorCount: latestRunErrorCount,
    },
  });
}

export async function getTransactionsData(limit: number): Promise<{
  items: TransactionRow[];
  total: number;
  limit: number;
}> {
  const rows = await readSheetRows("transactions");
  const items = newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.timestamp);
  }).slice(0, limit);
  return {
    items,
    total: rows.length,
    limit,
  };
}

export async function getSignalsData(limit: number): Promise<{
  items: SignalRow[];
  total: number;
  limit: number;
}> {
  const rows = await readSheetRows("signals");
  const items = newestFirst(rows, (row) => parseDateTimeSafe(row.created_at)).slice(0, limit);
  return {
    items,
    total: rows.length,
    limit,
  };
}

export async function getSystemLogData(limit: number): Promise<{
  items: SystemLogRow[];
  total: number;
  limit: number;
}> {
  const rows = await readSheetRows("system_log");
  const items = newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
  }).slice(0, limit);
  return {
    items,
    total: rows.length,
    limit,
  };
}

// ---- Interactive dashboard state (in-memory, ephemeral) ----
//
// These stores back the Wave 2-E interaction APIs. They live in process
// memory and reset on deploy — appropriate for the demo scope. A
// production build would persist to Sheets or a DB from here.

export type SignalActionRecord = {
  signalId: string;
  action: "acknowledge" | "dismiss";
  recordedAt: string;
};

export type WatchlistEntry = {
  address: string;
  chain: string;
  label: string;
  enabled: boolean;
};

const signalActionStore = new Map<string, SignalActionRecord>();

export function recordSignalAction(
  signalId: string,
  action: "acknowledge" | "dismiss",
): SignalActionRecord {
  const record: SignalActionRecord = {
    signalId,
    action,
    recordedAt: new Date().toISOString(),
  };
  signalActionStore.set(signalId, record);
  return record;
}

export function getSignalAction(signalId: string): SignalActionRecord | null {
  return signalActionStore.get(signalId) ?? null;
}

export function listSignalActions(): SignalActionRecord[] {
  return Array.from(signalActionStore.values());
}

export async function listCuratedWalletRegistry(): Promise<CuratedWalletEntry[]> {
  return loadCuratedWalletEntries();
}

export function buildDashboardWatchlist(
  data:
    | {
        recentTransactions?: TransactionRow[] | unknown[] | null;
        recentSignals?: SignalRow[] | DisplaySignalRow[] | unknown[] | null;
      }
    | null,
  options?: { maxItems?: number; wallets?: CuratedWalletEntry[] },
): CuratedWatchlistItem[] {
  return buildCuratedWatchlistItems({
    wallets: options?.wallets ?? listCuratedWalletEntries().filter((entry) => entry.enabled),
    recentTransactions: (data?.recentTransactions ?? []) as TransactionRow[],
    recentSignals: (data?.recentSignals ?? []) as SignalRow[],
    maxItems: options?.maxItems ?? 20,
  });
}

export function buildDashboardWhaleStories(
  data:
    | {
        generatedAt?: string;
        latestBrief?: DashboardBrief | null;
        recentTransactions?: TransactionRow[] | unknown[] | null;
        recentSignals?: SignalRow[] | DisplaySignalRow[] | unknown[] | null;
      }
    | null,
  options?: { maxItems?: number; wallets?: CuratedWalletEntry[] },
): WhaleStory[] {
  return buildWhaleStories({
    recentTransactions: (data?.recentTransactions ?? []) as TransactionRow[],
    recentSignals: (data?.recentSignals ?? []) as SignalRow[],
    latestBrief: data?.latestBrief ?? null,
    generatedAt: data?.generatedAt,
    maxItems: options?.maxItems,
    curatedWallets: options?.wallets ?? listCuratedWalletEntries(),
  });
}

export function buildDashboardWhaleStoryCards(
  data:
    | {
        generatedAt?: string;
        latestBrief?: DashboardBrief | null;
        recentTransactions?: TransactionRow[] | unknown[] | null;
        recentSignals?: SignalRow[] | DisplaySignalRow[] | unknown[] | null;
      }
    | null,
  options?: { maxItems?: number; wallets?: CuratedWalletEntry[] },
) {
  return buildWhaleStoryCards(buildDashboardWhaleStories(data, options));
}

export async function listWatchlistEntries(): Promise<WatchlistEntry[]> {
  return toLegacyWatchlistEntries(await loadCuratedWalletEntries());
}

export async function setWatchlistEntryEnabled(
  address: string,
  enabled: boolean,
): Promise<WatchlistEntry | null> {
  const updated = await persistCuratedWalletEnabled(address, enabled);
  if (!updated) {
    return null;
  }
  return {
    address: updated.address,
    chain: updated.chain,
    label: updated.label,
    enabled: updated.enabled,
  };
}
