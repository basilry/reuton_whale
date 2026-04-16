import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

type AuthResult = {
  authorized: boolean;
  passwordConfigured: boolean;
};

function getDashboardPassword(): string | undefined {
  const value = process.env.DASHBOARD_PASSWORD?.trim();
  return value ? value : undefined;
}

function extractBearerPassword(headerValue: string | null): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const [scheme, ...rest] = headerValue.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || rest.length === 0) {
    return undefined;
  }

  const token = rest.join(" ").trim();
  return token || undefined;
}

function timingSafePasswordEquals(
  expected: string,
  supplied: string | undefined,
): boolean {
  if (!supplied) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");

  if (expectedBuffer.length !== suppliedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function getDashboardAuthResult(request: Request): AuthResult {
  const expectedPassword = getDashboardPassword();

  if (!expectedPassword) {
    return {
      authorized: true,
      passwordConfigured: false,
    };
  }

  const headers = request.headers;
  const bearerPassword = extractBearerPassword(headers.get("authorization"));
  const headerPassword = headers.get("x-dashboard-password")?.trim() || undefined;
  const suppliedPassword = bearerPassword || headerPassword;

  return {
    authorized: timingSafePasswordEquals(expectedPassword, suppliedPassword),
    passwordConfigured: true,
  };
}

export function requireDashboardAuth(request: Request): NextResponse | null {
  const { authorized, passwordConfigured } = getDashboardAuthResult(request);

  if (!passwordConfigured || authorized) {
    return null;
  }

  return NextResponse.json(
    { error: "Unauthorized." },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": "Bearer",
      },
    }
  );
}

export function createGenericErrorResponse(
  error: unknown,
  fallbackMessage: string,
  context: string,
): NextResponse {
  if (error instanceof Error) {
    console.error(`[${context}]`, error.message, error.stack);
  } else {
    console.error(`[${context}]`, error);
  }

  return NextResponse.json(
    { error: fallbackMessage },
    {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
