import { NextResponse } from "next/server";

import { parseLimitParam } from "@/lib/format";
import { getSignalsData } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown signals error";
  return NextResponse.json(
    { error: message },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  try {
    const limit = parseLimitParam(new URL(request.url).searchParams.get("limit"), 20, 200);
    const data = await getSignalsData(limit);
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
