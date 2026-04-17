import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { recordSignalAction } from "@/lib/metrics";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const VALID_ACTIONS = new Set(["acknowledge", "dismiss"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  if (!id || id.length > 256) {
    return NextResponse.json({ error: "Invalid signal id." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const action = (payload as { action?: string } | null)?.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "action must be 'acknowledge' or 'dismiss'." },
      { status: 400 }
    );
  }

  try {
    const recorded = recordSignalAction(id, action as "acknowledge" | "dismiss");
    return NextResponse.json(
      {
        ok: true,
        signalId: recorded.signalId,
        action: recorded.action,
        recordedAt: recorded.recordedAt,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to record signal action.", "api/signals/[id]");
  }
}
