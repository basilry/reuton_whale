import { NextResponse } from "next/server";

import { createGenericErrorResponse } from "@/lib/auth";
import {
  DASHBOARD_LANGUAGE_COOKIE,
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGES,
  isDashboardLanguage,
} from "@/lib/i18n/config";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readLangFromCookie(request: Request): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const pair of cookieHeader.split(/;\s*/)) {
    const [name, ...rest] = pair.split("=");
    if (name === DASHBOARD_LANGUAGE_COOKIE) {
      const value = rest.join("=").trim();
      if (isDashboardLanguage(value)) return value;
    }
  }
  return DEFAULT_DASHBOARD_LANGUAGE;
}

export async function GET(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const lang = readLangFromCookie(request);
  return NextResponse.json(
    { lang, supported: Array.from(SUPPORTED_DASHBOARD_LANGUAGES) },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const rl = rateLimit(clientKey(request), API_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const lang = (payload as { lang?: unknown } | null)?.lang;
  if (typeof lang !== "string" || !isDashboardLanguage(lang)) {
    return NextResponse.json({ error: "unsupported language." }, { status: 400 });
  }

  try {
    const response = NextResponse.json(
      { ok: true, lang },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set({
      name: DASHBOARD_LANGUAGE_COOKIE,
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
