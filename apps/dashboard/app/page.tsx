import { BriefPanel } from "@/components/brief-panel";
import { DashboardShell } from "@/components/dashboard-shell";
import { MetricCard } from "@/components/metric-card";
import { SignalsTable, type SignalRow } from "@/components/signals-table";
import { SystemLogPanel, type SystemLogRow } from "@/components/system-log-panel";
import { TransactionsTable, type TransactionRow } from "@/components/transactions-table";
import { getDashboardData } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardMetrics = {
  transactionCount: number;
  signalCount: number;
  dailyBriefCount: number;
  subscriberCount: number;
  latestRunStatus: string;
  latestRunErrorCount: number;
  lastUpdatedAt?: string;
};

type DashboardBrief = {
  date?: string;
  generatedAt?: string;
  summary?: string;
  alertCount?: number;
  totalVolumeUsd?: number;
  highlights?: string[];
  signalThemes?: string[];
  topTransactions?: Array<{
    symbol?: unknown;
    amountUsd?: unknown;
    amount_usd?: unknown;
    chain?: unknown;
    blockchain?: unknown;
  }>;
};

type DashboardData = {
  generatedAt?: string;
  metrics?: Partial<DashboardMetrics>;
  latestBrief?: DashboardBrief | null;
  recentTransactions?: unknown[] | null;
  recentSignals?: unknown[] | null;
  latestRun?: {
    status?: string;
    message?: string;
    errorCount?: number;
    updatedAt?: string;
  } | null;
  systemLogs?: SystemLogRow[] | null;
  source?: string;
};

type NormalizedBrief = {
  date?: string;
  generatedAt?: string;
  summary: string;
  alertCount?: number;
  totalVolumeUsd?: number;
  highlights?: string[];
  signalThemes?: string[];
  topTransactions?: Array<{
    symbol: string;
    amountUsd: number;
    chain: string;
  }>;
};

type NormalizedDashboard = {
  generatedAt: string;
  source: string;
  metrics: DashboardMetrics;
  latestBrief: NormalizedBrief;
  recentTransactions: TransactionRow[];
  recentSignals: SignalRow[];
  latestRun: {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  };
  systemLogs: SystemLogRow[];
  sourceState: "connected" | "fallback";
};

const FALLBACK_SOURCE = "local fallback";

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item).trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTransactions(value: unknown): TransactionRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: TransactionRow[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const row = item as Record<string, unknown>;
    const timestamp =
      toText(row.timestamp) ||
      toText(row.created_at) ||
      toText(row.createdAt) ||
      toText(row.time);

    rows.push({
      id: toText(row.id, `${index}`) || `${index}`,
      timestamp,
      symbol: toText(row.symbol) || "UNKNOWN",
      amount: toNumber(row.amount || row.quantity || row.token_amount),
      amountUsd: toNumber(
        row.amountUsd || row.amount_usd || row.usd_value || row.valueUsd,
      ),
      from: toText(row.from || row.from_address || row.sender, "Unknown"),
      to: toText(row.to || row.to_address || row.receiver, "Unknown"),
      chain: toText(row.chain, "Unknown"),
      hash: toText(row.hash || row.tx_hash || row.transaction_hash, "unknown"),
      direction: toText(row.direction) || undefined,
    });
  });

  return rows;
}

function normalizeSignals(value: unknown): SignalRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: SignalRow[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const row = item as Record<string, unknown>;
    rows.push({
      id: toText(row.id, `${index}`) || `${index}`,
      createdAt:
        toText(row.createdAt) || toText(row.created_at) || toText(row.timestamp),
      rule: toText(row.rule) || "Unknown rule",
      severity: toText(row.severity) || "unknown",
      score: toNumber(row.score),
      confidence:
        row.confidence === undefined || row.confidence === null
          ? undefined
          : toText(row.confidence),
      source: toText(row.source, "system"),
      summary: toText(row.summary) || "요약이 아직 없습니다.",
      evidenceTxHashes: toArray(
        row.evidenceTxHashes ||
          row.evidence_tx_hashes ||
          row.evidence ||
          row.tx_hashes,
      ),
    });
  });

  return rows;
}

function normalizeSystemLogs(value: unknown, latestRun: NormalizedDashboard["latestRun"]): SystemLogRow[] {
  if (!Array.isArray(value)) {
    return latestRun.message
      ? [
          {
            timestamp: latestRun.updatedAt,
            status: latestRun.status,
            title: "Latest pipeline run",
            message: latestRun.message,
          },
        ]
      : [];
  }

  const rows: SystemLogRow[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const row = item as Record<string, unknown>;
    rows.push({
      id: toText(row.id, `${index}`) || `${index}`,
      timestamp:
        toText(row.timestamp) ||
        toText(row.createdAt) ||
        toText(row.created_at) ||
        latestRun.updatedAt,
      status: toText(row.status) || latestRun.status,
      title: toText(row.title) || toText(row.event) || "System event",
      message:
        toText(row.message) ||
        toText(row.detail) ||
        toText(row.notes) ||
        "운영 이벤트 상세가 없습니다.",
    });
  });

  if (!rows.length && latestRun.message) {
    return [
      {
        timestamp: latestRun.updatedAt,
        status: latestRun.status,
        title: "Latest pipeline run",
        message: latestRun.message,
      },
    ];
  }

  return rows;
}

function normalizeDashboardData(input: DashboardData | null): NormalizedDashboard {
  const sourceState: NormalizedDashboard["sourceState"] = input ? "connected" : "fallback";

  const metrics: DashboardMetrics = {
    transactionCount: toNumber(input?.metrics?.transactionCount),
    signalCount: toNumber(input?.metrics?.signalCount),
    dailyBriefCount: toNumber(input?.metrics?.dailyBriefCount),
    subscriberCount: toNumber(input?.metrics?.subscriberCount),
    latestRunStatus: toText(input?.metrics?.latestRunStatus, "unknown"),
    latestRunErrorCount: toNumber(input?.metrics?.latestRunErrorCount),
    lastUpdatedAt:
      toText(input?.metrics?.lastUpdatedAt) ||
      toText(input?.generatedAt) ||
      undefined,
  };

  const latestRun = {
    status:
      toText(input?.latestRun?.status) ||
      metrics.latestRunStatus ||
      "unknown",
    message:
      toText(input?.latestRun?.message) ||
      (sourceState === "fallback"
        ? "Dashboard data source is not connected yet."
        : "Latest run completed."),
    errorCount: toNumber(
      input?.latestRun?.errorCount,
      metrics.latestRunErrorCount,
    ),
    updatedAt:
      toText(input?.latestRun?.updatedAt) ||
      metrics.lastUpdatedAt ||
      new Date().toISOString(),
  };

  const latestBrief: NormalizedDashboard["latestBrief"] = {
    date: toText(input?.latestBrief?.date) || undefined,
    generatedAt:
      toText(input?.latestBrief?.generatedAt) ||
      metrics.lastUpdatedAt ||
      undefined,
    summary:
      toText(input?.latestBrief?.summary) ||
      "오늘 생성된 브리핑이 없습니다. 파이프라인 실행 후 최신 요약이 이곳에 표시됩니다.",
    alertCount: toNumber(input?.latestBrief?.alertCount),
    totalVolumeUsd: toNumber(input?.latestBrief?.totalVolumeUsd),
    highlights: toArray(input?.latestBrief?.highlights),
    signalThemes: toArray(input?.latestBrief?.signalThemes),
    topTransactions: Array.isArray(input?.latestBrief?.topTransactions)
      ? input.latestBrief?.topTransactions
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const row = item as Record<string, unknown>;
            return {
              symbol: toText(row.symbol) || "UNKNOWN",
              amountUsd: toNumber(row.amountUsd || row.amount_usd),
              chain: toText(row.chain) || "Unknown",
            };
          })
          .filter(
            (item): item is { symbol: string; amountUsd: number; chain: string } =>
              Boolean(item),
          )
      : [],
  };

  const recentTransactions = normalizeTransactions(
    input?.recentTransactions ?? [],
  );
  const recentSignals = normalizeSignals(input?.recentSignals ?? []);

  return {
    generatedAt:
      toText(input?.generatedAt) ||
      latestRun.updatedAt ||
      new Date().toISOString(),
    source: input?.source || FALLBACK_SOURCE,
    metrics,
    latestBrief,
    recentTransactions,
    recentSignals,
    latestRun,
    systemLogs: normalizeSystemLogs(input?.systemLogs ?? [], latestRun),
    sourceState,
  };
}

async function loadDashboardData(): Promise<DashboardData | null> {
  try {
    return {
      ...(await getDashboardData()),
      source: "google_sheets",
    };
  } catch (error) {
    console.error("Dashboard data load failed", error);
    return null;
  }
}

function buildMetricItems(data: NormalizedDashboard) {
  return [
    {
      label: "Transactions",
      value: data.metrics.transactionCount.toLocaleString("en-US"),
      hint: "Google Sheets rows",
      tone: "accent" as const,
    },
    {
      label: "Signals",
      value: data.metrics.signalCount.toLocaleString("en-US"),
      hint: "Rule-based alerts",
      tone: "good" as const,
    },
    {
      label: "Daily briefs",
      value: data.metrics.dailyBriefCount.toLocaleString("en-US"),
      hint: "Latest summary rows",
      tone: "neutral" as const,
    },
    {
      label: "Subscribers",
      value: data.metrics.subscriberCount.toLocaleString("en-US"),
      hint: "Telegram active",
      tone: "soft" as const,
    },
    {
      label: "Latest run",
      value: data.metrics.latestRunStatus,
      hint:
        data.metrics.latestRunErrorCount > 0
          ? `${data.metrics.latestRunErrorCount} error${data.metrics.latestRunErrorCount === 1 ? "" : "s"}`
          : "Healthy",
      tone:
        data.metrics.latestRunStatus === "completed"
          ? "good"
          : data.metrics.latestRunStatus === "completed_with_errors"
            ? "warn"
            : data.metrics.latestRunStatus === "failed"
              ? "bad"
              : "neutral",
    },
  ] as const;
}

export default async function DashboardPage() {
  const data = normalizeDashboardData(await loadDashboardData());
  const metricItems = buildMetricItems(data);

  return (
    <DashboardShell
      generatedAt={data.generatedAt}
      source={data.source}
      sourceState={data.sourceState}
      latestRun={data.latestRun}
      title="WhaleScope Operations Dashboard"
      subtitle="Google Sheets를 기준 데이터 소스로 삼아, 수집 파이프라인과 Telegram 흐름을 한 화면에서 검증합니다."
      description="제품 과제형 대시보드에 맞춰 핵심 운영 지표, 브리핑, 거래, 시그널, 시스템 로그를 병렬로 배치했습니다."
    >
      <section className="metric-grid" aria-label="Overview metrics">
        {metricItems.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </section>

      <section className="dashboard-grid dashboard-grid--primary">
        <div className="dashboard-grid__main">
          <BriefPanel
            brief={data.latestBrief}
            latestRun={data.latestRun}
            sourceState={data.sourceState}
          />

          <TransactionsTable rows={data.recentTransactions} />
        </div>

        <aside className="dashboard-grid__rail">
          <SignalsTable rows={data.recentSignals} />
          <SystemLogPanel rows={data.systemLogs} />
        </aside>
      </section>
    </DashboardShell>
  );
}
