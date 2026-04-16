import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { getDashboardData } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const data = await getDashboardData();
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load dashboard data.", "api/dashboard");
  }
}
