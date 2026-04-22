import { NextResponse } from "next/server";

import { createGenericErrorResponse } from "@/lib/auth";
import { DASHBOARD_CACHE_TTL, getCached, setCache } from "@/lib/cache";
import { getDashboardData } from "@/lib/metrics";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const preferredRegion = "icn1";
export const revalidate = 60;

const CACHE_KEY = "dashboard";

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const cached = getCached<Awaited<ReturnType<typeof getDashboardData>>>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  }

  try {
    const data = await getDashboardData();
    setCache(CACHE_KEY, data, DASHBOARD_CACHE_TTL);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load dashboard data.", "api/dashboard");
  }
}
