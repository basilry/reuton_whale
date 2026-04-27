import { JWT } from "google-auth-library";

import { getDashboardDataBackend, getDashboardEnv, SHEETS_SCOPES } from "./env";
import {
  columnLabel,
  newestFirst,
  rowHasContent,
  parseDateTimeSafe,
} from "./format";
import {
  SHEET_CACHE_BATCH_DASHBOARD_KEY,
  redisCacheDeleteMany,
  redisCacheGet,
  redisCacheSet,
  sheetTabCacheKey,
} from "./redis-cache";
import {
  DASHBOARD_TABS,
  TAB_HEADERS,
  type DashboardTabName,
  type WatchlistOverrideRow,
  type DailyBriefRow,
  type SheetRowMap,
  type SheetTabName,
  type SignalRow,
  type SystemLogRow,
  type TgWhaleEventRow,
  type TransactionRow,
} from "./schema";
import {
  readPostgresDashboardSnapshot,
  readPostgresDashboardSnapshotSafe,
  readPostgresRows,
} from "./postgres";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_WRITE_SCOPES = [
  ...SHEETS_SCOPES,
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

// Google Sheets API quota: 60 reads/min per user. Cache aggressively so a
// single dashboard page load doesn't consume the entire quota.
// Tab hotness tiers: hot tabs refresh frequently (live signals/whale events),
// warm tabs change a few times per hour (briefs, news), cold tabs are
// reference data that changes maybe daily.
const HOT_TTL_MS = 45_000;          // 45s — live streams
const WARM_TTL_MS = 120_000;        // 2m — briefs / news / aggregates
const COLD_TTL_MS = 10 * 60_000;    // 10m — config / reference lists
const SHEET_STALE_TTL_MS = 15 * 60_000;

const TAB_TTLS: Record<SheetTabName, number> = {
  transactions:             HOT_TTL_MS,
  signals:                  HOT_TTL_MS,
  tg_whale_events:          HOT_TTL_MS,
  daily_brief:              WARM_TTL_MS,
  system_log:               WARM_TTL_MS,
  subscribers:              WARM_TTL_MS,
  news_feed:                WARM_TTL_MS,
  curated_wallet_balances:  WARM_TTL_MS,
  curated_wallets:          COLD_TTL_MS,
  wallet_detail_profiles:   COLD_TTL_MS,
  watched_addresses:        COLD_TTL_MS,
  wallet_aliases:           COLD_TTL_MS,
  watchlist_overrides:      COLD_TTL_MS,
};

const tabTtlMs = (tab: SheetTabName) => TAB_TTLS[tab] ?? WARM_TTL_MS;
const tabTtlSeconds = (tab: SheetTabName) => Math.ceil(tabTtlMs(tab) / 1000);

// Batch aggregate contains hot tabs (signals, transactions) so we keep the
// batch cache at hot cadence to avoid serving stale signals.
const BATCH_CACHE_TTL_MS = HOT_TTL_MS;
const BATCH_CACHE_TTL_SECONDS = Math.ceil(BATCH_CACHE_TTL_MS / 1000);
const TRANSACTIONS_RECENT_LIMIT = 200;

type TabCacheEntry = { at: number; rows: unknown[] };
const tabCache = new Map<SheetTabName, TabCacheEntry>();
const tabInflight = new Map<SheetTabName, Promise<unknown[]>>();

type BatchCacheEntry = { at: number; snapshot: DashboardSheetSnapshot };
let batchCache: BatchCacheEntry | null = null;
let batchInflight: Promise<DashboardSheetSnapshot> | null = null;

type SheetValuesResponse = {
  spreadsheetId?: string;
  valueRanges?: Array<{
    range?: string;
    majorDimension?: string;
    values?: string[][];
  }>;
};

type SheetSingleValuesResponse = {
  range?: string;
  majorDimension?: string;
  values?: string[][];
};

type SheetMetadataResponse = {
  sheets?: Array<{
    properties?: {
      title?: string;
      gridProperties?: {
        rowCount?: number;
      };
    };
  }>;
};

export type TransactionsAggregate = {
  rows: TransactionRow[];
  total: number;
  latestAt: string | null;
};

export type DashboardSheetSnapshot = {
  transactions: TransactionRow[];
  transactionsTotal: number;
  transactionsLatestAt: string | null;
  daily_brief: DailyBriefRow[];
  signals: SignalRow[];
  system_log: SystemLogRow[];
  subscribers: SheetRowMap["subscribers"][];
  tg_whale_events: TgWhaleEventRow[];
};

export interface ListRowsOptions {
  limit?: number;
}

class SheetsReadClient {
  private readonly auth: JWT;
  private accessTokenPromise: Promise<string> | null = null;

  constructor() {
    const env = getDashboardEnv();
    const key = env.credentials.private_key;
    this.auth = new JWT({
      email: env.credentials.client_email,
      key,
      scopes: [...SHEETS_SCOPES],
      projectId: env.credentials.project_id,
      subject: undefined,
    });
    this.sheetId = env.sheetId;
  }

  private readonly sheetId: string;

  private async getAccessToken(): Promise<string> {
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.auth.authorize().then((tokens) => {
        const token = tokens.access_token;
        if (!token) {
          throw new Error("Failed to authorize Google Sheets client");
        }
        return token;
      });
    }

    return this.accessTokenPromise;
  }

  private async requestJson<T>(url: string): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets API request failed (${response.status} ${response.statusText}): ${body}`
      );
    }

    return (await response.json()) as T;
  }

  private rangeFor(tab: SheetTabName): string {
    const headers = TAB_HEADERS[tab];
    return `${tab}!A:${columnLabel(headers.length)}`;
  }

  private valuesToRows<T extends SheetTabName>(
    tab: T,
    values: string[][] | undefined
  ): SheetRowMap[T][] {
    if (!values || values.length <= 1) {
      return [];
    }

    const rows: SheetRowMap[T][] = [];
    for (const rawRow of values.slice(1)) {
      const row = this.rowToObject(tab, rawRow);
      if (rowHasContent(row)) {
        rows.push(row);
      }
    }
    return rows;
  }

  private rowToObject<T extends SheetTabName>(
    tab: T,
    rawRow: string[]
  ): SheetRowMap[T] {
    const headers = TAB_HEADERS[tab];
    const row = Object.create(null) as SheetRowMap[T];
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index] as keyof SheetRowMap[T];
      row[header] = (rawRow[index] ?? "") as SheetRowMap[T][typeof header];
    }
    return row;
  }

  async readTab<T extends SheetTabName>(tab: T): Promise<SheetRowMap[T][]> {
    const now = Date.now();
    const ttl = tabTtlMs(tab);
    const cached = tabCache.get(tab);
    if (cached && now - cached.at < ttl) {
      return cached.rows as SheetRowMap[T][];
    }

    const existing = tabInflight.get(tab);
    if (existing) {
      return existing as Promise<SheetRowMap[T][]>;
    }

    const l2Key = sheetTabCacheKey(tab);
    const promise = (async () => {
      try {
        const l2Cached = await redisCacheGet<SheetRowMap[T][]>(l2Key);
        if (l2Cached) {
          tabCache.set(tab, { at: Date.now(), rows: l2Cached });
          return l2Cached;
        }

        const url = new URL(`${SHEETS_API_BASE}/${this.sheetId}/values/${encodeURIComponent(this.rangeFor(tab))}`);
        url.searchParams.set("majorDimension", "ROWS");
        url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
        const payload = await this.requestJson<SheetSingleValuesResponse>(url.toString());
        const rows = this.valuesToRows(tab, payload.values);
        tabCache.set(tab, { at: Date.now(), rows });
        void redisCacheSet(l2Key, rows, tabTtlSeconds(tab));
        return rows;
      } catch (error) {
        if (cached && now - cached.at < SHEET_STALE_TTL_MS) {
          return cached.rows as SheetRowMap[T][];
        }
        throw error;
      } finally {
        tabInflight.delete(tab);
      }
    })();
    tabInflight.set(tab, promise as Promise<unknown[]>);
    return promise;
  }

  async readTabs<T extends readonly SheetTabName[]>(
    tabs: T
  ): Promise<{ [K in T[number]]: SheetRowMap[K][] }> {
    if (tabs.length === 0) {
      return {} as { [K in T[number]]: SheetRowMap[K][] };
    }

    const url = new URL(`${SHEETS_API_BASE}/${this.sheetId}/values:batchGet`);
    for (const tab of tabs) {
      url.searchParams.append("ranges", this.rangeFor(tab));
    }
    url.searchParams.set("majorDimension", "ROWS");
    url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");

    const payload = await this.requestJson<SheetValuesResponse>(url.toString());
    const valueRanges = payload.valueRanges ?? [];

    const result = {} as { [K in T[number]]: SheetRowMap[K][] };
    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index];
      const typedTab = tab as T[number];
      const rows = this.valuesToRows(typedTab, valueRanges[index]?.values);
      result[typedTab] = rows;
      tabCache.set(tab, { at: Date.now(), rows });
    }
    return result;
  }

  async readTransactionsAggregate(): Promise<TransactionsAggregate> {
    const metaUrl = new URL(`${SHEETS_API_BASE}/${this.sheetId}`);
    metaUrl.searchParams.set(
      "fields",
      "sheets.properties(title,gridProperties(rowCount))",
    );
    const meta = await this.requestJson<SheetMetadataResponse>(metaUrl.toString());
    const txSheet = (meta.sheets ?? []).find(
      (sheet) => sheet?.properties?.title === "transactions",
    );
    const rowCount = txSheet?.properties?.gridProperties?.rowCount ?? 0;
    const total = Math.max(0, rowCount - 1);

    let rows: TransactionRow[] = [];
    if (rowCount > 1) {
      const headers = TAB_HEADERS["transactions"];
      const endCol = columnLabel(headers.length);
      const start = Math.max(2, rowCount - TRANSACTIONS_RECENT_LIMIT + 1);
      const range = `transactions!A${start}:${endCol}${rowCount}`;
      const rangeUrl = new URL(
        `${SHEETS_API_BASE}/${this.sheetId}/values/${encodeURIComponent(range)}`,
      );
      rangeUrl.searchParams.set("majorDimension", "ROWS");
      rangeUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
      const payload = await this.requestJson<SheetSingleValuesResponse>(
        rangeUrl.toString(),
      );
      const values = payload.values ?? [];
      rows = [];
      for (const raw of values) {
        const row = this.rowToObject("transactions", raw) as TransactionRow;
        if (rowHasContent(row)) {
          rows.push(row);
        }
      }
    }

    let latestAt: string | null = null;
    let latestMs = -Infinity;
    for (const row of rows) {
      const ts = row.created_at || row.timestamp;
      if (!ts) continue;
      const parsed = parseDateTimeSafe(ts);
      if (parsed != null && parsed > latestMs) {
        latestMs = parsed;
        latestAt = ts;
      }
    }

    return { rows, total, latestAt };
  }

  async readDashboardAggregate(): Promise<DashboardSheetSnapshot> {
    const now = Date.now();
    if (batchCache && now - batchCache.at < BATCH_CACHE_TTL_MS) {
      return batchCache.snapshot;
    }
    if (batchInflight) {
      return batchInflight;
    }

    batchInflight = (async () => {
      try {
        const l2Cached = await redisCacheGet<DashboardSheetSnapshot>(
          SHEET_CACHE_BATCH_DASHBOARD_KEY,
        );
        if (l2Cached && typeof l2Cached.transactionsTotal === "number") {
          const hydratedAt = Date.now();
          batchCache = { at: hydratedAt, snapshot: l2Cached };
          for (const tab of DASHBOARD_TABS) {
            const rows = l2Cached[tab] as unknown[] | undefined;
            if (Array.isArray(rows)) {
              tabCache.set(tab, { at: hydratedAt, rows });
            }
          }
          return l2Cached;
        }

        const nonTxTabs = DASHBOARD_TABS.filter(
          (tab): tab is Exclude<DashboardTabName, "transactions"> =>
            tab !== "transactions",
        );
        const [nonTxResult, txAggregate] = await Promise.all([
          this.readTabs(nonTxTabs),
          this.readTransactionsAggregate(),
        ]);

        const snapshot: DashboardSheetSnapshot = {
          transactions: txAggregate.rows,
          transactionsTotal: txAggregate.total,
          transactionsLatestAt: txAggregate.latestAt,
          daily_brief: nonTxResult.daily_brief,
          signals: nonTxResult.signals,
          system_log: nonTxResult.system_log,
          subscribers: nonTxResult.subscribers,
          tg_whale_events: nonTxResult.tg_whale_events,
        };
        batchCache = { at: Date.now(), snapshot };
        tabCache.set("transactions", {
          at: Date.now(),
          rows: snapshot.transactions,
        });
        void redisCacheSet(
          SHEET_CACHE_BATCH_DASHBOARD_KEY,
          snapshot,
          BATCH_CACHE_TTL_SECONDS,
        );
        return snapshot;
      } catch (error) {
        if (batchCache && now - batchCache.at < SHEET_STALE_TTL_MS) {
          return batchCache.snapshot;
        }
        throw error;
      } finally {
        batchInflight = null;
      }
    })();
    return batchInflight;
  }

  async listRows<T extends SheetTabName>(
    tab: T,
    options: ListRowsOptions = {}
  ): Promise<SheetRowMap[T][]> {
    const rows = await this.readTab(tab);
    const limit = options.limit ?? rows.length;
    return newestFirst(rows, (row) => this.rowTime(tab, row)).slice(0, limit);
  }

  private rowTime<T extends SheetTabName>(
    tab: T,
    row: SheetRowMap[T]
  ): number | null {
    if (tab === "transactions") {
      const tx = row as TransactionRow;
      return parseDateTimeSafe(tx.created_at) ?? parseDateTimeSafe(tx.timestamp);
    }
    if (tab === "daily_brief") {
      const brief = row as DailyBriefRow;
      return parseDateTimeSafe(brief.created_at) ?? parseDateTimeSafe(brief.date);
    }
    if (tab === "signals") {
      const signal = row as SignalRow;
      return parseDateTimeSafe(signal.created_at);
    }
    if (tab === "system_log") {
      const log = row as SystemLogRow;
      return parseDateTimeSafe(log.finished_at) ?? parseDateTimeSafe(log.started_at);
    }
    if (tab === "tg_whale_events") {
      const event = row as TgWhaleEventRow;
      return parseDateTimeSafe(event.collected_at) ?? parseDateTimeSafe(event.tg_date);
    }
    return null;
  }
}

type SheetAppendResponse = {
  updates?: {
    updatedRange?: string;
    updatedRows?: number;
    updatedColumns?: number;
    updatedCells?: number;
  };
};

class SheetsWriteClient {
  private readonly auth: JWT;
  private accessTokenPromise: Promise<string> | null = null;

  constructor() {
    const env = getDashboardEnv();
    this.auth = new JWT({
      email: env.credentials.client_email,
      key: env.credentials.private_key,
      scopes: [...SHEETS_WRITE_SCOPES],
      projectId: env.credentials.project_id,
      subject: undefined,
    });
    this.sheetId = env.sheetId;
  }

  private readonly sheetId: string;

  private async getAccessToken(): Promise<string> {
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.auth.authorize().then((tokens) => {
        const token = tokens.access_token;
        if (!token) {
          throw new Error("Failed to authorize Google Sheets client");
        }
        return token;
      });
    }

    return this.accessTokenPromise;
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");

    if (init.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets API request failed (${response.status} ${response.statusText}): ${body}`
      );
    }

    return (await response.json()) as T;
  }

  private rangeFor(tab: SheetTabName): string {
    const headers = TAB_HEADERS[tab];
    return `${tab}!A:${columnLabel(headers.length)}`;
  }

  private rowToValues<T extends SheetTabName>(tab: T, row: SheetRowMap[T]): string[] {
    return TAB_HEADERS[tab].map((header) => {
      const value = row[header as keyof SheetRowMap[T]];
      return value == null ? "" : String(value);
    });
  }

  async appendRow<T extends SheetTabName>(tab: T, row: SheetRowMap[T]): Promise<void> {
    const url = new URL(
      `${SHEETS_API_BASE}/${this.sheetId}/values/${encodeURIComponent(this.rangeFor(tab))}:append`
    );
    url.searchParams.set("valueInputOption", "RAW");
    url.searchParams.set("insertDataOption", "INSERT_ROWS");
    url.searchParams.set("includeValuesInResponse", "false");

    await this.requestJson<SheetAppendResponse>(url.toString(), {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [this.rowToValues(tab, row)],
      }),
    });
  }
}

let sharedClient: SheetsReadClient | null = null;
let sharedWriteClient: SheetsWriteClient | null = null;

export function getSheetsReadClient(): SheetsReadClient {
  if (!sharedClient) {
    sharedClient = new SheetsReadClient();
  }
  return sharedClient;
}

export function getSheetsWriteClient(): SheetsWriteClient {
  if (!sharedWriteClient) {
    sharedWriteClient = new SheetsWriteClient();
  }
  return sharedWriteClient;
}

export async function readSheetRows<T extends SheetTabName>(
  tab: T
): Promise<SheetRowMap[T][]> {
  if (getDashboardDataBackend() === "postgres") {
    return readPostgresRows(tab);
  }
  return getSheetsReadClient().readTab(tab);
}

export async function listTransactions(limit = 20): Promise<TransactionRow[]> {
  return getSheetsReadClient().listRows("transactions", { limit });
}

export async function listSignals(limit = 20): Promise<SignalRow[]> {
  return getSheetsReadClient().listRows("signals", { limit });
}

export async function listSystemLog(limit = 25): Promise<SystemLogRow[]> {
  return getSheetsReadClient().listRows("system_log", { limit });
}

export async function listDailyBriefs(): Promise<DailyBriefRow[]> {
  return getSheetsReadClient().listRows("daily_brief", { limit: 50 });
}

export async function readDashboardSnapshot(): Promise<DashboardSheetSnapshot> {
  if (getDashboardDataBackend() === "postgres") {
    return readPostgresDashboardSnapshot();
  }
  return getSheetsReadClient().readDashboardAggregate();
}

export async function readDashboardSnapshotSafe(): Promise<{
  snapshot: DashboardSheetSnapshot;
  failedTabs: Array<{ tab: DashboardTabName; error: string }>;
}> {
  if (getDashboardDataBackend() === "postgres") {
    return readPostgresDashboardSnapshotSafe();
  }
  const client = getSheetsReadClient();
  const failedTabs: Array<{ tab: DashboardTabName; error: string }> = [];

  try {
    const snapshot = await client.readDashboardAggregate();
    return { snapshot, failedTabs };
  } catch (error) {
    const batchMessage = error instanceof Error ? error.message : String(error);
    console.error("[sheets/readDashboardSnapshotSafe] aggregate failed, falling back per-tab:", batchMessage);
  }

  let txAggregate: TransactionsAggregate = { rows: [], total: 0, latestAt: null };
  try {
    txAggregate = await client.readTransactionsAggregate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sheets/readDashboardSnapshotSafe] tab transactions failed: ${message}`);
    failedTabs.push({ tab: "transactions", error: message });
  }

  const nonTxTabs = DASHBOARD_TABS.filter(
    (tab): tab is Exclude<DashboardTabName, "transactions"> => tab !== "transactions",
  );
  const results = await Promise.all(
    nonTxTabs.map(async (tab) => {
      try {
        const rows = await client.readTab(tab);
        return { tab, rows };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[sheets/readDashboardSnapshotSafe] tab ${tab} failed: ${message}`);
        failedTabs.push({ tab, error: message });
        return { tab, rows: [] };
      }
    })
  );

  const byTab = Object.create(null) as Record<string, unknown[]>;
  for (const { tab, rows } of results) {
    byTab[tab] = rows;
  }

  return {
    snapshot: {
      transactions: txAggregate.rows,
      transactionsTotal: txAggregate.total,
      transactionsLatestAt: txAggregate.latestAt,
      daily_brief: (byTab.daily_brief ?? []) as DashboardSheetSnapshot["daily_brief"],
      signals: (byTab.signals ?? []) as DashboardSheetSnapshot["signals"],
      system_log: (byTab.system_log ?? []) as DashboardSheetSnapshot["system_log"],
      subscribers: (byTab.subscribers ?? []) as DashboardSheetSnapshot["subscribers"],
      tg_whale_events: (byTab.tg_whale_events ?? []) as DashboardSheetSnapshot["tg_whale_events"],
    },
    failedTabs,
  };
}

export async function upsertWatchlistOverride(
  row: Omit<WatchlistOverrideRow, "enabled"> & { enabled: boolean }
): Promise<void> {
  await getSheetsWriteClient().appendRow("watchlist_overrides", {
    wallet_id: row.wallet_id,
    enabled: row.enabled ? "TRUE" : "FALSE",
    actor: row.actor,
    reason: row.reason,
    updated_at: row.updated_at,
  });
  tabCache.delete("watchlist_overrides");
  batchCache = null;
  await redisCacheDeleteMany([
    sheetTabCacheKey("watchlist_overrides"),
    SHEET_CACHE_BATCH_DASHBOARD_KEY,
  ]);
}
