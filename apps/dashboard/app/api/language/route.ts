import { NextResponse } from "next/server";

import { createGenericErrorResponse, requireDashboardAuth } from "@/lib/auth";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const SUPPORTED = new Set(["ko", "en", "ja"]);
const COOKIE_NAME = "dashboard_lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readLangFromCookie(request: Request): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const pair of cookieHeader.split(/;\s*/)) {
    const [name, ...rest] = pair.split("=");
    if (name === COOKIE_NAME) {
      const value = rest.join("=").trim();
      if (SUPPORTED.has(value)) return value;
    }
  }
  return "ko";
}

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const unauthorized = requireDashboardAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const lang = readLangFromCookie(request);
  return NextResponse.json(
    { lang, supported: Array.from(SUPPORTED) },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
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

  const lang = (payload as { lang?: unknown } | null)?.lang;
  if (typeof lang !== "string" || !SUPPORTED.has(lang)) {
    return NextResponse.json({ error: "unsupported language." }, { status: 400 });
  }

  try {
    const response = NextResponse.json(
      { ok: true, lang },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set({
      name: COOKIE_NAME,
      value: lang,
      httpOnly: false,
      maxAge: COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
    return response;
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to set language.", "api/language");
  }
}
