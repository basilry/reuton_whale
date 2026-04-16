import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { parseLimitParam } from "@/lib/format";
import { getSystemLogData } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const limit = parseLimitParam(new URL(request.url).searchParams.get("limit"), 25, 500);
    const data = await getSystemLogData(limit);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load system logs.", "api/system-log");
  }
}
