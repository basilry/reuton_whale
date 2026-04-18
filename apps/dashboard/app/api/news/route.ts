import { NextResponse } from "next/server";

import { createGenericErrorResponse } from "@/lib/auth";
import { DASHBOARD_CACHE_TTL, getCached, setCache } from "@/lib/cache";
import { parseLimitParam } from "@/lib/format";
import { loadNewsWidgetData } from "@/lib/news";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 300;

function cacheKey(limit: number): string {
  return `news:${limit}`;
}

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const url = new URL(request.url);
  const limit = parseLimitParam(url.searchParams.get("limit"), 4, 8);
  const key = cacheKey(limit);
  const cached = getCached<Awaited<ReturnType<typeof loadNewsWidgetData>>>(key);

  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  }

  try {
    const data = await loadNewsWidgetData(limit);
    setCache(key, data, DASHBOARD_CACHE_TTL);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load news.", "api/news");
  }
}
