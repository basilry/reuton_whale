import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { TAB_HEADERS, type SheetTabName } from "./schema";

export const SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
] as const;

export class DashboardConfigError extends Error {
  override name = "DashboardConfigError";
}

export interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

export interface DashboardEnv {
  sheetId: string;
  credentials: GoogleServiceAccountCredentials;
}

export type DashboardDataBackend = "sheets" | "postgres";

export interface DashboardPostgresEnv {
  databaseUrl: string;
}

export interface LiveUpdatesEnv {
  enabled: boolean;
  configured: boolean;
  configurationReason?: "redis_missing" | "token_missing";
  restUrl?: string;
  restToken?: string;
}

export type RenderServiceEnvMap = {
  pipeline: string;
  listener: string;
  bot: string;
};

export type RenderEnvKey =
  | "RENDER_API_KEY"
  | "RENDER_OWNER_ID"
  | "RENDER_SERVICE_ID_PIPELINE"
  | "RENDER_SERVICE_ID_LISTENER"
  | "RENDER_SERVICE_ID_BOT";

export interface RenderEnv {
  apiKey: string;
  ownerId: string;
  serviceIds: RenderServiceEnvMap;
}

export interface RenderEnvState {
  configured: boolean;
  missingEnv: RenderEnvKey[];
  apiKey?: string;
  ownerId?: string;
  serviceIds: Partial<RenderServiceEnvMap>;
}

type EnvMap = Record<string, string>;

function missingEnvError(keys: string[]): DashboardConfigError {
  return new DashboardConfigError(
    `Missing required environment variable${keys.length > 1 ? "s" : ""}: ${keys.join(", ")}`
  );
}

function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if (
    trimmed.length >= 2 &&
    (quote === "\"" || quote === "'") &&
    trimmed[trimmed.length - 1] === quote
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  }

  return trimmed;
}

function parseBooleanEnvValue(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "y", "on", "enabled"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off", "disabled"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseEnvFile(path: string): EnvMap {
  if (!existsSync(path)) {
    return {};
  }

  const values: EnvMap = {};
  const contents = readFileSync(path, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripEnvQuotes(trimmed.slice(separatorIndex + 1));

    if (key && values[key] === undefined) {
      values[key] = value;
    }
  }

  return values;
}

function candidateEnvFiles(): string[] {
  const cwd = resolve(process.cwd());
  const orderedFiles: string[] = [];
  const seenDirs = new Set<string>();
  const addForDir = (dir: string) => {
    if (seenDirs.has(dir)) {
      return;
    }
    seenDirs.add(dir);
    orderedFiles.push(join(dir, ".env.local"));
    orderedFiles.push(join(dir, ".env"));
  };

  const appFromRepoRoot = join(cwd, "apps", "dashboard");
  if (existsSync(join(appFromRepoRoot, "package.json"))) {
    addForDir(appFromRepoRoot);
  }

  addForDir(cwd);

  const repoRootFromApp = resolve(cwd, "..", "..");
  if (existsSync(join(repoRootFromApp, "apps", "dashboard", "package.json"))) {
    addForDir(repoRootFromApp);
  }

  return orderedFiles;
}

function readEnvValue(key: string): string | undefined {
  const processValue = process.env[key]?.trim();
  if (processValue) {
    return processValue;
  }

  for (const file of candidateEnvFiles()) {
    const fileValue = parseEnvFile(file)[key]?.trim();
    if (fileValue) {
      return fileValue;
    }
  }

  return undefined;
}

function parseCredentialsJson(raw: string): GoogleServiceAccountCredentials {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DashboardConfigError(
      "GOOGLE_CREDENTIALS_JSON must contain valid service account JSON"
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new DashboardConfigError(
      "GOOGLE_CREDENTIALS_JSON must be a JSON object"
    );
  }

  const record = parsed as Record<string, unknown>;
  const clientEmail = record.client_email;
  const privateKey = record.private_key;

  if (typeof clientEmail !== "string" || clientEmail.trim() === "") {
    throw new DashboardConfigError(
      "GOOGLE_CREDENTIALS_JSON is missing client_email"
    );
  }

  if (typeof privateKey !== "string" || privateKey.trim() === "") {
    throw new DashboardConfigError(
      "GOOGLE_CREDENTIALS_JSON is missing private_key"
    );
  }

  return {
    client_email: clientEmail.trim(),
    private_key: privateKey.replace(/\\n/g, "\n").trim(),
    project_id:
      typeof record.project_id === "string" ? record.project_id.trim() : undefined,
    token_uri:
      typeof record.token_uri === "string" ? record.token_uri.trim() : undefined,
  };
}

export function getDashboardEnv(): DashboardEnv {
  const sheetId = readEnvValue("GOOGLE_SHEET_ID");
  const credentialsJson = readEnvValue("GOOGLE_CREDENTIALS_JSON");
  const missing: string[] = [];

  if (!sheetId) {
    missing.push("GOOGLE_SHEET_ID");
  }

  if (!credentialsJson) {
    missing.push("GOOGLE_CREDENTIALS_JSON");
  }

  if (missing.length > 0) {
    throw missingEnvError(missing);
  }

  return {
    sheetId: sheetId!,
    credentials: parseCredentialsJson(credentialsJson!),
  };
}

export function getDashboardDataBackend(): DashboardDataBackend {
  const raw = readEnvValue("DASHBOARD_DATA_BACKEND") ?? readEnvValue("STORAGE_BACKEND") ?? "sheets";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "postgres") {
    return "postgres";
  }
  return "sheets";
}

export function getDashboardPostgresEnv(): DashboardPostgresEnv {
  const databaseUrl = readEnvValue("DATABASE_URL");
  if (!databaseUrl) {
    throw missingEnvError(["DATABASE_URL"]);
  }
  return { databaseUrl };
}

export function getLiveUpdatesEnv(): LiveUpdatesEnv {
  const enabled = parseBooleanEnvValue(readEnvValue("WHALESCOPE_SSE_ENABLED"), false);
  const restUrl = readEnvValue("WHALESCOPE_REDIS_REST_URL");
  const restToken = readEnvValue("WHALESCOPE_REDIS_REST_TOKEN");
  const configured = Boolean(restUrl && restToken);
  const configurationReason =
    configured || !enabled
      ? undefined
      : !restUrl
        ? "redis_missing"
        : "token_missing";

  return {
    enabled,
    configured,
    configurationReason,
    restUrl: configured ? restUrl : undefined,
    restToken: configured ? restToken : undefined,
  };
}

export function getRenderEnvState(): RenderEnvState {
  const apiKey = readEnvValue("RENDER_API_KEY");
  const ownerId = readEnvValue("RENDER_OWNER_ID");
  const pipeline = readEnvValue("RENDER_SERVICE_ID_PIPELINE");
  const listener = readEnvValue("RENDER_SERVICE_ID_LISTENER");
  const bot = readEnvValue("RENDER_SERVICE_ID_BOT");
  const missingEnv: RenderEnvKey[] = [];

  if (!apiKey) {
    missingEnv.push("RENDER_API_KEY");
  }

  if (!ownerId) {
    missingEnv.push("RENDER_OWNER_ID");
  }

  if (!pipeline) {
    missingEnv.push("RENDER_SERVICE_ID_PIPELINE");
  }

  if (!listener) {
    missingEnv.push("RENDER_SERVICE_ID_LISTENER");
  }

  if (!bot) {
    missingEnv.push("RENDER_SERVICE_ID_BOT");
  }

  return {
    configured: missingEnv.length === 0,
    missingEnv,
    apiKey: apiKey || undefined,
    ownerId: ownerId || undefined,
    serviceIds: {
      pipeline: pipeline || undefined,
      listener: listener || undefined,
      bot: bot || undefined,
    },
  };
}

export function getRenderEnv(): RenderEnv {
  const state = getRenderEnvState();

  if (
    !state.configured ||
    !state.apiKey ||
    !state.ownerId ||
    !state.serviceIds.pipeline ||
    !state.serviceIds.listener ||
    !state.serviceIds.bot
  ) {
    throw missingEnvError(state.missingEnv);
  }

  return {
    apiKey: state.apiKey,
    ownerId: state.ownerId,
    serviceIds: {
      pipeline: state.serviceIds.pipeline,
      listener: state.serviceIds.listener,
      bot: state.serviceIds.bot,
    },
  };
}

export function validateDashboardTabName(tab: string): SheetTabName {
  if (tab in TAB_HEADERS) {
    return tab as SheetTabName;
  }
  throw new DashboardConfigError(`Unsupported sheet tab: ${tab}`);
}
