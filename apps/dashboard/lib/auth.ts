import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

export const DASHBOARD_SESSION_COOKIE_NAME = "whalescope-admin-session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type AuthResult = {
  authorized: boolean;
  passwordConfigured: boolean;
  productionLocked: boolean;
  publicPreview: boolean;
};

function getDashboardPassword(): string | undefined {
  const value = process.env.DASHBOARD_PASSWORD?.trim();
  return value ? value : undefined;
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

export function isDashboardPasswordConfigured(): boolean {
  return Boolean(getDashboardPassword());
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

export function getDashboardAuthResult(): AuthResult {
  return {
    authorized: true,
    passwordConfigured: isDashboardPasswordConfigured(),
    productionLocked: false,
    publicPreview: true,
  };
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
