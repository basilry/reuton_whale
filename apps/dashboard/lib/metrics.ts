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
  readDashboardSnapshot,
  readSheetRows,
} from "./sheets";

export const LISTENER_STALE_MINUTES = 15;

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

export interface DashboardBrief {
  date?: string;
  generatedAt?: string;
  summary: string;
  alertCount: number;
  totalVolumeUsd: number;
  highlights: string[];
  signalThemes: string[];
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
  recentSignals: SignalRow[];
  latestRun: (LatestRunSummary & {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  }) | null;
  listenerHealth: ListenerHealth;
  systemLogs: Array<{
    id: string;
    timestamp: string;
    status: string;
    title: string;
    message: string;
  }>;
  metrics: DashboardMetrics;
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
  const pipelineRows = rows.filter((row) => row.run_type === "daily_brief");
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

function normalizeBrief(row: DailyBriefRow | null): DashboardBrief | null {
  if (!row) {
    return null;
  }

  return {
    date: row.date || undefined,
    generatedAt: row.created_at || undefined,
    summary: row.summary,
    alertCount: parseIntSafe(compactString(row.alert_count)) ?? 0,
    totalVolumeUsd: parseFloatSafe(compactString(row.total_volume_usd)) ?? 0,
    highlights: [],
    signalThemes: [],
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

export async function getDashboardData(options?: {
  transactionLimit?: number;
  signalLimit?: number;
  systemLogLimit?: number;
}): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();
  const snapshot = await readDashboardSnapshot();
  const transactionLimit = options?.transactionLimit ?? 20;
  const signalLimit = options?.signalLimit ?? 20;
  const systemLogLimit = options?.systemLogLimit ?? 25;

  const recentTransactions = newestFirst(snapshot.transactions, (row) => {
    return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.timestamp);
  }).slice(0, transactionLimit);

  const recentSignals = newestFirst(snapshot.signals, (row) => {
    return parseDateTimeSafe(row.created_at);
  }).slice(0, signalLimit);

  const sortedSystemLogs = newestFirst(snapshot.system_log, (row) => {
    return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
  });
  const systemLogs = sortedSystemLogs.slice(0, systemLogLimit);

  const currentLatestRunRow = latestPipelineLog(sortedSystemLogs);
  const currentLatestRun = currentLatestRunRow
    ? normalizeLatestRun(currentLatestRunRow)
    : null;
  const currentLatestBrief = latestBrief(snapshot.daily_brief);
  const latestRunErrorCount = errorCountForRun(currentLatestRunRow);
  const latestRunStatus = currentLatestRun?.status ?? "unknown";
  const latestRunUpdatedAt = currentLatestRun?.finished_at || currentLatestRun?.started_at || undefined;

  return {
    generatedAt,
    source: "google_sheets",
    latestBrief: normalizeBrief(currentLatestBrief),
    recentTransactions,
    recentSignals,
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
    listenerHealth: normalizeListenerHealth(sortedSystemLogs, snapshot.tg_whale_events, generatedAt),
    systemLogs: normalizeSystemLogRows(systemLogs),
    metrics: {
      transactionCount: snapshot.transactions.length,
      signalCount: snapshot.signals.length,
      dailyBriefCount: snapshot.daily_brief.length,
      subscriberCount: snapshot.subscribers.length,
      latestRunStatus,
      latestRunErrorCount,
      lastUpdatedAt: latestRunUpdatedAt,
      rowCounts: {
        transactions: snapshot.transactions.length,
        daily_brief: snapshot.daily_brief.length,
        signals: snapshot.signals.length,
        system_log: snapshot.system_log.length,
        subscribers: snapshot.subscribers.length,
      },
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
