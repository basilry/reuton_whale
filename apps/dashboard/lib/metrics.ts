import { JWT } from "google-auth-library";

import {
  compactString,
  newestFirst,
  parseFloatSafe,
  parseDateTimeSafe,
  parseIntSafe,
  parseJsonSafe,
} from "./format";
import {
  type DailyBriefRow,
  type SignalRow,
  type SystemLogRow,
  type TgWhaleEventRow,
  type TransactionRow,
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
import { getDashboardEnv, SHEETS_SCOPES } from "./env";
import {
  readDashboardSnapshot,
  readSheetRows,
} from "./sheets";
import { buildWhaleStories, buildWhaleStoryCards } from "./whale-stories";
import type {
  BriefMarketMood,
  CuratedWalletEntry,
  CuratedWatchlistItem,
  DisplaySignalRow,
  OperatorCheck,
  OpsServiceHealth,
  OpsServiceName,
  OpsServiceStatus,
  OpsSummary,
  SourceFailureKind,
  SourceHealth,
  WhaleStory,
} from "./types";

export const LISTENER_STALE_MINUTES = 15;
export const PIPELINE_STALE_MINUTES = 20;
export const PIPELINE_DOWN_MINUTES = 45;
export const SOURCE_STALE_MINUTES = 30;

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
  details: unknown;
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

function latestTimestamp(...values: Array<string | undefined | null>): string | undefined {
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
    console.warn(`[metrics] Optional tab ${tabName} unavailable`, error);
    return [];
  }
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

function findServiceHealthOverride(
  rows: OptionalSheetRow[],
  aliases: string[],
): OptionalSheetRow | null {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  const candidates = rows.filter((row) => {
    const name = rowValue(row, ["service", "service_name", "component", "name"]).toLowerCase();
    return normalizedAliases.includes(name);
  });
  return latestOptionalRow(candidates, ["checked_at", "updated_at", "ts", "created_at"]);
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
  const details = parseJsonSafe(row.details) ?? row.details;

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
    const normalized = normalizeLatestRun(row);
    const errorCount = errorCountForRun(row);
    const humanized = humanizeLogMessage(row);
    return {
      id: row.run_id,
      ...normalized,
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

  const updatedAt = rowValue(overrideRow, ["checked_at", "updated_at", "ts", "created_at"]);
  return {
    ...fallback,
    name,
    label: rowValue(overrideRow, ["label", "state_label", "status_label"]) || fallback.label,
    status: normalizeOpsStatusValue(
      rowValue(overrideRow, ["status", "state"]),
      fallback.status,
    ),
    summary: rowValue(overrideRow, ["summary", "message", "detail"]) || fallback.summary,
    detail: rowValue(overrideRow, ["detail", "error", "hint"]) || fallback.detail,
    updatedAt: updatedAt || fallback.updatedAt,
    source: rowValue(overrideRow, ["source", "origin"]) || fallback.source,
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
}): OperatorCheck[] {
  const checks: OperatorCheck[] = [];
  const sheetId = envText("GOOGLE_SHEET_ID");
  const credentials = envText("GOOGLE_CREDENTIALS_JSON");
  const telethonConfigured = Boolean(envText("TELETHON_SESSION_STRING")) ||
    (Boolean(envText("TELETHON_API_ID")) && Boolean(envText("TELETHON_API_HASH")));
  const llmConfigured = Boolean(
    envText("ANTHROPIC_API_KEY") || envText("GEMINI_API_KEY") || envText("GROQ_API_KEY"),
  );

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
    updatedAt: latestTimestamp(...entries.map((item) => item.updatedAt)),
  };
}

export async function getDashboardData(options?: {
  transactionLimit?: number;
  signalLimit?: number;
  systemLogLimit?: number;
}): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();
  const transactionLimit = options?.transactionLimit ?? 20;
  const signalLimit = options?.signalLimit ?? 20;
  const systemLogLimit = options?.systemLogLimit ?? 25;
  const [snapshot, curatedWalletBundle, serviceHealthRows, channelHealthRows] = await Promise.all([
    readDashboardSnapshot(),
    loadCuratedWalletEntriesWithMeta(),
    readOptionalSheetRows("service_health"),
    readOptionalSheetRows("channel_health"),
  ]);
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
  const latestRunErrorCount = errorCountForRun(currentLatestRunRow);
  const latestRunStatus = currentLatestRun?.status ?? "unknown";
  const latestRunUpdatedAt = currentLatestRun?.finished_at || currentLatestRun?.started_at || undefined;
  const transactionUpdatedAt = latestTimestamp(...snapshot.transactions.map((row) => row.created_at || row.timestamp));
  const signalUpdatedAt = latestTimestamp(...snapshot.signals.map((row) => row.created_at));
  const briefUpdatedAt = currentLatestBrief?.created_at || currentLatestBrief?.date || undefined;
  const rowCounts: RowCounts = {
    transactions: snapshot.transactions.length,
    daily_brief: snapshot.daily_brief.length,
    signals: snapshot.signals.length,
    system_log: snapshot.system_log.length,
    subscribers: snapshot.subscribers.length,
  };
  const dataSourceOverrideRow = findServiceHealthOverride(serviceHealthRows, ["data_source", "google_sheets", "sheets"]);
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
  const dataSourceOverrideError = rowValue(dataSourceOverrideRow, ["error", "detail", "message"]);
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
  const serviceHealth: Record<OpsServiceName, OpsServiceHealth> = {
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
  const operatorChecks = buildOperatorChecks({
    sourceHealth,
    services: serviceHealth,
    curatedRegistryMeta,
  });
  const opsSummary = buildOpsSummary(serviceHealth);

  return {
    generatedAt,
    source: "google_sheets",
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
      transactionCount: snapshot.transactions.length,
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
  };
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
