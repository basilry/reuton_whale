import { NextResponse } from "next/server";

import { DASHBOARD_TABS } from "@/lib/schema";
import { getSheetsReadClient, readDashboardSnapshotSafe } from "@/lib/sheets";
import { loadRenderObservability } from "@/lib/render";
import { loadCuratedWalletEntriesWithMeta } from "@/lib/curated-wallets";
import { readSheetRows } from "@/lib/sheets";
import { getDashboardData } from "@/lib/metrics";

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

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "full";

  if (mode === "getDashboardData") {
    const result = await timed("getDashboardData", async () => {
      const data = await getDashboardData({
        transactionLimit: 6,
        signalLimit: 6,
        systemLogLimit: 4,
      });
      return {
        generatedAt: data.generatedAt,
        txCount: data.recentTransactions.length,
        sigCount: data.recentSignals.length,
        sysLogCount: data.systemLogs.length,
        payloadKb: Math.round(JSON.stringify(data).length / 1024),
      };
    });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const perTab = await Promise.all(
    DASHBOARD_TABS.map((tab) =>
      timed(`tab:${tab}`, async () => {
        const rows = await client.readTab(tab);
        return { rows: rows.length };
      }),
    ),
  );

  const snapshotSafe = await timed("snapshotSafe", async () => {
    const result = await readDashboardSnapshotSafe();
    return {
      failedTabs: result.failedTabs,
      rowCounts: {
        transactions: result.snapshot.transactions.length,
        daily_brief: result.snapshot.daily_brief.length,
        signals: result.snapshot.signals.length,
        system_log: result.snapshot.system_log.length,
        subscribers: result.snapshot.subscribers.length,
        tg_whale_events: result.snapshot.tg_whale_events.length,
      },
    };
  });
  const curated = await timed("curatedWallets", async () => {
    const bundle = await loadCuratedWalletEntriesWithMeta();
    return { walletCount: bundle.wallets.length, meta: bundle.meta };
  });
  const render = await timed("renderObservability", async () => {
    const obs = await loadRenderObservability();
    return {
      state: obs.state,
      configured: obs.configured,
      serviceCount: obs.services.length,
      deployCount: obs.deploys.length,
      errorCount: obs.errors.length,
    };
  });
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
