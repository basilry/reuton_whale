import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { parseLimitParam } from "@/lib/format";
import { getTransactionsData } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const limit = parseLimitParam(new URL(request.url).searchParams.get("limit"), 20, 200);
    const data = await getTransactionsData(limit);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load transactions.", "api/transactions");
  }
}
