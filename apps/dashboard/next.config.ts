import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

/**
 * Load the repository-root `.env` directly into `process.env` so that
 * `apps/dashboard` shares a single source of truth with the backend
 * pipelines. Keys already present in `process.env` (set by the shell,
 * by Vercel, or by Next.js reading `apps/dashboard/.env*` before this
 * file is loaded) win over root values — root `.env` only fills in
 * what is missing.
 *
 * Next.js runs `@next/env.loadEnvConfig(appDir)` before importing
 * `next.config.ts`, so this loader runs last and is safe for both
 * server-side `process.env.*` reads and client-side `NEXT_PUBLIC_*`
 * inlining (both happen after `next.config.ts` is evaluated).
 *
 * Do NOT use `@next/env.loadEnvConfig` with `forceReload=true` here:
 * its `replaceProcessEnv` path resets `process.env` to the pre-load
 * snapshot, which would drop values Next.js already merged from
 * `apps/dashboard/.env*`.
 */
function loadRepoRootEnv(): void {
  const repoRoot = resolve(process.cwd(), "..", "..");
  const candidates = [resolve(repoRoot, ".env.local"), resolve(repoRoot, ".env")];

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const contents = readFileSync(envPath, "utf8");

    for (const raw of contents.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq <= 0) continue;

      const key = line.slice(0, eq).trim();
      if (!key) continue;
      // Respect precedence: never overwrite values already present
      // (from shell export, Vercel, or the app-local .env files).
      if (process.env[key] !== undefined) continue;

      let value = line.slice(eq + 1).trim();
      const quote = value[0];

      if (
        value.length >= 2 &&
        (quote === '"' || quote === "'") &&
        value[value.length - 1] === quote
      ) {
        value = value.slice(1, -1);
        if (quote === '"') {
          // Mirror dotenv's double-quote handling: unescape \" \\ \n \r.
          // Single-quoted values stay literal so JSON payloads like
          // GOOGLE_CREDENTIALS_JSON round-trip with `\n` inside the
          // PEM block intact for downstream `replace(/\\n/g, "\n")`.
          value = value
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r");
        }
      }

      process.env[key] = value;
    }
  }
}

loadRepoRootEnv();

const CSP_CONNECT_SRC = [
  "'self'",
  "https://api.binance.com",
  "https://stream.binance.com:9443",
  "wss://stream.binance.com:9443",
  "https://api.upbit.com",
  "wss://api.upbit.com",
  "https://api.exchangerate.host",
  "https://open.er-api.com",
  "https://api.bitflyer.com",
  "https://api.kraken.com",
  "https://api.alternative.me",
  "https://sheets.googleapis.com",
  "https://www.googleapis.com",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ["lightweight-charts", "lucide-react"],
  },
  async redirects() {
    return [
      {
        source: "/insights",
        destination: "/",
        permanent: true,
      },
    ];
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `connect-src ${CSP_CONNECT_SRC.join(" ")};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
