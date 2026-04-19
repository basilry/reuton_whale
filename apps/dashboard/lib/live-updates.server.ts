import "server-only";

import type { LiveUpdatesEnv } from "@/lib/env";
import {
  LIVE_UPDATE_SECTIONS,
  liveUpdateTimestampValue,
  type LiveUpdateEvent,
  type LiveUpdateSection,
} from "@/lib/live-updates";

type UpstashValueResponse = {
  result?: unknown;
  error?: string;
};

type LiveUpdateKeyMap = Record<LiveUpdateSection, readonly string[]>;

const SECTION_KEYS: LiveUpdateKeyMap = {
  brief: ["whalescope:updates:brief", "whalescope:brief:last_update"],
  news: ["whalescope:updates:news", "whalescope:news:last_update"],
  watchlist: [
    "whalescope:updates:watchlist",
    "whalescope:watchlist:last_update",
    "whalescope:updates:curated",
  ],
  stories: [
    "whalescope:updates:stories",
    "whalescope:stories:last_update",
    "whalescope:updates:whale_story",
  ],
};

const GLOBAL_KEYS = [
  "whalescope:last_update",
  "whalescope:updates:last",
] as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeSection(value: unknown): LiveUpdateSection | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "brief":
      return "brief";
    case "news":
      return "news";
    case "watchlist":
    case "watch_list":
    case "curated":
    case "curated_wallets":
      return "watchlist";
    case "stories":
    case "story":
    case "whale_story":
    case "whale_stories":
      return "stories";
    default:
      return null;
  }
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function decodeUpstashValue(value: unknown): unknown {
  if (typeof value === "string") {
    return parseMaybeJson(value);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1_000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return toIsoTimestamp(numeric);
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function publicMetaFromRecord(
  record: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  const pairs: Array<[string, unknown, string?]> = [
    ["id", record.id],
    ["runId", record.runId, "runId"],
    ["run_id", record.run_id, "runId"],
    ["status", record.status],
    ["title", record.title],
    ["summary", record.summary],
    ["source", record.source],
    ["reason", record.reason],
    ["count", record.count],
    ["itemCount", record.itemCount, "itemCount"],
    ["item_count", record.item_count, "itemCount"],
    ["rowCount", record.rowCount, "rowCount"],
    ["row_count", record.row_count, "rowCount"],
    ["updatedAt", record.updatedAt, "updatedAt"],
    ["updated_at", record.updated_at, "updatedAt"],
  ];

  const meta: Record<string, string | number | boolean> = {};

  for (const [sourceKey, rawValue, targetKey] of pairs) {
    const key = targetKey ?? sourceKey;

    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      meta[key] = rawValue;
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function computeVersion(section: LiveUpdateSection, record: Record<string, unknown>): string {
  const candidates = [
    record.version,
    record.eventId,
    record.event_id,
    record.runId,
    record.run_id,
    record.id,
    record.ts,
    record.updatedAt,
    record.updated_at,
    record.timestamp,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return `${section}:${JSON.stringify(record)}`;
}

function normalizeLiveUpdate(
  sectionHint: LiveUpdateSection | null,
  rawValue: unknown,
): LiveUpdateEvent | null {
  const value = decodeUpstashValue(rawValue);
  if (value == null) {
    return null;
  }

  if (!isRecord(value)) {
    if (!sectionHint) {
      return null;
    }

    return {
      section: sectionHint,
      kind: sectionHint,
      ts: new Date().toISOString(),
      version: `${sectionHint}:${String(value)}`,
      meta:
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? { value: String(value) }
          : undefined,
    };
  }

  const section =
    normalizeSection(value.section ?? value.kind ?? value.type) ?? sectionHint;

  if (!section) {
    return null;
  }

  return {
    section,
    kind: section,
    ts:
      toIsoTimestamp(
        value.ts ??
          value.updatedAt ??
          value.updated_at ??
          value.timestamp ??
          value.createdAt ??
          value.created_at,
      ) ?? new Date().toISOString(),
    version: computeVersion(section, value),
    meta: publicMetaFromRecord(value),
  };
}

async function upstashGet(
  env: LiveUpdatesEnv,
  key: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!env.restUrl || !env.restToken) {
    return null;
  }

  const url = `${trimTrailingSlash(env.restUrl)}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.restToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`upstash-get-failed:${response.status}`);
  }

  const payload = (await response.json()) as UpstashValueResponse | unknown;
  if (isRecord(payload) && "result" in payload) {
    return payload.result ?? null;
  }

  return payload;
}

async function firstSectionUpdate(
  env: LiveUpdatesEnv,
  section: LiveUpdateSection,
  signal?: AbortSignal,
): Promise<LiveUpdateEvent | null> {
  const keys = SECTION_KEYS[section];

  for (const key of keys) {
    const value = await upstashGet(env, key, signal);
    const normalized = normalizeLiveUpdate(section, value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

async function globalSectionUpdates(
  env: LiveUpdatesEnv,
  signal?: AbortSignal,
): Promise<LiveUpdateEvent[]> {
  const updates = await Promise.all(
    GLOBAL_KEYS.map(async (key) => normalizeLiveUpdate(null, await upstashGet(env, key, signal))),
  );

  return updates.filter((item): item is LiveUpdateEvent => item !== null);
}

export async function fetchLiveUpdateEvents(
  env: LiveUpdatesEnv,
  signal?: AbortSignal,
): Promise<LiveUpdateEvent[]> {
  if (!env.enabled || !env.configured) {
    return [];
  }

  const sectionResults = await Promise.all(
    LIVE_UPDATE_SECTIONS.map((section) => firstSectionUpdate(env, section, signal)),
  );
  const globalResults = await globalSectionUpdates(env, signal);

  const bySection = new Map<LiveUpdateSection, LiveUpdateEvent>();
  for (const result of [...sectionResults, ...globalResults]) {
    if (!result) {
      continue;
    }

    const current = bySection.get(result.section);
    if (
      !current ||
      liveUpdateTimestampValue(result) > liveUpdateTimestampValue(current) ||
      (liveUpdateTimestampValue(result) === liveUpdateTimestampValue(current) &&
        current.version !== result.version)
    ) {
      bySection.set(result.section, result);
    }
  }

  return [...bySection.values()];
}
