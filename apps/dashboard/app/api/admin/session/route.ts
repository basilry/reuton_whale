import { NextResponse } from "next/server";

import {
  createDashboardSessionToken,
  DASHBOARD_SESSION_COOKIE_NAME,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  isDashboardPasswordConfigured,
  isDashboardPasswordValid,
} from "@/lib/auth";

export const runtime = "nodejs";

type LoginPayload = {
  password?: unknown;
};

function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  };
}

function buildClearedCookieOptions() {
  return {
    ...buildSessionCookieOptions(),
    maxAge: 0,
  };
}

async function readPassword(request: Request): Promise<string | undefined> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return undefined;
  }

  const password = (payload as LoginPayload | null)?.password;
  if (typeof password !== "string") {
    return undefined;
  }

  const trimmed = password.trim();
  return trimmed ? trimmed : undefined;
}

export async function POST(request: Request) {
  if (!isDashboardPasswordConfigured()) {
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "production"
            ? "missing-production-password"
            : "password-not-configured",
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const suppliedPassword = await readPassword(request);
  if (!suppliedPassword || !isDashboardPasswordValid(suppliedPassword)) {
    return NextResponse.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const response = NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );

  response.cookies.set(
    DASHBOARD_SESSION_COOKIE_NAME,
    createDashboardSessionToken(suppliedPassword),
    buildSessionCookieOptions(),
  );

  return response;
}

export async function DELETE() {
  const response = NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );

  response.cookies.set(
    DASHBOARD_SESSION_COOKIE_NAME,
    "",
    buildClearedCookieOptions(),
  );

  return response;
}
