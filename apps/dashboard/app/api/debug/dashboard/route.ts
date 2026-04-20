import { NextResponse } from "next/server";

import { DASHBOARD_TABS } from "@/lib/schema";
import { getSheetsReadClient, readDashboardSnapshotSafe } from "@/lib/sheets";
import { loadRenderObservability } from "@/lib/render";
import { loadCuratedWalletEntriesWithMeta } from "@/lib/curated-wallets";
import { readSheetRows } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAG_TOKEN = "whalescope-diag-2026-04-20";

function tokenMatches(request: Request): boolean {
  const url = new URL(request.url);
  const provided = url.searchParams.get("token")?.trim();
  if (provided && provided === DIAG_TOKEN) {
    return true;
  }
  const expected = process.env.DASHBOARD_PASSWORD?.trim();
  if (expected && provided === expected) {
    return true;
  }
  return false;
}

async function timed<T>(label: string, fn: () => Promise<T>) {
  const start = Date.now();
  try {
    const result = await fn();
    return { label, ok: true as const, ms: Date.now() - start, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 600) : undefined;
    return { label, ok: false as const, ms: Date.now() - start, error: message, stack };
  }
}

export async function GET(request: Request) {
  if (!tokenMatches(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const client = getSheetsReadClient();

  const perTab = await Promise.all(
    DASHBOARD_TABS.map((tab) =>
      timed(`tab:${tab}`, async () => {
        const rows = await client.readTab(tab);
        return { rows: rows.length };
      }),
    ),
  );

  const snapshotSafe = await timed("snapshotSafe", readDashboardSnapshotSafe);
  const curated = await timed("curatedWallets", loadCuratedWalletEntriesWithMeta);
  const render = await timed("renderObservability", loadRenderObservability);
  const optional = await Promise.all(
    ["service_health", "channel_health", "brief_cost_ledger", "broadcast_log", "llm_budget_log", "watched_addresses"].map(
      (tab) =>
        timed(`optional:${tab}`, async () => {
          const rows = await readSheetRows(tab as Parameters<typeof readSheetRows>[0]);
          return { rows: rows.length };
        }),
    ),
  );

  return NextResponse.json(
    {
      perTab,
      snapshotSafe,
      curated,
      render,
      optional,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
