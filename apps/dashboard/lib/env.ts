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

function missingEnvError(keys: string[]): DashboardConfigError {
  return new DashboardConfigError(
    `Missing required environment variable${keys.length > 1 ? "s" : ""}: ${keys.join(", ")}`
  );
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
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON?.trim();
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

export function validateDashboardTabName(tab: string): SheetTabName {
  if (tab in TAB_HEADERS) {
    return tab as SheetTabName;
  }
  throw new DashboardConfigError(`Unsupported sheet tab: ${tab}`);
}
