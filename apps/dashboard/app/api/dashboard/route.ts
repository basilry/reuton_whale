import { NextResponse } from "next/server";

import { getDashboardData } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown dashboard error";
  return NextResponse.json(
    { error: message },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
