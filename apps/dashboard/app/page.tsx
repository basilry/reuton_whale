import Link from "next/link";

import { DashboardConfigError } from "@/lib/env";
import { cleanGeneratedBrief } from "@/lib/format";
import { getDashboardData } from "@/lib/metrics";
import { SystemLogPanel, type SystemLogRow } from "@/components/system-log-panel";

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
  listenerHealth?: {
    status?: string;
    label?: string;
    message?: string;
    updatedAt?: string;
    event?: string;
  } | null;
  systemLogs?: DisplaySystemLogRow[] | null;
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

type DisplayTransactionRow = {
  id: string;
  timestamp: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: string;
  to: string;
  chain: string;
  hash: string;
  direction?: string;
};

type DisplaySignalRow = {
  id: string;
  createdAt: string;
  rule: string;
  severity: string;
  score: number;
  confidence?: string;
  source: string;
  summary: string;
  evidenceTxHashes: string[];
};

type DisplaySystemLogRow = {
  id?: string;
  timestamp: string;
  status: string;
  title: string;
  message: string;
};

type NormalizedDashboard = {
  generatedAt: string;
  source: string;
  metrics: DashboardMetrics;
  latestBrief: NormalizedBrief;
  recentTransactions: DisplayTransactionRow[];
  recentSignals: DisplaySignalRow[];
  latestRun: {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  };
  listenerHealth: {
    status: string;
    label: string;
    message: string;
    updatedAt?: string;
    event?: string;
  };
  systemLogs: DisplaySystemLogRow[];
  sourceState: "connected" | "fallback";
};

type MetricTone = "accent" | "good" | "warn" | "bad" | "neutral" | "soft";
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
    const trimmed = value.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => toText(item).trim())
            .filter(Boolean);
        }
      } catch {
        // Fall through to a lenient split for partially serialized values.
      }
    }

    return value
      .split(/[,|]/)
      .map((item) => item.trim().replace(/^\[?["']?/, "").replace(/["']?\]?$/, ""))
      .filter(Boolean);
  }
  return [];
}

function formatTime(value: string, options?: Intl.DateTimeFormatOptions) {
  const text = value.trim();
  const numeric = Number(text);
  const date =
    text && Number.isFinite(numeric) && /^\d{10,13}$/.test(text)
      ? new Date(text.length === 10 ? numeric * 1000 : numeric)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "Unknown";
  }

  return new Intl.DateTimeFormat("ko-KR", options ?? { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatUsd(value?: number) {
  if (!value) {
    return "USD 환산값 없음";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value || 0);
}

function formatScore(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function humanizeConfidence(value?: string) {
  const normalized = (value ?? "").toLowerCase();

  if (!normalized) {
    return "신뢰도 미표시";
  }
  if (normalized.includes("high")) {
    return "신뢰도 높음";
  }
  if (normalized.includes("medium")) {
    return "신뢰도 보통";
  }
  if (normalized.includes("low")) {
    return "신뢰도 낮음";
  }
  return value ?? "신뢰도 미표시";
}

function humanizeChain(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized || normalized === "unknown") {
    return "체인 미확인";
  }
  if (normalized === "eth" || normalized === "ethereum") {
    return "Ethereum";
  }
  if (normalized === "sol" || normalized === "solana") {
    return "Solana";
  }
  return value;
}

function formatCompactCount(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value || 0);
}

function shortAddressLabel(value: string) {
  const normalized = value.toLowerCase();

  if (!value || normalized === "unknown") {
    return "미확인 지갑";
  }
  if (normalized.includes("exchange") || normalized.includes("cex")) {
    return "거래소 관련 주소";
  }
  if (normalized === "unknown") {
    return "주소 미확인";
  }
  if (normalized.includes("vault")) {
    return "Vault";
  }
  if (normalized.includes("deposit")) {
    return "입금 주소";
  }
  if (normalized.includes("withdraw")) {
    return "출금 주소";
  }
  if (normalized.includes("bridge")) {
    return "브리지 주소";
  }
  if (normalized.startsWith("0x") && value.length > 12) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  return value;
}

function shortHashLabel(value: string) {
  const text = value.trim();
  if (!text) {
    return "근거 거래";
  }
  if (text.length > 14) {
    return `${text.slice(0, 6)}…${text.slice(-4)}`;
  }
  return text;
}

function toneForSeverity(severity: string): Exclude<MetricTone, "accent" | "soft"> {
  const value = severity.toLowerCase();

  if (value.includes("critical") || value.includes("high")) {
    return "bad";
  }
  if (value.includes("medium") || value.includes("warn")) {
    return "warn";
  }
  if (value.includes("low")) {
    return "good";
  }
  return "neutral";
}

function toneForStatus(status: string): Exclude<MetricTone, "accent" | "soft"> {
  const value = status.toLowerCase();

  if (value.includes("failed") || value.includes("error")) {
    return "bad";
  }
  if (value.includes("warn") || value.includes("completed_with_errors")) {
    return "warn";
  }
  if (value.includes("completed") || value.includes("healthy") || value.includes("connected")) {
    return "good";
  }
  return "neutral";
}

function toneForListenerStatus(status: string): Exclude<MetricTone, "accent" | "soft"> {
  if (status === "ok") {
    return "good";
  }
  if (status === "waiting" || status === "unknown") {
    return "warn";
  }
  if (status === "auth_required" || status === "attention") {
    return "bad";
  }
  return "neutral";
}

function humanizeSeverity(severity: string) {
  const value = severity.toLowerCase();

  if (value.includes("critical") || value.includes("high")) {
    return "강한 주의";
  }
  if (value.includes("medium") || value.includes("warn")) {
    return "관찰 필요";
  }
  if (value.includes("low")) {
    return "낮은 강도";
  }
  return severity || "강도 미상";
}

function humanizeSource(source: string) {
  const value = source.toLowerCase();

  if (value.includes("chain") || value.includes("onchain")) {
    return "온체인 규칙";
  }
  if (value.includes("telegram") || value.includes("tg")) {
    return "Telegram 교차검증";
  }
  if (value.includes("system")) {
    return "시스템";
  }
  return source || "출처 미상";
}

function humanizeLatestRunStatus(status: string) {
  const value = status.toLowerCase();

  if (value.includes("completed_with_errors")) {
    return "완료됐지만 경고가 있습니다";
  }
  if (value.includes("completed")) {
    return "정상 완료";
  }
  if (value.includes("failed")) {
    return "실패";
  }
  if (value.includes("warning") || value.includes("warn")) {
    return "확인 필요";
  }
  if (value.includes("running")) {
    return "실행 중";
  }
  if (value.includes("queued")) {
    return "대기 중";
  }
  return status || "상태 미상";
}

function ruleLabel(rule: string) {
  const value = rule.toLowerCase();

  if (value.includes("cex_inflow_spike")) {
    return "거래소 유입 급증";
  }
  if (value.includes("cex_outflow_spike")) {
    return "거래소 유출 급증";
  }
  if (value.includes("cold_to_hot_transfer")) {
    return "콜드월렛에서 핫월렛 이동";
  }
  if (value.includes("smart_money_accumulation")) {
    return "스마트머니 매집 가능성";
  }
  if (value.includes("corroborated_move")) {
    return "온체인과 Telegram에서 동시에 확인된 움직임";
  }
  return rule
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeSignalSummary(row: DisplaySignalRow) {
  const summary = row.summary.trim();
  if (summary) {
    const inflow = summary.match(/CEX inflow spike:\s*\$([\d,.]+)/i);
    if (inflow) {
      return `거래소로 약 $${inflow[1]} 규모의 자금 유입이 감지되었습니다. 단기 매도 압력 또는 포지션 정리 가능성을 관찰해야 합니다.`;
    }

    const outflow = summary.match(/CEX outflow spike:\s*\$([\d,.]+)/i);
    if (outflow) {
      return `거래소에서 약 $${outflow[1]} 규모의 자금 유출이 감지되었습니다. 보관 지갑 이동 또는 매도 압력 완화 가능성을 함께 봅니다.`;
    }

    return summary;
  }

  return `${ruleLabel(row.rule)}가 감지되었습니다.`;
}

function humanizeSignal(row: DisplaySignalRow) {
  return {
    ...row,
    title: ruleLabel(row.rule),
    summary: humanizeSignalSummary(row),
    confidenceLabel: humanizeConfidence(row.confidence),
    severityLabel: humanizeSeverity(row.severity),
    sourceLabel: humanizeSource(row.source),
    tone: toneForSeverity(row.severity),
  };
}

function humanizeTransaction(row: DisplayTransactionRow) {
  const from = shortAddressLabel(row.from);
  const to = shortAddressLabel(row.to);
  const amount = formatAmount(row.amount);
  const valueSummary = row.amountUsd > 0 ? `${formatUsd(row.amountUsd)} 규모` : "USD 환산값 없음";
  const chain = humanizeChain(row.chain);
  const direction = row.direction?.trim();
  const directionLabel =
    direction ||
    (row.to.toLowerCase().includes("exchange")
      ? "거래소 유입"
      : row.from.toLowerCase().includes("exchange")
        ? "거래소 유출"
        : "지갑 이동");

  return {
    ...row,
    headline: `${row.symbol} ${amount}개가 ${from}에서 ${to}로 이동했습니다.`,
    summary: `${valueSummary} · ${chain} · ${directionLabel}`,
    fromLabel: from,
    toLabel: to,
    chainLabel: chain,
    hashLabel: shortHashLabel(row.hash),
  };
}

function humanizeLogMessage(message: string, status: string) {
  const trimmed = message.trim();

  if (/completed_with_errors/i.test(status)) {
    return trimmed || "실행은 완료됐지만 확인할 경고가 있습니다.";
  }
  if (/failed/i.test(status)) {
    return trimmed || "실행에 실패했습니다.";
  }

  const telegramMatch = trimmed.match(/sent=(\d+).*failed=(\d+).*blocked=(\d+)/i);
  if (telegramMatch) {
    const [, sent, failed, blocked] = telegramMatch;
    return `Telegram 브리핑 ${sent}건 발송 완료, 실패 ${failed}건, 차단 ${blocked}건.`;
  }

  if (/price.*unknown/i.test(trimmed)) {
    return "일부 자산의 가격을 찾지 못했습니다. USD 환산이 제한될 수 있습니다.";
  }

  if (/google sheets/i.test(trimmed) && /connect/i.test(trimmed)) {
    return "Google Sheets 연결이 확인되었습니다.";
  }

  if (/missing/i.test(trimmed) && /env/i.test(trimmed)) {
    return "필수 환경 변수가 누락되었습니다.";
  }

  if (/no_brief_generated/i.test(trimmed)) {
    return "이번 실행에서는 발송 가능한 브리핑이 생성되지 않았습니다.";
  }

  return trimmed.replace(/[_]+/g, " ");
}

function humanizeLogTitle(title: string, status: string) {
  const value = title.toLowerCase();

  if (value.includes("daily_brief")) {
    return "일일 브리핑 발송";
  }
  if (value.includes("price_unknown_symbols")) {
    return "가격 보강 경고";
  }
  if (value.includes("latest pipeline")) {
    return "최근 파이프라인 실행";
  }
  if (value.includes("system event")) {
    return humanizeLatestRunStatus(status);
  }
  return title.replace(/[_-]+/g, " ") || humanizeLatestRunStatus(status);
}

function humanizeLog(row: DisplaySystemLogRow) {
  return {
    ...row,
    title: humanizeLogTitle(row.title, row.status),
    message: humanizeLogMessage(row.message, row.status),
    statusLabel: humanizeLatestRunStatus(row.status),
    tone: toneForStatus(row.status),
  };
}

function normalizeTransactions(value: unknown): DisplayTransactionRow[] {
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

function normalizeSignals(value: unknown): DisplaySignalRow[] {
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

function normalizeSystemLogs(
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

async function loadDashboardData(): Promise<DashboardData | null> {
  try {
    return {
      ...(await getDashboardData()),
      source: "google_sheets",
    };
  } catch (error) {
    if (!(error instanceof DashboardConfigError)) {
      console.error("Dashboard data load failed", error);
    }
    return null;
  }
}


function buildServiceCards(data: NormalizedDashboard) {
  const runTone = toneForStatus(data.latestRun.status);
  const connected = data.sourceState === "connected";
  const latestRunMessage = humanizeLogMessage(data.latestRun.message, data.latestRun.status);
  const listenerUpdatedAt = data.listenerHealth.updatedAt
    ? `최근 상태: ${formatTime(data.listenerHealth.updatedAt, { dateStyle: "medium", timeStyle: "short" })}`
    : "system_log에 listener heartbeat가 기록되면 상태가 갱신됩니다.";

  return [
    {
      title: "정보수집 파이프라인 워커",
      status: humanizeLatestRunStatus(data.latestRun.status),
      tone: runTone,
      description:
        latestRunMessage ||
        "최근 파이프라인 실행 상태를 확인합니다.",
      hint:
        data.latestRun.errorCount > 0
          ? `${data.latestRun.errorCount}건의 경고가 남아 있습니다.`
          : "마지막 실행은 정상적으로 마무리되었습니다.",
    },
    {
      title: "Telegram bot 워커",
      status:
        data.metrics.subscriberCount > 0 ? "정상" : "설정 필요",
      tone: data.metrics.subscriberCount > 0 ? "good" : "warn",
      description:
        data.metrics.subscriberCount > 0
          ? `${formatCompactCount(data.metrics.subscriberCount)}명의 구독자에게 알림을 보냅니다.`
          : "구독자가 아직 없어 브리핑 발송이 0건일 수 있습니다.",
      hint: "브리핑 발송과 구독자 상태를 함께 확인합니다.",
    },
    {
      title: "Telegram listener 워커",
      status: data.listenerHealth.label,
      tone: toneForListenerStatus(data.listenerHealth.status),
      description: data.listenerHealth.message,
      hint: listenerUpdatedAt,
    },
    {
      title: "Next.js dashboard",
      status: connected ? "연결됨" : "미리보기",
      tone: connected ? "good" : "neutral",
      description: connected
        ? "Google Sheets 데이터를 실제로 읽어 렌더링합니다."
        : "연결 전에는 fallback data로 레이아웃만 확인할 수 있습니다.",
      hint: "운영 화면의 최종 렌더링 계층입니다.",
    },
  ] as const;
}


function buildOperatorChecklist(data: NormalizedDashboard) {
  return [
    {
      label: "Google Sheets 연결",
      tone: data.sourceState === "connected" ? ("good" as const) : ("warn" as const),
      status: data.sourceState === "connected" ? "완료" : "확인",
      detail:
        data.sourceState === "connected"
          ? "운영 데이터가 실제 Sheets에서 들어오고 있습니다."
          : "로컬/미리보기 상태에서는 연결 여부만 확인합니다.",
    },
    {
      label: "정보수집 파이프라인",
      tone: data.latestRun.status.toLowerCase().includes("failed")
        ? ("bad" as const)
        : data.latestRun.status.toLowerCase().includes("completed")
          ? ("good" as const)
          : ("warn" as const),
      status: humanizeLatestRunStatus(data.latestRun.status),
      detail:
        data.latestRun.updatedAt
          ? `최근 실행: ${formatTime(data.latestRun.updatedAt, { dateStyle: "medium", timeStyle: "short" })}`
          : "최근 실행 기록이 아직 없습니다.",
    },
    {
      label: "Telegram listener",
      tone:
        data.listenerHealth.status === "ok"
          ? ("good" as const)
          : data.listenerHealth.status === "auth_required"
            ? ("bad" as const)
            : ("warn" as const),
      status: data.listenerHealth.label,
      detail: data.listenerHealth.message,
    },
    {
      label: "운영 알림",
      tone: data.metrics.subscriberCount > 0 ? ("good" as const) : ("neutral" as const),
      status: data.metrics.subscriberCount > 0 ? "활성" : "대기",
      detail:
        data.metrics.subscriberCount > 0
          ? `${formatCompactCount(data.metrics.subscriberCount)}명의 구독자에게 브리핑을 보낼 수 있습니다.`
          : "구독자가 아직 없어 발송 대상이 없습니다.",
    },
  ] as const;
}

const SERVICE_ICONS = ["dns", "smart_toy", "settings_input_antenna", "dashboard"] as const;

const SERVICE_ACTIONS: ReadonlyArray<{
  label: string;
  icon: string;
  variant: "primary" | "secondary";
  href: string;
} | null> = [
  { label: "실행 로그", icon: "list_alt", variant: "primary", href: "#log" },
  { label: "시그널 보기", icon: "search", variant: "secondary", href: "#signals" },
  { label: "상태 로그", icon: "monitor_heart", variant: "secondary", href: "#log" },
  null,
];

function iconToneClass(tone: string) {
  if (tone === "good") return "service-card__icon--good";
  if (tone === "bad") return "service-card__icon--bad";
  if (tone === "warn") return "service-card__icon--warn";
  return "service-card__icon--neutral";
}

function badgeToneClass(tone: string) {
  if (tone === "good") return "service-card__status-badge--good";
  if (tone === "bad") return "service-card__status-badge--bad";
  if (tone === "warn") return "service-card__status-badge--warn";
  return "service-card__status-badge--neutral";
}

function chainIconName(chain: string) {
  const c = chain.toLowerCase();
  if (c.includes("eth")) return "currency_exchange";
  if (c.includes("btc") || c.includes("bitcoin")) return "currency_bitcoin";
  if (c.includes("sol")) return "token";
  return "monetization_on";
}

function chainIconColor(chain: string) {
  const c = chain.toLowerCase();
  if (c.includes("eth")) return "var(--accent)";
  if (c.includes("btc") || c.includes("bitcoin")) return "#ea580c";
  if (c.includes("sol")) return "#7c3aed";
  return "#0d9488";
}

export default async function DashboardPage() {
  const data = normalizeDashboardData(await loadDashboardData());
  const serviceCards = buildServiceCards(data);
  const operatorChecklist = buildOperatorChecklist(data);
  const signals = data.recentSignals.slice(0, 6).map(humanizeSignal);
  const transactions = data.recentTransactions.slice(0, 6).map(humanizeTransaction);
  const logs = data.systemLogs.slice(0, 6).map(humanizeLog);
  const logRows: SystemLogRow[] = logs.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    status: row.status,
    title: row.title,
    message: row.message,
  }));

  return (
    <>
      {/* Top Navigation Bar */}
      <header className="top-navbar">
        <div className="top-navbar__inner">
          <div className="top-navbar__left">
            <Link href="/" className="top-navbar__brand">WhaleScope</Link>
            <div className="top-navbar__badge-group">
              <span className="top-navbar__assignment-badge">뤼튼 과제 전형</span>
              <p className="top-navbar__badge-desc">뤼튼 테크놀로지스 Product Engineer 과제 제출용 데모</p>
            </div>
          </div>

          <nav className="top-navbar__nav">
            <Link href="/" className="top-navbar__nav-link top-navbar__nav-link--active">대시보드</Link>
            <Link href="/insights" className="top-navbar__nav-link">인사이트</Link>
            <a href="#signals" className="top-navbar__nav-link">시그널</a>
            <a href="#transactions" className="top-navbar__nav-link">리포트</a>
          </nav>

          <div className="top-navbar__right">
            <div className="top-navbar__profile-info">
              <div className="top-navbar__profile-name">운영자 프로필</div>
              <div className="top-navbar__profile-role">시스템 관리자</div>
            </div>
            <div className="top-navbar__avatar" aria-label="운영자 프로필">
              <span className="material-symbols-outlined">person</span>
            </div>
          </div>
        </div>
      </header>

      <main className="main-content">
        {/* Hero Summary Banner */}
        <section className="col-span-12">
          <div className="hero-banner glass-card">
            <div className="hero-banner__wave-icon" aria-hidden="true">
              <span className="material-symbols-outlined">waves</span>
            </div>
            <div className="hero-banner__content">
              <h1 className="hero-banner__title">WhaleScope 운영 대시보드</h1>
              <div className="hero-banner__summary-box">
                <span className="material-symbols-outlined">auto_awesome</span>
                <p className="hero-banner__summary-text">
                  오늘 감지된 주요 고래 이동은 <strong>{formatCompactCount(data.metrics.transactionCount)}건</strong>이며,
                  CEX 유입 시그널 <strong>{formatCompactCount(data.metrics.signalCount)}건</strong>과
                  일일 브리핑 <strong>{formatCompactCount(data.metrics.dailyBriefCount)}건</strong>이 확인되었습니다.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Service Health Grid */}
        <section className="col-span-12">
          <div className="service-health-grid">
            {serviceCards.map((card, idx) => {
              const action = SERVICE_ACTIONS[idx] ?? null;
              const icon = SERVICE_ICONS[idx] ?? "dns";
              return (
                <div key={card.title} className="service-card glass-card">
                  <div>
                    <div className="service-card__header">
                      <div className={`service-card__icon ${iconToneClass(card.tone)}`}>
                        <span className="material-symbols-outlined">{icon}</span>
                      </div>
                      <span className={`service-card__status-badge ${badgeToneClass(card.tone)}`}>
                        {card.status}
                      </span>
                    </div>
                    <h3 className="service-card__title">{card.title}</h3>
                    <p className="service-card__desc">{card.description}</p>
                  </div>
                  {action ? (
                    <a
                      href={action.href}
                      className={`service-card__action-btn service-card__action-btn--${action.variant}`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{action.icon}</span>
                      {action.label}
                    </a>
                  ) : (
                    <div className="service-card__live-indicator">
                      <span className="service-card__live-dot" />
                      시스템 활성 상태
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Daily Brief (8 cols) */}
        <section className="col-span-8" id="daily-brief">
          <div className="brief-card glass-card">
            <div className="brief-card__header">
              <h2 className="brief-card__header-title">오늘의 고래 브리핑</h2>
              <span className="brief-card__header-time">
                마지막 업데이트: {formatTime(data.generatedAt, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>

            <article>
              <h3 className="brief-card__article-title">
                {data.latestBrief.summary.length > 60
                  ? data.latestBrief.summary.slice(0, 60).trim()
                  : data.latestBrief.summary}
              </h3>

              <p className="brief-card__body-text">{data.latestBrief.summary}</p>

              <div className="brief-card__two-col">
                <div className="brief-card__col-box brief-card__col-box--signals">
                  <h4 className="brief-card__col-title brief-card__col-title--primary">
                    <span className="material-symbols-outlined">search</span> 주목 시그널
                  </h4>
                  {data.latestBrief.highlights && data.latestBrief.highlights.length > 0 ? (
                    <ul className="brief-card__col-list">
                      {data.latestBrief.highlights.map((item) => (
                        <li key={item}>&#8226; {item}</li>
                      ))}
                    </ul>
                  ) : signals.length > 0 ? (
                    <ul className="brief-card__col-list">
                      {signals.slice(0, 3).map((s) => (
                        <li key={s.id}>&#8226; {s.title}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="brief-card__col-text">아직 수집된 시그널이 없습니다.</p>
                  )}
                </div>

                <div className="brief-card__col-box brief-card__col-box--insights">
                  <h4 className="brief-card__col-title brief-card__col-title--tertiary">
                    <span className="material-symbols-outlined">trending_up</span> 시장 시사점
                  </h4>
                  {data.latestBrief.signalThemes && data.latestBrief.signalThemes.length > 0 ? (
                    <p className="brief-card__col-text">
                      {data.latestBrief.signalThemes.join(", ")}
                    </p>
                  ) : (
                    <p className="brief-card__col-text">
                      {humanizeLogMessage(data.latestRun.message, data.latestRun.status)}
                    </p>
                  )}
                </div>
              </div>

              <p className="brief-card__disclaimer">
                본 콘텐츠는 정보 제공 목적으로만 작성되었으며, 투자 조언이 아닙니다. 모든 투자의 책임은 본인에게 있습니다.
              </p>
            </article>
          </div>
        </section>

        {/* Right Side: Signals + Checklist (4 cols) */}
        <section className="col-span-4" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Core Signals */}
          <div className="signals-panel glass-card" id="signals">
            <h3 className="signals-panel__title">
              <span className="material-symbols-outlined">emergency_home</span> 핵심 시그널
            </h3>

            {signals.length > 0 ? (
              <div>
                {signals.slice(0, 4).map((row) => (
                  <div key={row.id} className={`signal-item signal-item--${row.tone}`}>
                    <div className="signal-item__top-row">
                      <div className="signal-item__severity-dot">
                        <span className={`signal-item__dot signal-item__dot--${row.tone}`} />
                        <span className={`signal-item__severity-label signal-item__severity-label--${row.tone}`}>
                          {row.severityLabel}
                        </span>
                      </div>
                      <span className="signal-item__time">
                        {formatTime(row.createdAt, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <h4 className="signal-item__title">{row.title}</h4>
                    <p className="signal-item__desc">{row.summary}</p>
                    <div className="signal-item__meta">
                      <span>Score {formatScore(row.score)}</span>
                      <span>{row.confidenceLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p className="empty-state__title">시그널 없음</p>
                <p className="empty-state__body">파이프라인 실행 후 시그널이 이 영역에 표시됩니다.</p>
              </div>
            )}
          </div>

          {/* Operator Checklist (dark) */}
          <div className="checklist-dark-card" id="operator-checklist">
            <h3 className="checklist-dark-card__title">
              <span className="material-symbols-outlined">checklist</span> 운영 체크리스트
            </h3>
            <div>
              {operatorChecklist.map((item) => {
                const isDone = item.tone === "good";
                return (
                  <div key={item.label} className="checklist-item">
                    <div className={`checklist-item__checkbox ${isDone ? "checklist-item__checkbox--checked" : "checklist-item__checkbox--unchecked"}`}>
                      {isDone && <span className="material-symbols-outlined">check</span>}
                    </div>
                    <span className={`checklist-item__label ${isDone ? "checklist-item__label--checked" : "checklist-item__label--unchecked"}`}>
                      {item.label}
                    </span>
                    <span className={`checklist-item__status ${isDone ? "checklist-item__status--done" : "checklist-item__status--pending"}`}>
                      {item.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Whale Movement Timeline (8 cols) */}
        <section className="col-span-8" id="transactions">
          <div className="timeline-card glass-card">
            <h2 className="timeline-card__title">고래 이동 타임라인</h2>
            {transactions.length > 0 ? (
              <div className="timeline-list">
                {transactions.map((row) => (
                  <div key={row.id} className="timeline-item">
                    <div className="timeline-item__icon">
                      <span className="material-symbols-outlined" style={{ color: chainIconColor(row.chain) }}>
                        {chainIconName(row.chain)}
                      </span>
                    </div>
                    <div className="timeline-item__body">
                      <p className="timeline-item__headline">
                        <strong style={{ color: chainIconColor(row.chain) }}>{row.symbol} {formatAmount(row.amount)}개</strong>
                        가 {row.fromLabel}에서{" "}
                        <span className="timeline-item__direction-badge timeline-item__direction-badge--in">
                          {row.toLabel}
                        </span>
                        {" "}로 이동했습니다.
                      </p>
                      <span className="timeline-item__meta">
                        {formatTime(row.timestamp, { hour: "2-digit", minute: "2-digit" })} 전 &#8226; {row.chainLabel}
                        {row.amountUsd > 0 ? ` &#8226; ${formatUsd(row.amountUsd)}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p className="empty-state__title">아직 수집된 거래가 없습니다.</p>
                <p className="empty-state__body">파이프라인을 실행하면 최신 거래가 타임라인에 표시됩니다.</p>
              </div>
            )}
          </div>
        </section>

        {/* Operation Log (4 cols) */}
        <section id="log" className="col-span-4 glass-card oplog-card">
          <h2 className="oplog-card__title">운영 알림 센터</h2>
          <SystemLogPanel rows={logRows} />
        </section>
      </main>

      {/* Floating Assignment Badge */}
      <div className="floating-badge">
        <div className="floating-badge__inner">
          <div className="floating-badge__label">Wrtn Technologies</div>
          <div className="floating-badge__divider" />
          <div className="floating-badge__sub">Official Assignment Demo</div>
        </div>
      </div>
    </>
  );
}
