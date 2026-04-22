import { NextResponse } from "next/server";

import { createGenericErrorResponse } from "@/lib/auth";
import { DASHBOARD_CACHE_TTL, getCached, setCache } from "@/lib/cache";
import { getDashboardData } from "@/lib/metrics";
import { normalizeDashboardData } from "@/lib/normalize";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 60;

const CACHE_KEY = "admin-health";

type AdminHealthPayload = {
  generatedAt: string;
  source: string;
  opsSummary: ReturnType<typeof normalizeDashboardData>["opsSummary"];
  sourceHealth: ReturnType<typeof normalizeDashboardData>["sourceHealth"];
  serviceHealth: ReturnType<typeof normalizeDashboardData>["serviceHealth"];
  operatorChecks: ReturnType<typeof normalizeDashboardData>["operatorChecks"];
  latestRun: ReturnType<typeof normalizeDashboardData>["latestRun"];
  listenerHealth: ReturnType<typeof normalizeDashboardData>["listenerHealth"];
};

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const cached = getCached<AdminHealthPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  }

  try {
    const normalized = normalizeDashboardData(await getDashboardData());
    const payload: AdminHealthPayload = {
      generatedAt: normalized.generatedAt,
      source: normalized.source,
      opsSummary: normalized.opsSummary,
      sourceHealth: normalized.sourceHealth,
      serviceHealth: normalized.serviceHealth,
      operatorChecks: normalized.operatorChecks,
      latestRun: normalized.latestRun,
      listenerHealth: normalized.listenerHealth,
    };
    setCache(CACHE_KEY, payload, DASHBOARD_CACHE_TTL);
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL}` },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load admin health.", "api/admin/health");
  }
}
