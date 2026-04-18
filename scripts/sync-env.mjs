// DEPRECATED. This script previously generated apps/dashboard/.env.local
// from the repository root .env via JSON.stringify, which double-wrapped
// multi-line JSON payloads (notably GOOGLE_CREDENTIALS_JSON) and corrupted
// them for @next/env.
//
// The dashboard now loads the root .env directly from apps/dashboard/next.config.ts,
// so there is no longer a copy step. See apps/dashboard/README.md for the
// current environment flow.
//
// This file is left as a no-op to avoid breaking any stale invocations. It
// exits cleanly with a message so CI or scripts that still call it keep
// working while the reference is removed.

console.warn(
  "[env:sync] DEPRECATED — apps/dashboard/next.config.ts now loads the repo root .env directly. This script no longer copies anything. Remove references to it.",
);
process.exit(0);
