// Simple in-memory sliding-window rate limiter for API routes.
// Keyed on client identifier (IP or "global"); intended to protect the
// Google Sheets backend from accidental polling storms.

import { NextResponse } from "next/server";

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

type Bucket = number[]; // timestamps (ms) of requests within the active window

const buckets = new Map<string, Bucket>();

export const API_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 30,
};

export function rateLimit(
  key: string,
  config: RateLimitConfig = API_RATE_LIMIT,
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const horizon = now - config.windowMs;

  // Drop timestamps outside the window so long-idle buckets don't leak memory.
  const bucket = (buckets.get(key) ?? []).filter((ts) => ts > horizon);

  if (bucket.length >= config.maxRequests) {
    const oldest = bucket[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, retryAfter };
  }

  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true };
}

export function rateLimitResponse(retryAfter: number): Response {
  return NextResponse.json(
    { error: "rate_limited", retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}

export function resetRateLimits(): void {
  buckets.clear();
}

// Pull a best-effort client key from standard proxy headers. Falls back to
// "unknown" which is safe: it means every anonymous client shares one bucket.
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") || "unknown";
}
