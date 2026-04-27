import { getDashboardPostgresEnv } from "./env";
import { parseDateTimeSafe } from "./format";
import { Pool } from "pg";
import {
  DASHBOARD_TABS,
  SERVICE_HEALTH_V2_HEADERS,
  TAB_HEADERS,
  type DashboardTabName,
  type SheetRowMap,
  type SheetTabName,
  type TransactionRow,
} from "./schema";
import type { DashboardSheetSnapshot } from "./sheets";

type QueryResult<Row extends Record<string, unknown>> = { rows: Row[] };
type PoolLike = {
  query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const TABLES = new Set<string>([
  ...Object.keys(TAB_HEADERS),
  "service_health",
  "channel_health",
  "brief_cost_ledger",
  "broadcast_log",
  "llm_budget_log",
]);

const TIME_COLUMNS: Record<string, readonly string[]> = {
  transactions: ["last_seen_at", "created_at", "timestamp"],
  daily_brief: ["created_at"],
  signals: ["created_at"],
  system_log: ["finished_at", "started_at", "created_at"],
  subscribers: ["updated_at", "created_at"],
  tg_whale_events: ["collected_at", "tg_date"],
  curated_wallets: ["updated_at", "created_at"],
  watched_addresses: ["added_at"],
  wallet_aliases: [],
  watchlist_overrides: ["updated_at"],
  news_feed: ["last_seen_at", "fetched_at", "published_at"],
  curated_wallet_balances: ["updated_at"],
  service_health: ["ts"],
  channel_health: ["ts"],
  brief_cost_ledger: ["ts"],
  broadcast_log: ["ts"],
  llm_budget_log: ["ts"],
};
const TIE_BREAKER_ID_TABLES = new Set([
  "transactions",
  "address_activity",
  "system_log",
  "service_health",
  "signals",
  "daily_brief",
  "tg_whale_events",
  "broadcast_log",
  "brief_cost_ledger",
  "llm_budget_log",
  "channel_health",
  "user_interests",
]);

const OPTIONAL_HEADERS: Record<string, readonly string[]> = {
  service_health: SERVICE_HEALTH_V2_HEADERS,
  channel_health: ["ts", "chat_id", "title", "username", "member_count", "status", "error"],
  brief_cost_ledger: [
    "ts",
    "slot_key",
    "decision",
    "llm_called",
    "model_id",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "cumulative_cost_usd",
    "signal_count",
    "transaction_count",
    "input_fingerprint",
    "reason",
  ],
  broadcast_log: [
    "ts",
    "kind",
    "dedup_key",
    "chat_id",
    "message_id",
    "status",
    "error",
    "message_length",
    "content_hash",
    "signal_count",
    "transaction_count",
    "slot_key",
    "delivery_mode",
  ],
  llm_budget_log: [
    "ts",
    "month_key",
    "pipeline",
    "model_id",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "cumulative_cost_usd",
    "decision",
  ],
};

let pool: PoolLike | null = null;
const tableColumnCache = new Map<string, Promise<Set<string>>>();

async function getPool(): Promise<PoolLike> {
  if (pool) {
    return pool;
  }
  const { databaseUrl } = getDashboardPostgresEnv();
  pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      process.env.POSTGRES_SSLMODE?.trim().toLowerCase() === "disable"
        ? false
        : { rejectUnauthorized: false },
    max: 3,
  }) as PoolLike;
  return pool;
}

function assertTableName(table: string): void {
  if (!TABLES.has(table)) {
    throw new Error(`Unsupported Postgres dashboard table: ${table}`);
  }
}

function quoteIdent(identifier: string): string {
  assertTableName(identifier);
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function quoteColumn(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

async function existingColumns(table: string): Promise<Set<string>> {
  assertTableName(table);
  let cached = tableColumnCache.get(table);
  if (!cached) {
    cached = getPool().then(async (pool) => {
      const result = await pool.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_name = $1
            AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
        [table],
      );
      return new Set(result.rows.map((row) => row.column_name));
    });
    tableColumnCache.set(table, cached);
  }
  return cached;
}

function timeExpressionFor(table: string, columns: Set<string>): string {
  const candidates = TIME_COLUMNS[table] ?? [];
  const available = candidates.filter((column) => columns.has(column));
  if (available.length === 0) {
    return "now()";
  }
  if (available.length === 1) {
    return quoteColumn(available[0]);
  }
  return `COALESCE(${available.map(quoteColumn).join(", ")})`;
}

function rowToStrings(
  row: Record<string, unknown>,
  headers: readonly string[],
): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  for (const header of headers) {
    const value = row[header];
    if (value == null) {
      result[header] = "";
    } else if (value instanceof Date) {
      result[header] = value.toISOString();
    } else if (typeof value === "object") {
      result[header] = JSON.stringify(value);
    } else {
      result[header] = String(value);
    }
  }
  return result;
}

async function queryRows<Row extends Record<string, unknown>>(
  table: string,
  headers: readonly string[],
  options: { limit?: number } = {},
): Promise<Row[]> {
  const pool = await getPool();
  const existing = await existingColumns(table);
  if (existing.size === 0) {
    return [];
  }
  const selectedHeaders = headers.filter((header) => existing.has(header));
  if (selectedHeaders.length === 0) {
    return [];
  }
  const columns = selectedHeaders.map(quoteColumn).join(", ");
  const timeExpr = timeExpressionFor(table, existing);
  const params: unknown[] = [];
  const { limit } = options;
  const limitClause = limit && limit > 0 ? " LIMIT $1" : "";
  if (limitClause) {
    params.push(limit);
  }
  const tieBreaker = TIE_BREAKER_ID_TABLES.has(table) && existing.has("id") ? ", id DESC" : "";
  const sql = `SELECT ${columns} FROM ${quoteIdent(table)} ORDER BY ${timeExpr} DESC${tieBreaker}${limitClause}`;
  const result = await pool.query<Row>(sql, params);
  return result.rows.reverse();
}

export async function readPostgresRows<T extends SheetTabName>(
  tab: T,
): Promise<SheetRowMap[T][]> {
  const limit = tab === "transactions" ? 200 : 5000;
  const rows = await queryRows<Record<string, unknown>>(tab, TAB_HEADERS[tab], { limit });
  return rows.map((row) => rowToStrings(row, TAB_HEADERS[tab])) as unknown as SheetRowMap[T][];
}

export async function readPostgresOptionalRows(tabName: string): Promise<Array<Record<string, string>>> {
  assertTableName(tabName);
  const knownHeaders = (TAB_HEADERS as Record<string, readonly string[]>)[tabName];
  const headers = knownHeaders ?? OPTIONAL_HEADERS[tabName] ?? SERVICE_HEALTH_V2_HEADERS;
  const rows = await queryRows<Record<string, unknown>>(tabName, headers, { limit: 5000 });
  return rows.map((row) => rowToStrings(row, headers));
}

async function readTransactionsAggregate(): Promise<{
  rows: TransactionRow[];
  total: number;
  latestAt: string | null;
}> {
  const pool = await getPool();
  const [rows, countResult] = await Promise.all([
    queryRows<Record<string, unknown>>("transactions", TAB_HEADERS.transactions, { limit: 200 }),
    pool
      .query<{ count: string }>("SELECT count(*)::text AS count FROM transactions")
      .catch(() => ({ rows: [{ count: "0" }] })),
  ]);
  const txRows = rows.map((row) => rowToStrings(row, TAB_HEADERS.transactions)) as unknown as TransactionRow[];
  let latestAt: string | null = null;
  let latestMs = -Infinity;
  for (const row of txRows) {
    const ts = row.last_seen_at || row.created_at || row.timestamp;
    const parsed = parseDateTimeSafe(ts);
    if (parsed != null && parsed > latestMs) {
      latestMs = parsed;
      latestAt = ts;
    }
  }
  return {
    rows: txRows,
    total: Number(countResult.rows[0]?.count ?? txRows.length),
    latestAt,
  };
}

export async function readPostgresDashboardSnapshot(): Promise<DashboardSheetSnapshot> {
  const [txAggregate, dailyBrief, signals, systemLog, subscribers, tgEvents] = await Promise.all([
    readTransactionsAggregate(),
    readPostgresRows("daily_brief"),
    readPostgresRows("signals"),
    readPostgresRows("system_log"),
    readPostgresRows("subscribers"),
    readPostgresRows("tg_whale_events"),
  ]);

  return {
    transactions: txAggregate.rows,
    transactionsTotal: txAggregate.total,
    transactionsLatestAt: txAggregate.latestAt,
    daily_brief: dailyBrief,
    signals,
    system_log: systemLog,
    subscribers,
    tg_whale_events: tgEvents,
  };
}

export async function readPostgresDashboardSnapshotSafe(): Promise<{
  snapshot: DashboardSheetSnapshot;
  failedTabs: Array<{ tab: DashboardTabName; error: string }>;
}> {
  const failedTabs: Array<{ tab: DashboardTabName; error: string }> = [];
  try {
    return { snapshot: await readPostgresDashboardSnapshot(), failedTabs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const tab of DASHBOARD_TABS) {
      failedTabs.push({ tab, error: message });
    }
    return {
      snapshot: {
        transactions: [],
        transactionsTotal: 0,
        transactionsLatestAt: null,
        daily_brief: [],
        signals: [],
        system_log: [],
        subscribers: [],
        tg_whale_events: [],
      },
      failedTabs,
    };
  }
}
