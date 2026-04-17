import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { listWatchlistEntries, setWatchlistEntryEnabled } from "@/lib/metrics";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const addresses = listWatchlistEntries();
    return NextResponse.json(
      { addresses },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load watchlist.", "api/watchlist");
  }
}

export async function PATCH(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const address = (payload as { address?: unknown } | null)?.address;
  const enabled = (payload as { enabled?: unknown } | null)?.enabled;

  if (typeof address !== "string" || address.trim().length === 0 || address.length > 128) {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean." }, { status: 400 });
  }

  try {
    const updated = setWatchlistEntryEnabled(address, enabled);
    if (!updated) {
      return NextResponse.json({ error: "address not found." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, address: updated.address, enabled: updated.enabled },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to update watchlist.", "api/watchlist");
  }
}
