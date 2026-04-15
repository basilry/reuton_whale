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
  type TransactionRow,
} from "./schema";
import {
  readDashboardSnapshot,
  readSheetRows,
} from "./sheets";

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

function latestBrief(rows: DailyBriefRow[]): DailyBriefRow | null {
  if (rows.length === 0) {
    return null;
  }

  return newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.date);
  })[0] ?? null;
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

function normalizeSystemLogRows(rows: SystemLogRow[]) {
  return rows.map((row) => {
    const normalized = normalizeLatestRun(row);
    const errorCount = errorCountForRun(row);
    return {
      id: row.run_id,
      ...normalized,
      timestamp: row.finished_at || row.started_at,
      status: row.status,
      title: row.run_type || "Pipeline run",
      message:
        row.details ||
        (errorCount > 0 ? `${errorCount} error(s): ${row.errors}` : "No details recorded."),
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

  const systemLogs = newestFirst(snapshot.system_log, (row) => {
    return parseDateTimeSafe(row.finished_at) ?? parseDateTimeSafe(row.started_at);
  }).slice(0, systemLogLimit);

  const currentLatestRunRow = latestSystemLog(systemLogs);
  const currentLatestRun = currentLatestRunRow
    ? normalizeLatestRun(currentLatestRunRow)
    : null;
  const currentLatestBrief = latestBrief(snapshot.daily_brief);
  const latestRunErrorCount = errorCountForRun(currentLatestRunRow);
  const latestRunStatus = currentLatestRun?.status ?? "unknown";
  const latestRunUpdatedAt = currentLatestRun?.finished_at || currentLatestRun?.started_at || undefined;

  return {
    generatedAt: new Date().toISOString(),
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
