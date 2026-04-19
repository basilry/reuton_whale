import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

export const DASHBOARD_SESSION_COOKIE_NAME = "whalescope-admin-session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type AuthResult = {
  authorized: boolean;
  passwordConfigured: boolean;
  productionLocked: boolean;
};

type DashboardAuthInput = {
  authorization?: string | null;
  headerPassword?: string | null;
  cookieHeader?: string | null;
  sessionCookie?: string | null;
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

function extractCookieValue(cookieHeader: string | null, cookieName: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const fragment of cookieHeader.split(";")) {
    const [rawName, ...rest] = fragment.split("=");
    if (!rawName || rest.length === 0) {
      continue;
    }

    if (rawName.trim() === cookieName) {
      const value = rest.join("=").trim();
      return value || undefined;
    }
  }

  return undefined;
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

function signDashboardSession(password: string, issuedAtSeconds: number): string {
  return createHmac("sha256", password)
    .update(`whalescope-admin-session:v1:${issuedAtSeconds}`)
    .digest("base64url");
}

function getSessionCookieValue(input: DashboardAuthInput): string | undefined {
  return input.sessionCookie?.trim() || extractCookieValue(input.cookieHeader ?? null, DASHBOARD_SESSION_COOKIE_NAME);
}

export function isDashboardPasswordConfigured(): boolean {
  const expectedPassword = getDashboardPassword();
  return Boolean(expectedPassword);
}

export function isDashboardPasswordValid(suppliedPassword: string): boolean {
  const expectedPassword = getDashboardPassword();

  if (!expectedPassword) {
    return false;
  }

  return timingSafePasswordEquals(expectedPassword, suppliedPassword.trim());
}

export function createDashboardSessionToken(password: string, issuedAtMs = Date.now()): string {
  const issuedAtSeconds = Math.floor(issuedAtMs / 1000);
  const signature = signDashboardSession(password, issuedAtSeconds);
  return `v1.${issuedAtSeconds}.${signature}`;
}

export function verifyDashboardSessionToken(
  token: string,
  password: string,
  nowMs = Date.now(),
): boolean {
  const [version, issuedAtText, signature] = token.split(".");
  if (version !== "v1" || !issuedAtText || !signature) {
    return false;
  }

  const issuedAtSeconds = Number(issuedAtText);
  if (!Number.isInteger(issuedAtSeconds) || issuedAtSeconds <= 0) {
    return false;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (issuedAtSeconds > nowSeconds + 300) {
    return false;
  }
  if (nowSeconds - issuedAtSeconds > DASHBOARD_SESSION_MAX_AGE_SECONDS) {
    return false;
  }

  const expectedSignature = signDashboardSession(password, issuedAtSeconds);
  return timingSafePasswordEquals(expectedSignature, signature);
}

export function getDashboardAuthResult(input: DashboardAuthInput): AuthResult {
  const expectedPassword = getDashboardPassword();

  if (!expectedPassword) {
    if (process.env.NODE_ENV === "production") {
      return {
        authorized: false,
        passwordConfigured: false,
        productionLocked: true,
      };
    }

    return {
      authorized: true,
      passwordConfigured: false,
      productionLocked: false,
    };
  }

  const bearerPassword = extractBearerPassword(input.authorization ?? null);
  const headerPassword = input.headerPassword?.trim() || undefined;
  const suppliedPassword = bearerPassword || headerPassword;
  const sessionCookie = getSessionCookieValue(input);
  const sessionAuthorized =
    sessionCookie ? verifyDashboardSessionToken(sessionCookie, expectedPassword) : false;

  return {
    authorized:
      timingSafePasswordEquals(expectedPassword, suppliedPassword) || sessionAuthorized,
    passwordConfigured: true,
    productionLocked: false,
  };
}

export function getDashboardSessionAuthState(sessionCookie: string | null | undefined): AuthResult {
  return getDashboardAuthResult({ sessionCookie: sessionCookie ?? undefined });
}

export function requireDashboardAuth(request: Request): NextResponse | null {
  const { authorized, passwordConfigured, productionLocked } = getDashboardAuthResult({
    authorization: request.headers.get("authorization"),
    headerPassword: request.headers.get("x-dashboard-password"),
    cookieHeader: request.headers.get("cookie"),
  });

  if (!passwordConfigured && !productionLocked) {
    return null;
  }

  if (productionLocked) {
    return NextResponse.json(
      { error: "missing-production-password" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (authorized) {
    return null;
  }

  return NextResponse.json(
    { error: "unauthorized" },
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
    console.error(`[${context}]`, String(error));
  }

  return NextResponse.json(
    { error: fallbackMessage },
    {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
