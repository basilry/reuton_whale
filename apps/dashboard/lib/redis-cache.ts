const CACHE_REQUEST_TIMEOUT_MS = 2_000;

function readEnv(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getConfig(): { url: string; token: string } | null {
  const url = readEnv("WHALESCOPE_REDIS_REST_URL");
  const token = readEnv("WHALESCOPE_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  return { url: trimTrailingSlash(url), token };
}

export function isRedisCacheConfigured(): boolean {
  return getConfig() !== null;
}

async function upstashFetch(path: string, token: string, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CACHE_REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    return await fetch(path, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function redisCacheGet<T>(key: string, signal?: AbortSignal): Promise<T | null> {
  const config = getConfig();
  if (!config) return null;

  try {
    const response = await upstashFetch(
      `${config.url}/get/${encodeURIComponent(key)}`,
      config.token,
      signal,
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { result?: string | null };
    const raw = payload?.result;
    if (typeof raw !== "string" || raw.length === 0) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      console.warn("[redis-cache] get failed:", key, error instanceof Error ? error.message : error);
    }
    return null;
  }
}

export async function redisCacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  signal?: AbortSignal,
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    console.warn("[redis-cache] serialize failed:", key, error instanceof Error ? error.message : error);
    return;
  }

  try {
    const path = `${config.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(serialized)}?EX=${ttlSeconds}`;
    await upstashFetch(path, config.token, signal);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      console.warn("[redis-cache] set failed:", key, error instanceof Error ? error.message : error);
    }
  }
}

export async function redisCacheDelete(key: string, signal?: AbortSignal): Promise<void> {
  const config = getConfig();
  if (!config) return;

  try {
    const path = `${config.url}/del/${encodeURIComponent(key)}`;
    await upstashFetch(path, config.token, signal);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      console.warn("[redis-cache] delete failed:", key, error instanceof Error ? error.message : error);
    }
  }
}

export async function redisCacheDeleteMany(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => redisCacheDelete(key)));
}

export const SHEET_CACHE_KEY_PREFIX = "whalescope:sheet:";
export const SHEET_CACHE_BATCH_DASHBOARD_KEY = `${SHEET_CACHE_KEY_PREFIX}batch:dashboard`;

export function sheetTabCacheKey(tab: string): string {
  return `${SHEET_CACHE_KEY_PREFIX}tab:${tab}`;
}
