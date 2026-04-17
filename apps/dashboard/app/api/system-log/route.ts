import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { DASHBOARD_CACHE_TTL, getCached, setCache } from "@/lib/cache";
import { parseLimitParam } from "@/lib/format";
import { getSystemLogData } from "@/lib/metrics";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const limit = parseLimitParam(new URL(request.url).searchParams.get("limit"), 25, 500);
  const cacheKey = `system-log:${limit}`;

  const cached = getCached<Awaited<ReturnType<typeof getSystemLogData>>>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  }

  try {
    const data = await getSystemLogData(limit);
    setCache(cacheKey, data, DASHBOARD_CACHE_TTL);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load system logs.", "api/system-log");
  }
}
