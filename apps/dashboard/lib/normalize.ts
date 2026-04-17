// Raw-dashboard-data -> Display-shape normalizers (extracted from app/page.tsx during W1-B).

import { cleanGeneratedBrief } from "./format";
import { toArray, toNumber, toText } from "./humanize";
import {
  FALLBACK_SOURCE,
  type DashboardData,
  type DashboardMetrics,
  type DisplaySignalRow,
  type DisplaySystemLogRow,
  type DisplayTransactionRow,
  type NormalizedDashboard,
} from "./types";

export function normalizeTransactions(value: unknown): DisplayTransactionRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: DisplayTransactionRow[] = [];

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
      amountUsd: toNumber(row.amountUsd || row.amount_usd || row.usd_value || row.valueUsd),
      from: toText(row.from || row.from_address || row.sender, "Unknown"),
      to: toText(row.to || row.to_address || row.receiver, "Unknown"),
      chain: toText(row.chain, "Unknown"),
      hash: toText(row.hash || row.tx_hash || row.transaction_hash, "unknown"),
      direction: toText(row.direction) || undefined,
    });
  });

  return rows;
}

export function normalizeSignals(value: unknown): DisplaySignalRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: DisplaySignalRow[] = [];

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
        row.evidenceTxHashes || row.evidence_tx_hashes || row.evidence || row.tx_hashes,
      ),
    });
  });

  return rows;
}

export function normalizeSystemLogs(
  value: unknown,
  latestRun: NormalizedDashboard["latestRun"],
): DisplaySystemLogRow[] {
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

  const rows: DisplaySystemLogRow[] = [];

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

export function normalizeDashboardData(input: DashboardData | null): NormalizedDashboard {
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
    errorCount: toNumber(input?.latestRun?.errorCount, metrics.latestRunErrorCount),
    updatedAt:
      toText(input?.latestRun?.updatedAt) ||
      metrics.lastUpdatedAt ||
      new Date().toISOString(),
  };

  const listenerHealth = {
    status: toText(input?.listenerHealth?.status, "unknown"),
    label: toText(input?.listenerHealth?.label) || "상태 미상",
    message:
      toText(input?.listenerHealth?.message) ||
      "Telegram listener 상태 정보가 아직 기록되지 않았습니다.",
    updatedAt: toText(input?.listenerHealth?.updatedAt) || undefined,
    event: toText(input?.listenerHealth?.event) || undefined,
  };

  const latestBrief: NormalizedDashboard["latestBrief"] = {
    date: toText(input?.latestBrief?.date) || undefined,
    generatedAt:
      toText(input?.latestBrief?.generatedAt) ||
      metrics.lastUpdatedAt ||
      undefined,
    summary:
      cleanGeneratedBrief(toText(input?.latestBrief?.summary)) ||
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

  const recentTransactions = normalizeTransactions(input?.recentTransactions ?? []);
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
    listenerHealth,
    systemLogs: normalizeSystemLogs(input?.systemLogs ?? [], latestRun),
    sourceState,
  };
}
