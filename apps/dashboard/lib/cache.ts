// In-memory TTL cache for dashboard data.
// Keeps Google Sheets hits off the critical path when multiple clients poll
// the same route within the TTL window.

type CacheEntry<T> = { data: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlSeconds: number): void {
  if (ttlSeconds <= 0) {
    store.delete(key);
    return;
  }
  store.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export function invalidateCache(key: string): void {
  store.delete(key);
}

export function clearCache(): void {
  store.clear();
}

// Default TTL for dashboard-facing routes. Sheets values refresh roughly every
// minute via the pipeline, so 60s keeps clients within one revolution.
export const DASHBOARD_CACHE_TTL = 60;
