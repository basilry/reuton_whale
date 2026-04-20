import { NextResponse } from "next/server";

import { DASHBOARD_TABS } from "@/lib/schema";
import { getSheetsReadClient, readDashboardSnapshotSafe } from "@/lib/sheets";
import { loadRenderObservability } from "@/lib/render";
import { loadCuratedWalletEntriesWithMeta } from "@/lib/curated-wallets";
import { readSheetRows } from "@/lib/sheets";
import { getDashboardData } from "@/lib/metrics";
import { getLiveUpdatesEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenMatches(request: Request): boolean {
  const url = new URL(request.url);
  const provided = url.searchParams.get("token")?.trim();
  const expected = process.env.DASHBOARD_PASSWORD?.trim();
  if (!expected || !provided) {
    return false;
  }
  return provided === expected;
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
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "full";

  // mode=env / redisPing는 boolean/status-only라 인증 불필요.
  // 그 외 모드는 DASHBOARD_PASSWORD 필요.
  const publicModes = new Set(["env", "redisPing"]);
  if (!publicModes.has(mode) && !tokenMatches(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (mode === "env") {
    const present = (key: string) => {
      const value = process.env[key];
      return typeof value === "string" && value.trim().length > 0;
    };
    const parseBool = (key: string) => {
      const raw = process.env[key]?.trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    };
    const liveEnv = getLiveUpdatesEnv();
    return NextResponse.json(
      {
        sheets: {
          sheetId: present("GOOGLE_SHEET_ID"),
          credentialsJson: present("GOOGLE_CREDENTIALS_JSON"),
        },
        sse: {
          flagRaw: process.env.WHALESCOPE_SSE_ENABLED ?? null,
          flagEnabled: parseBool("WHALESCOPE_SSE_ENABLED"),
          redisRestUrl: present("WHALESCOPE_REDIS_REST_URL"),
          redisRestToken: present("WHALESCOPE_REDIS_REST_TOKEN"),
          resolvedEnabled: liveEnv.enabled,
          resolvedConfigured: liveEnv.configured,
          resolvedReason: liveEnv.configurationReason ?? null,
        },
        render: {
          apiKey: present("RENDER_API_KEY"),
          ownerId: present("RENDER_OWNER_ID"),
          pipelineId: present("RENDER_SERVICE_ID_PIPELINE"),
          listenerId: present("RENDER_SERVICE_ID_LISTENER"),
          botId: present("RENDER_SERVICE_ID_BOT"),
        },
        telegram: {
          botToken: present("TELEGRAM_BOT_TOKEN"),
          channel: present("TELEGRAM_CHANNEL_ID") || present("TELEGRAM_CHANNEL_USERNAME"),
          sessionString: present("TELETHON_SESSION_STRING"),
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (mode === "redisPing") {
    const url = process.env.WHALESCOPE_REDIS_REST_URL?.trim();
    const token = process.env.WHALESCOPE_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      return NextResponse.json(
        { ok: false, reason: !url ? "redis_url_missing" : "redis_token_missing" },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await timed("redisPing", async () => {
      const resp = await fetch(`${url.replace(/\/$/, "")}/ping`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const text = await resp.text();
      return { status: resp.status, body: text.slice(0, 200) };
    });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const client = getSheetsReadClient();

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
        transactions: result.snapshot.transactionsTotal,
        transactionsLoaded: result.snapshot.transactions.length,
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
