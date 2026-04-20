import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "icn1";

const ALLOWED_PATH_RE = /^ticker$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (!ALLOWED_PATH_RE.test(joined)) {
    return NextResponse.json({ error: "path_not_allowed" }, { status: 400 });
  }

  const url = new URL(request.url);
  const target = `https://api.bitflyer.com/v1/${joined}?${url.searchParams.toString()}`;

  try {
    const upstream = await fetch(target, { cache: "no-store" });
    const body = await upstream.text();
    const headers: Record<string, string> = {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    };
    if (upstream.ok) {
      headers["cache-control"] = "public, s-maxage=5, stale-while-revalidate=10";
    } else {
      headers["cache-control"] = "no-store";
    }
    return new NextResponse(body, { status: upstream.status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
