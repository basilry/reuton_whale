import { JWT } from "google-auth-library";

import { getDashboardEnv, SHEETS_SCOPES } from "./env";
import {
  columnLabel,
  newestFirst,
  rowHasContent,
  parseDateTimeSafe,
} from "./format";
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

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_WRITE_SCOPES = [
  ...SHEETS_SCOPES,
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

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

export type DashboardSheetSnapshot = {
  transactions: TransactionRow[];
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
    const url = new URL(`${SHEETS_API_BASE}/${this.sheetId}/values/${encodeURIComponent(this.rangeFor(tab))}`);
    url.searchParams.set("majorDimension", "ROWS");
    url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");

    const payload = await this.requestJson<SheetSingleValuesResponse>(url.toString());
    return this.valuesToRows(tab, payload.values);
  }

  async readTabs<T extends readonly DashboardTabName[]>(
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
      result[typedTab] = this.valuesToRows(typedTab, valueRanges[index]?.values);
    }
    return result;
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
  const tabs = await getSheetsReadClient().readTabs(DASHBOARD_TABS);
  return {
    transactions: tabs.transactions,
    daily_brief: tabs.daily_brief,
    signals: tabs.signals,
    system_log: tabs.system_log,
    subscribers: tabs.subscribers,
    tg_whale_events: tabs.tg_whale_events,
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
}
