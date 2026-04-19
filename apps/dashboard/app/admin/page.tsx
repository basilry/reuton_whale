import { TopNavbar } from "@/components/top-navbar";
import { AdminSessionPanel } from "@/components/admin-session-panel";
import {
  AdminOperationsOverview,
  type AdminChecklistItem,
  type AdminCorrelationSection,
  type AdminDataSection,
  type AdminInsightCard,
  type AdminOperationsHero,
  type AdminRenderSection,
  type AdminServiceCard,
  type AdminStatBlock,
  type AdminTone,
  type AdminWorkerSection,
} from "@/components/admin/admin-operations-overview";
import type { SystemLogRow } from "@/components/system-log-panel";
import { DASHBOARD_SESSION_COOKIE_NAME, getDashboardAuthResult } from "@/lib/auth";
import { DashboardConfigError } from "@/lib/env";
import {
  formatCompactCount,
  formatTime,
  humanizeLog,
  humanizeOpsStatus,
  humanizeSignal,
  humanizeSourceFailureKind,
  humanizeTransaction,
  toneForOpsStatus,
} from "@/lib/humanize";
import { getDashboardData } from "@/lib/metrics";
import { getCurrentDashboardLanguage } from "@/lib/i18n/server";
import { normalizeDashboardData } from "@/lib/normalize";
import { cookies } from "next/headers";
import type {
  AdminRenderObservability,
  AdminObservabilitySummary,
  DashboardData,
  NormalizedDashboard,
  OpsServiceName,
  RenderApiError,
} from "@/lib/types";
import styles from "../page.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenericRecord = Record<string, unknown>;

type RenderServiceSnapshot = {
  key: string;
  name: string;
  kind: string;
  status: string;
  tone: AdminTone;
  detail: string;
  meta: string[];
};

type RenderListItem = {
  key: string;
  service: string;
  status: string;
  tone: AdminTone;
  detail: string;
};

async function loadDashboardData(): Promise<DashboardData | null> {
  try {
    return {
      ...(await getDashboardData()),
      source: "google_sheets",
    };
  } catch (error) {
    if (!(error instanceof DashboardConfigError)) {
      console.error(
        "Dashboard data load failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
}

const SERVICE_ORDER: OpsServiceName[] = [
  "pipeline",
  "listener",
  "bot",
  "dashboard",
  "data_source",
];

const SERVICE_ACTIONS: Partial<Record<OpsServiceName, { label: string; href: string }>> = {
  pipeline: { label: "최근 로그", href: "#system-log" },
  listener: { label: "상관관계 보기", href: "#correlation-summary" },
  bot: { label: "상관관계 보기", href: "#correlation-summary" },
  data_source: { label: "수집 현황", href: "#data-ingestion" },
};

function toRecord(value: unknown): GenericRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GenericRecord)
    : null;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function clipText(value: string | undefined, length: number): string {
  if (!value) {
    return "기록 없음";
  }
  return value.length > length ? `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…` : value;
}

function minutesSince(value?: string): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - timestamp) / 60000));
}

function ageLabel(value?: string): string {
  const minutes = minutesSince(value);
  if (minutes == null) {
    return "기록 없음";
  }
  if (minutes < 1) {
    return "방금 전";
  }
  if (minutes < 60) {
    return `${minutes.toLocaleString("ko-KR")}분 전`;
  }
  if (minutes < 24 * 60) {
    return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}시간 전`;
  }
  return `${(minutes / (24 * 60)).toFixed(1)}일 전`;
}

function formatObservedTime(value?: string): string {
  return value
    ? formatTime(value, { dateStyle: "medium", timeStyle: "short" })
    : "기록 없음";
}

function formatRatio(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSignedCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "기록 없음";
  }
  const normalized = Math.trunc(value);
  if (normalized === 0) {
    return "0";
  }
  return `${normalized > 0 ? "+" : ""}${normalized.toLocaleString("ko-KR")}`;
}

function formatMessageLength(value: number | null): string {
  return value == null ? "기록 없음" : `${value.toLocaleString("ko-KR")}자`;
}

function formatCapFlag(value: boolean | null): string {
  if (value == null) {
    return "확인 불가";
  }
  return value ? "초과" : "정상";
}

function formatDurationSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0초";
  }
  if (value % 1000 === 0) {
    return `${Math.round(value / 1000)}초`;
  }
  return `${(value / 1000).toFixed(1)}초`;
}

function formatLatencyMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "기록 없음";
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return formatDurationSeconds(value);
}

function freshnessTone(observedAt: string | undefined, slaMinutes: number): AdminTone {
  const age = minutesSince(observedAt);
  if (age == null) {
    return "neutral";
  }
  if (age <= slaMinutes) {
    return "good";
  }
  if (age <= slaMinutes * 2) {
    return "warn";
  }
  return "bad";
}

function freshnessStatus(observedAt: string | undefined, slaMinutes: number): string {
  const age = minutesSince(observedAt);
  if (age == null) {
    return "기록 없음";
  }
  if (age <= slaMinutes) {
    return "정상";
  }
  if (age <= slaMinutes * 2) {
    return "지연";
  }
  return "stale";
}

function formatCount(value: number | null | undefined, suffix = "건"): string {
  if (value == null || !Number.isFinite(value)) {
    return "미제공";
  }
  return `${formatCompactCount(value)}${suffix}`;
}

function humanizeLiveUpdateReason(
  reason: AdminObservabilitySummary["liveUpdates"]["reason"],
): string {
  if (reason === "feature_disabled") {
    return "기능 비활성화";
  }
  if (reason === "redis_missing") {
    return "Redis URL 누락";
  }
  if (reason === "token_missing") {
    return "Redis token 누락";
  }
  return "정상";
}

function humanizeMarketSourceId(id: AdminObservabilitySummary["marketSources"][number]["id"]): string {
  switch (id) {
    case "binance":
      return "Binance";
    case "upbit":
      return "Upbit";
    case "bitflyer":
      return "Bitflyer";
    case "kraken":
      return "Kraken";
    case "fx":
      return "FX";
    case "snapshot":
      return "Snapshot";
    case "fear_greed":
      return "Fear & Greed";
    default:
      return id;
  }
}

function humanizeMarketSourceStatus(
  status: AdminObservabilitySummary["marketSources"][number]["status"],
): string {
  switch (status) {
    case "ready":
      return "정상";
    case "degraded":
      return "지연";
    case "manual_check":
      return "배포 확인 필요";
    case "unavailable":
      return "미가용";
    default:
      return status;
  }
}

function extractRowCounts(rawData: DashboardData | null) {
  const root = toRecord(rawData);
  const metrics = toRecord(root?.metrics);
  const rowCounts = toRecord(metrics?.rowCounts);

  return {
    transactions: toNumber(rowCounts?.transactions),
    signals: toNumber(rowCounts?.signals),
    dailyBrief: toNumber(rowCounts?.daily_brief),
    systemLog: toNumber(rowCounts?.system_log),
    subscribers: toNumber(rowCounts?.subscribers),
  };
}

function buildHero(
  data: NormalizedDashboard,
  rawData: DashboardData | null,
  renderSection: AdminRenderSection,
): AdminOperationsHero {
  const environment = process.env.NODE_ENV === "production" ? "prod" : "dev";
  const renderMeta =
    renderSection.availability === "available"
      ? "Render 연동 연결됨"
      : renderSection.availability === "error"
        ? "Render 연동 오류"
        : "Render 연동 대기";

  return {
    title: "WhaleScope 운영 관측 대시보드",
    summary: [
      data.opsSummary.headline,
      data.opsSummary.detail,
      `현재 파이프라인은 ${humanizeOpsStatus(data.serviceHealth.pipeline.status)} 상태이며 데이터 원천은 ${data.sourceHealth.label}입니다.`,
    ].join(" "),
    meta: [
      `환경: ${environment}`,
      `현재 시각: ${formatObservedTime(new Date().toISOString())}`,
      `데이터 기준: ${formatObservedTime(rawData?.generatedAt ?? data.generatedAt)}`,
      `원천: ${data.sourceHealth.source}`,
      renderMeta,
    ],
    links: [
      { label: "수집 데이터", href: "#data-ingestion" },
      { label: "워커 상태", href: "#worker-health" },
      { label: "Render 상태", href: "#render-platform" },
      { label: "상관관계", href: "#correlation-summary" },
    ],
  };
}

function buildDataSection(data: NormalizedDashboard, rawData: DashboardData | null): AdminDataSection {
  const summary = rawData?.adminObservability ?? null;
  const rowCounts = extractRowCounts(rawData);
  const latestTransaction = data.recentTransactions[0]
    ? humanizeTransaction(data.recentTransactions[0])
    : null;
  const latestSignal = data.recentSignals[0] ? humanizeSignal(data.recentSignals[0]) : null;
  const newsSection = summary?.liveUpdates.sections.find((section) => section.section === "news");
  const briefSection = summary?.liveUpdates.sections.find((section) => section.section === "brief");

  const items = [
    {
      key: "transactions",
      label: "transactions",
      source: "Sheets",
      status: freshnessStatus(latestTransaction?.timestamp, 15),
      tone: freshnessTone(latestTransaction?.timestamp, 15),
      count: rowCounts.transactions != null ? `${formatCompactCount(rowCounts.transactions)} rows` : "미제공",
      observedAt: formatObservedTime(latestTransaction?.timestamp),
      detail: latestTransaction ? latestTransaction.summary : "최근 거래 레코드가 없습니다.",
    },
    {
      key: "signals",
      label: "signals",
      source: "Sheets",
      status: freshnessStatus(latestSignal?.createdAt, 30),
      tone: freshnessTone(latestSignal?.createdAt, 30),
      count: rowCounts.signals != null ? `${formatCompactCount(rowCounts.signals)} rows` : "미제공",
      observedAt: formatObservedTime(latestSignal?.createdAt),
      detail: latestSignal ? latestSignal.title : "최근 시그널 레코드가 없습니다.",
    },
    {
      key: "daily-brief",
      label: "daily_brief",
      source: "Sheets",
      status: freshnessStatus(data.latestBrief.generatedAt, 8 * 60),
      tone: freshnessTone(data.latestBrief.generatedAt, 8 * 60),
      count: rowCounts.dailyBrief != null ? `${formatCompactCount(rowCounts.dailyBrief)} rows` : "미제공",
      observedAt: formatObservedTime(data.latestBrief.generatedAt),
      detail: clipText(data.latestBrief.summary, 88),
    },
    {
      key: "news-feed",
      label: "news_feed",
      source: "Live updates",
      status: freshnessStatus(newsSection?.lastUpdatedAt, 60),
      tone: freshnessTone(newsSection?.lastUpdatedAt, 60),
      count: "행 수 미제공",
      observedAt: formatObservedTime(newsSection?.lastUpdatedAt),
      detail: newsSection
        ? `revalidate ${formatObservedTime(newsSection.lastRevalidatedAt)}`
        : "현재 payload에는 news_feed row count가 포함되지 않습니다.",
    },
    {
      key: "tg-whale-events",
      label: "tg_whale_events",
      source: "Listener",
      status: freshnessStatus(data.listenerHealth.updatedAt, 30),
      tone: freshnessTone(data.listenerHealth.updatedAt, 30),
      count: "행 수 미제공",
      observedAt: formatObservedTime(data.listenerHealth.updatedAt),
      detail: data.listenerHealth.message,
    },
    {
      key: "broadcast-log",
      label: "broadcast_log",
      source: "Periodic",
      status: freshnessStatus(summary?.periodic.latestPeriodicSendAt, 8 * 60),
      tone: freshnessTone(summary?.periodic.latestPeriodicSendAt, 8 * 60),
      count: summary ? `${formatCompactCount(summary.periodic.totalExecutions)}회 / 24h` : "미제공",
      observedAt: formatObservedTime(summary?.periodic.latestPeriodicSendAt),
      detail: summary
        ? `skipped_empty ${formatRatio(summary.periodic.skippedEmpty.ratio)} · duplicate ${formatRatio(summary.periodic.skippedDuplicateContent.ratio)}`
        : "broadcast_log observability가 아직 없습니다.",
    },
    {
      key: "brief-cost-ledger",
      label: "brief_cost_ledger",
      source: "Brief",
      status: freshnessStatus(summary?.brief.latestGeneratedAt ?? briefSection?.lastUpdatedAt, 8 * 60),
      tone: freshnessTone(summary?.brief.latestGeneratedAt ?? briefSection?.lastUpdatedAt, 8 * 60),
      count: summary ? `${formatCompactCount(summary.brief.llmCallCount)}회 호출` : "미제공",
      observedAt: formatObservedTime(summary?.brief.latestGeneratedAt ?? briefSection?.lastUpdatedAt),
      detail: summary
        ? `generated ${summary.brief.generated.count} · cached ${summary.brief.cached.count}`
        : "brief_cost_ledger / llm_budget_log 요약이 아직 없습니다.",
    },
  ];

  const snapshots = [
    {
      key: "snapshot-brief",
      title: "최신 브리핑",
      eyebrow: "daily_brief",
      body: clipText(data.latestBrief.summary, 160),
      meta: [
        `생성 시각: ${formatObservedTime(data.latestBrief.generatedAt)}`,
        `하이라이트 ${data.latestBrief.highlights?.length ?? 0}개`,
        data.latestBrief.signalThemes?.length
          ? `주요 테마: ${clipText(data.latestBrief.signalThemes.join(", "), 72)}`
          : "주요 테마 기록 없음",
      ],
    },
    {
      key: "snapshot-signal",
      title: latestSignal ? latestSignal.title : "최신 시그널 없음",
      eyebrow: "signals",
      body: latestSignal ? clipText(latestSignal.summary, 140) : "최근 시그널이 수집되면 이 카드가 자동으로 채워집니다.",
      meta: [
        `시각: ${formatObservedTime(latestSignal?.createdAt)}`,
        `강도: ${latestSignal?.severityLabel ?? "기록 없음"}`,
        `신뢰도: ${latestSignal?.confidenceLabel ?? "기록 없음"}`,
      ],
    },
    {
      key: "snapshot-transaction",
      title: latestTransaction
        ? `${latestTransaction.symbol} ${formatCompactCount(latestTransaction.amount)}`
        : "최신 거래 없음",
      eyebrow: "transactions",
      body: latestTransaction ? latestTransaction.headline : "최근 거래 레코드가 들어오면 이 카드가 자동으로 채워집니다.",
      meta: [
        `시각: ${formatObservedTime(latestTransaction?.timestamp)}`,
        `체인: ${latestTransaction?.chainLabel ?? "기록 없음"}`,
        latestTransaction?.summary ?? "USD 환산/이동 방향 기록 없음",
      ],
    },
  ];

  const stats: AdminStatBlock[] = [
    {
      label: "브리핑 실행",
      value: summary ? formatCount(summary.brief.totalRuns, "회") : "미제공",
      detail: summary
        ? `generated ${formatRatio(summary.brief.generated.ratio)} · cached ${formatRatio(summary.brief.cached.ratio)}`
        : "brief observability 미연결",
      tone: summary?.brief.totalRuns ? "good" : "neutral",
    },
    {
      label: "LLM 호출",
      value: summary ? formatCount(summary.brief.llmCallCount, "회") : "미제공",
      detail: summary
        ? `inactive skip ${summary.brief.skippedInactive.count} · budget skip ${summary.brief.skippedBudget.count}`
        : "llm_budget_log 미연결",
      tone: summary?.brief.llmCallCount ? "good" : "neutral",
    },
    {
      label: "Periodic 발송",
      value: summary ? formatCount(summary.periodic.totalExecutions, "회") : "미제공",
      detail: summary
        ? `최근 길이 ${formatMessageLength(summary.periodic.latestMessageLength)} · 1500자 캡 ${formatCapFlag(summary.periodic.latestMessageExceededCap)}`
        : "broadcast_log 미연결",
      tone:
        summary?.periodic.latestMessageExceededCap == null
          ? "neutral"
          : summary.periodic.latestMessageExceededCap
            ? "bad"
            : "good",
    },
    {
      label: "활성 구독자",
      value: summary ? formatCount(summary.telegram.subscriberCountActive, "명") : formatCount(data.metrics.subscriberCount, "명"),
      detail: summary
        ? `24h 이탈 ${formatCount(summary.telegram.unsubscribe24h, "건")} · 채널 변화 ${formatSignedCount(summary.telegram.channelMemberDelta24h)}`
        : "telegram observability 미연결",
      tone: summary?.telegram.subscriberCountActive ? "good" : "neutral",
    },
  ];

  return {
    items,
    snapshots,
    stats,
    note:
      "현재 shared dashboard payload는 모든 운영 탭의 24시간 증가량을 제공하지 않습니다. `news_feed`, `tg_whale_events`, `broadcast_log`, `brief_cost_ledger`는 노출된 최신 시각 또는 observability 집계를 사용해 fallback 표시합니다.",
  };
}

function buildServiceCards(data: NormalizedDashboard): AdminServiceCard[] {
  return SERVICE_ORDER.map((name) => {
    const item = data.serviceHealth[name];
    const detail = [
      item.updatedAt ? `최근 상태 ${formatObservedTime(item.updatedAt)}` : "",
      item.source ? `관측 소스 ${item.source}` : "",
      name === "data_source" && data.sourceHealth.failureKind
        ? `원인 분류 ${humanizeSourceFailureKind(data.sourceHealth.failureKind)}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || item.detail;

    return {
      key: name,
      title: item.title,
      status: item.label || humanizeOpsStatus(item.status),
      tone: toneForOpsStatus(item.status),
      summary: item.summary,
      detail,
      action: SERVICE_ACTIONS[name] ?? null,
    };
  });
}

function buildRuntimeChecklist(data: NormalizedDashboard): AdminChecklistItem[] {
  return SERVICE_ORDER.map((name) => {
    const item = data.serviceHealth[name];
    return {
      key: name,
      label: item.title,
      tone: toneForOpsStatus(item.status),
      status: item.label || humanizeOpsStatus(item.status),
      detail: item.detail,
    };
  });
}

function buildConfigChecklist(data: NormalizedDashboard): AdminChecklistItem[] {
  return data.operatorChecks.map((item) => ({
    key: item.key,
    label: item.label,
    tone:
      item.status === "ok"
        ? "good"
        : item.status === "missing"
          ? "bad"
          : "warn",
    status: item.status === "ok" ? "완료" : item.status === "missing" ? "누락" : "확인",
    detail: item.detail,
  }));
}

function buildWorkerInsights(summary: AdminObservabilitySummary | null): AdminInsightCard[] {
  if (!summary) {
    return [
      {
        key: "observability-missing",
        title: "운영 관측 데이터",
        tone: "neutral",
        lines: ["adminObservability payload가 아직 없습니다.", "brief/broadcast/live update/telegram 요약이 비어 있습니다."],
        hint: "관련 Sheets 탭과 live update diagnostics가 채워지면 이 카드가 자동으로 세분화됩니다.",
      },
    ];
  }

  return [
    {
      key: "live-updates",
      title: "SSE live updates",
      tone:
        summary.liveUpdates.state === "enabled"
          ? "good"
          : summary.liveUpdates.reason === "feature_disabled"
            ? "neutral"
            : "warn",
      lines: [
        `상태 ${summary.liveUpdates.state === "enabled" ? "활성" : "비활성"} · 사유 ${humanizeLiveUpdateReason(summary.liveUpdates.reason)}`,
        `poll ${formatDurationSeconds(summary.liveUpdates.pollIntervalMs)} · heartbeat ${formatDurationSeconds(summary.liveUpdates.heartbeatIntervalMs)}`,
        summary.liveUpdates.sections
          .map((section) => `${section.section} ${ageLabel(section.lastUpdatedAt)} · revalidate ${formatObservedTime(section.lastRevalidatedAt)}`)
          .join(" · "),
      ],
      hint: `최근 이벤트 ${summary.liveUpdates.lastEventId ?? "기록 없음"} · 지연 ${formatLatencyMs(summary.liveUpdates.latestLatencyMs)} · reconnect ${summary.liveUpdates.reconnectCount}회`,
    },
    {
      key: "telegram-ops",
      title: "Telegram 운영",
      tone:
        summary.telegram.lastBroadcastStatus === "failed"
          ? "bad"
          : summary.telegram.subscriberCountActive > 0 || summary.telegram.channelMemberCountLatest != null
            ? "good"
            : "neutral",
      lines: [
        `활성 ${formatCount(summary.telegram.subscriberCountActive, "명")} · 일시중지 ${formatCount(summary.telegram.subscriberCountPaused, "명")} · 차단 ${formatCount(summary.telegram.subscriberCountBlocked, "명")}`,
        `24h 이탈 ${formatCount(summary.telegram.unsubscribe24h, "건")} · 이탈률 ${formatRatio(summary.telegram.unsubscribeRate24h)}`,
        `채널 멤버 ${summary.telegram.channelMemberCountLatest == null ? "기록 없음" : formatCompactCount(summary.telegram.channelMemberCountLatest)} · 24h 변화 ${formatSignedCount(summary.telegram.channelMemberDelta24h)}`,
      ],
      hint: `최근 channel_health ${formatObservedTime(summary.telegram.lastChannelHealthAt)} · 최근 발송 ${formatObservedTime(summary.telegram.lastBroadcastAt)}`,
    },
    {
      key: "market-sources",
      title: "시장 소스 진단",
      tone: summary.marketSources.every((item) => item.status === "ready")
        ? "good"
        : summary.marketSources.some((item) => item.status === "unavailable")
          ? "warn"
          : "neutral",
      lines: summary.marketSources.map((item) => {
        const freshness =
          item.freshnessSeconds == null
            ? "freshness 없음"
            : `${item.freshnessSeconds.toLocaleString("ko-KR")}초`;
        const suffix = item.lastSuccessAt
          ? `최근 성공 ${formatObservedTime(item.lastSuccessAt)}`
          : item.failureReason
            ? item.failureReason
            : "수동 확인 대기";
        return `${humanizeMarketSourceId(item.id)} · ${humanizeMarketSourceStatus(item.status)} · ${item.transport} · ${freshness} · ${suffix}`;
      }),
      hint: "websocket/live 소스는 배포 브라우저에서 최종 상태를 확인해야 합니다.",
    },
  ];
}

function buildFailureRows(data: NormalizedDashboard): SystemLogRow[] {
  const logs = data.systemLogs.slice(0, 12).map(humanizeLog);
  const filtered = logs.filter((row) => row.tone === "warn" || row.tone === "bad");

  return filtered.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    status: row.status,
    title: row.title,
    message: row.message,
  }));
}

function buildWorkerJobRows(
  data: NormalizedDashboard,
  rawData: DashboardData | null,
): AdminWorkerSection["jobRows"] {
  const summary = rawData?.adminObservability ?? null;
  const liveUpdateSections =
    summary?.liveUpdates.sections
      .map((section) => `${section.section} ${ageLabel(section.lastUpdatedAt)}`)
      .join(" · ") ?? "";
  const briefTone = freshnessTone(summary?.brief.latestGeneratedAt, 8 * 60);
  const briefStatus = freshnessStatus(summary?.brief.latestGeneratedAt, 8 * 60);
  const periodicTone = freshnessTone(summary?.periodic.latestPeriodicSendAt, 30);
  const periodicStatus = freshnessStatus(summary?.periodic.latestPeriodicSendAt, 30);
  const liveUpdatesTone: AdminTone = summary
    ? summary.liveUpdates.state === "enabled"
      ? "good"
      : summary.liveUpdates.reason === "feature_disabled"
        ? "neutral"
        : "warn"
    : toneForOpsStatus(data.serviceHealth.dashboard.status);
  const liveUpdatesStatus = summary
    ? summary.liveUpdates.state === "enabled"
      ? "활성"
      : "비활성"
    : data.serviceHealth.dashboard.label || humanizeOpsStatus(data.serviceHealth.dashboard.status);
  const botTone: AdminTone = summary
    ? summary.telegram.lastBroadcastStatus === "failed"
      ? "bad"
      : summary.telegram.subscriberCountActive > 0 || summary.telegram.channelMemberCountLatest != null
        ? "good"
        : "neutral"
    : toneForOpsStatus(data.serviceHealth.bot.status);
  const botStatus = summary
    ? summary.telegram.lastBroadcastStatus === "failed"
      ? "발송 실패"
      : summary.telegram.subscriberCountActive > 0
        ? "운영 중"
        : "대기"
    : data.serviceHealth.bot.label || humanizeOpsStatus(data.serviceHealth.bot.status);

  return [
    {
      key: "pipeline-signals",
      lane: "Pipeline",
      job: "run_all / signals",
      status: data.serviceHealth.pipeline.label || humanizeOpsStatus(data.serviceHealth.pipeline.status),
      tone: toneForOpsStatus(data.serviceHealth.pipeline.status),
      cadence: "15분 cron",
      observedAt: formatObservedTime(data.serviceHealth.pipeline.updatedAt),
      source: data.serviceHealth.pipeline.source || "service_health",
      detail: clipText(
        `${data.serviceHealth.pipeline.summary} · ${data.serviceHealth.pipeline.detail}`,
        140,
      ),
    },
    {
      key: "pipeline-brief",
      lane: "Pipeline",
      job: "brief generation",
      status: briefStatus,
      tone: briefTone,
      cadence: "8시간",
      observedAt: formatObservedTime(summary?.brief.latestGeneratedAt),
      source: summary ? "brief_cost_ledger / daily_brief" : "관측 데이터 없음",
      detail: summary
        ? clipText(
            `generated ${summary.brief.generated.count} · cached ${summary.brief.cached.count} · LLM ${summary.brief.llmCallCount}회`,
            140,
          )
        : "brief observability payload가 아직 없습니다.",
    },
    {
      key: "listener-telethon",
      lane: "Listener",
      job: "telethon listener",
      status: data.serviceHealth.listener.label || humanizeOpsStatus(data.serviceHealth.listener.status),
      tone: toneForOpsStatus(data.serviceHealth.listener.status),
      cadence: "실시간",
      observedAt: formatObservedTime(data.listenerHealth.updatedAt || data.serviceHealth.listener.updatedAt),
      source: data.serviceHealth.listener.source || "tg_whale_events",
      detail: clipText(
        data.listenerHealth.message || data.serviceHealth.listener.detail || "최근 listener 메시지가 없습니다.",
        140,
      ),
    },
    {
      key: "bot-telegram",
      lane: "Bot",
      job: "telegram bot / channel",
      status: botStatus,
      tone: botTone,
      cadence: "이벤트 기반 + 일일 점검",
      observedAt: formatObservedTime(
        summary?.telegram.lastBroadcastAt ||
          summary?.telegram.lastChannelHealthAt ||
          data.serviceHealth.bot.updatedAt,
      ),
      source: data.serviceHealth.bot.source || "subscribers / channel_health / broadcast_log",
      detail: summary
        ? clipText(
            `활성 ${formatCount(summary.telegram.subscriberCountActive, "명")} · 일시중지 ${formatCount(summary.telegram.subscriberCountPaused, "명")} · 채널 ${summary.telegram.channelMemberCountLatest == null ? "기록 없음" : `${formatCompactCount(summary.telegram.channelMemberCountLatest)}명`}`,
            140,
          )
        : clipText(data.serviceHealth.bot.detail, 140),
    },
    {
      key: "bot-periodic",
      lane: "Bot",
      job: "broadcast_periodic",
      status: periodicStatus,
      tone: periodicTone,
      cadence: "15분",
      observedAt: formatObservedTime(summary?.periodic.latestPeriodicSendAt),
      source: summary ? "broadcast_log" : "관측 데이터 없음",
      detail: summary
        ? clipText(
            `실행 ${formatCount(summary.periodic.totalExecutions, "회")} · empty ${formatRatio(summary.periodic.skippedEmpty.ratio)} · duplicate ${formatRatio(summary.periodic.skippedDuplicateContent.ratio)}`,
            140,
          )
        : "periodic observability payload가 아직 없습니다.",
    },
    {
      key: "dashboard-live-updates",
      lane: "Dashboard",
      job: "live updates / SSE",
      status: liveUpdatesStatus,
      tone: liveUpdatesTone,
      cadence: summary
        ? `poll ${formatDurationSeconds(summary.liveUpdates.pollIntervalMs)} · heartbeat ${formatDurationSeconds(summary.liveUpdates.heartbeatIntervalMs)}`
        : "브라우저 진입 시",
      observedAt: formatObservedTime(
        summary?.liveUpdates.latestActivityAt || data.serviceHealth.dashboard.updatedAt,
      ),
      source: summary?.liveUpdates.enabled ? "upstash redis / event-stream" : data.serviceHealth.dashboard.source || "dashboard config",
      detail: summary
        ? clipText(
            `event ${summary.liveUpdates.lastEventId ?? "기록 없음"} · reconnect ${summary.liveUpdates.reconnectCount}회${liveUpdateSections ? ` · ${liveUpdateSections}` : ""}`,
            140,
          )
        : clipText(data.serviceHealth.dashboard.detail, 140),
    },
    {
      key: "data-source-sheets",
      lane: "Data source",
      job: "google sheets / source health",
      status: data.serviceHealth.data_source.label || humanizeOpsStatus(data.serviceHealth.data_source.status),
      tone: toneForOpsStatus(data.serviceHealth.data_source.status),
      cadence: "파이프라인 연동",
      observedAt: formatObservedTime(data.sourceHealth.lastUpdatedAt || data.serviceHealth.data_source.updatedAt),
      source: data.sourceHealth.source || data.serviceHealth.data_source.source || "google_sheets",
      detail: clipText(
        `${data.sourceHealth.label}${data.sourceHealth.failureKind ? ` · ${humanizeSourceFailureKind(data.sourceHealth.failureKind)}` : ""} · ${data.sourceHealth.description}`,
        140,
      ),
    },
  ];
}

function buildWorkerSection(data: NormalizedDashboard, rawData: DashboardData | null): AdminWorkerSection {
  return {
    services: buildServiceCards(data),
    jobRows: buildWorkerJobRows(data, rawData),
    insights: buildWorkerInsights(rawData?.adminObservability ?? null),
    failureRows: buildFailureRows(data),
    runtimeChecklist: buildRuntimeChecklist(data),
    configChecklist: buildConfigChecklist(data),
  };
}

function renderTone(status: string | undefined): AdminTone {
  const value = (status || "").toLowerCase();
  if (/(live|running|healthy|ready|success|succeeded|ok|active)/.test(value)) {
    return "good";
  }
  if (/(deploy|starting|pending|building|queued|warm)/.test(value)) {
    return "warn";
  }
  if (/(fail|error|suspend|down|unavailable|crash|stopped)/.test(value)) {
    return "bad";
  }
  return "neutral";
}

function humanizeRenderServiceType(kind: AdminRenderObservability["services"][number]["type"]): string {
  switch (kind) {
    case "cron":
      return "cron";
    case "worker":
      return "worker";
    case "web":
      return "web";
    case "private":
      return "private";
    default:
      return "service";
  }
}

function humanizeRenderServiceStatus(status: AdminRenderObservability["services"][number]["status"]): {
  label: string;
  tone: AdminTone;
  detail: string;
} {
  switch (status.kind) {
    case "live":
      return {
        label: "live",
        tone: "good",
        detail: "서비스가 현재 정상 실행 상태입니다.",
      };
    case "deploying":
      return {
        label: "deploying",
        tone: "warn",
        detail: `배포 ${status.deployId}가 ${formatObservedTime(status.startedAt)}에 시작되었습니다.`,
      };
    case "failed":
      return {
        label: "failed",
        tone: "bad",
        detail: `최근 배포 ${status.deployId}가 실패했습니다. 상세 원인은 Render 대시보드 또는 최근 로그에서 확인해야 합니다.`,
      };
    case "suspended":
      return {
        label: "suspended",
        tone: "bad",
        detail:
          status.suspenders.length > 0
            ? `서비스가 일시중지 상태입니다. 복구 전까지 새 실행이 발생하지 않습니다.`
            : "서비스가 일시중지 상태입니다.",
      };
    default:
      return {
        label: "unknown",
        tone: "neutral",
        detail: "서비스 상태를 아직 판별하지 못했습니다.",
      };
  }
}

function humanizeRenderDeployStatus(status: AdminRenderObservability["deploys"][number]["status"]): AdminTone {
  switch (status) {
    case "live":
      return "good";
    case "deploying":
      return "warn";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

function humanizeRenderInstanceState(state: AdminRenderObservability["instances"][number]["state"]): AdminTone {
  switch (state) {
    case "running":
    case "succeeded":
      return "good";
    case "starting":
      return "warn";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

function summarizeRenderApiError(error: RenderApiError | undefined): string {
  if (!error) {
    return "Render API 응답을 아직 받지 못했습니다.";
  }

  switch (error.code) {
    case "config_missing":
      return "Render 운영 연동 환경변수가 아직 모두 연결되지 않았습니다.";
    case "auth_failed":
      return "Render API 인증에 실패했습니다.";
    case "forbidden":
      return "Render API 권한이 부족합니다.";
    case "not_found":
      return "Render 서비스 또는 로그 리소스를 찾지 못했습니다.";
    case "bad_request":
      return "Render API 요청 구성이 올바르지 않습니다.";
    case "rate_limited":
      return "Render API 호출 한도에 도달했습니다.";
    case "upstream":
      return "Render API가 비정상 응답을 반환했습니다.";
    case "network":
      return "Render API 네트워크 연결이 불안정합니다.";
    case "timeout":
      return "Render API 응답 시간이 초과되었습니다.";
    case "internal":
      return "Render 연동 처리 중 내부 오류가 발생했습니다.";
    default:
      return "Render API 상태를 확인할 수 없습니다.";
  }
}

function summarizeRenderEndpointError(
  item: AdminRenderObservability["errors"][number],
  serviceName?: string,
): string {
  const target = serviceName || item.serviceKey || item.serviceId || "render";
  return `${target} ${item.endpoint} · ${summarizeRenderApiError(item.error)}`;
}

function clipLogMessage(message: string): string {
  return clipText(message, 220);
}

function buildRenderSectionFromObservability(render: AdminRenderObservability): AdminRenderSection {
  const serviceNameById = new Map<string, string>();
  const services = render.services.map((service, index) => {
    serviceNameById.set(service.id, service.name);
    const status = humanizeRenderServiceStatus(service.status);
    const meta = [
      service.id ? `id ${service.id}` : "",
      service.lastDeployAt ? `최근 deploy ${formatObservedTime(service.lastDeployAt)}` : "",
      service.lastDeployStatus ? `deploy 상태 ${service.lastDeployStatus}` : "",
      service.schedule ? `schedule ${service.schedule}` : "",
      service.updatedAt ? `업데이트 ${formatObservedTime(service.updatedAt)}` : "",
    ].filter(Boolean);

    return {
      key: service.id || `${service.name}-${index}`,
      name: service.name,
      kind: humanizeRenderServiceType(service.type),
      status: status.label,
      tone: status.tone,
      detail: status.detail,
      meta,
    };
  });

  const deploys = render.deploys.map((deploy, index) => {
    const serviceName =
      serviceNameById.get(deploy.serviceId) ||
      deploy.serviceKey ||
      `service-${index + 1}`;
    const detail = [
      `deploy ${deploy.deployId}`,
      `생성 ${formatObservedTime(deploy.createdAt)}`,
      deploy.startedAt ? `시작 ${formatObservedTime(deploy.startedAt)}` : "",
      deploy.finishedAt ? `종료 ${formatObservedTime(deploy.finishedAt)}` : "",
      deploy.durationMs != null ? `소요 ${formatLatencyMs(deploy.durationMs)}` : "",
      deploy.trigger ? `trigger ${deploy.trigger}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      key: `${deploy.serviceId}-${deploy.deployId}-${index}`,
      service: serviceName,
      status: deploy.status,
      tone: humanizeRenderDeployStatus(deploy.status),
      detail,
    };
  });

  const instances = render.instances.map((instance, index) => {
    const serviceName =
      serviceNameById.get(instance.serviceId) ||
      instance.serviceKey ||
      `service-${index + 1}`;
    const detail = [
      `instance ${instance.instanceId}`,
      instance.startedAt ? `시작 ${formatObservedTime(instance.startedAt)}` : "",
      instance.finishedAt ? `종료 ${formatObservedTime(instance.finishedAt)}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "추가 상세 없음";

    return {
      key: `${instance.serviceId}-${instance.instanceId}-${index}`,
      service: serviceName,
      status: instance.state,
      tone: humanizeRenderInstanceState(instance.state),
      detail,
    };
  });

  const logRows = render.logs.map((log, index) => ({
    id: `${log.serviceId}-${index}`,
    timestamp: log.timestamp,
    status: log.level,
    title: log.serviceName,
    message: clipLogMessage(
      [
        log.type ? `[${log.type}]` : "",
        log.instanceId ? `instance ${log.instanceId}` : "",
        log.message,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  }));

  const endpointFailures = render.errors
    .slice(0, 3)
    .map((item) =>
      summarizeRenderEndpointError(
        item,
        item.serviceId ? serviceNameById.get(item.serviceId) : undefined,
      ),
    );
  const hasData = services.length > 0 || deploys.length > 0 || instances.length > 0 || logRows.length > 0;
  const availability: AdminRenderSection["availability"] =
    render.state === "error"
      ? hasData
        ? "available"
        : "error"
      : render.state === "disabled"
        ? hasData
          ? "available"
          : "missing"
        : hasData
          ? "available"
          : render.state === "degraded"
            ? "error"
            : "missing";

  const message =
    availability === "available"
      ? render.state === "degraded" || render.errors.length > 0
        ? "Render 플랫폼 데이터가 부분 연결 상태입니다."
        : "Render 플랫폼 데이터가 연결되었습니다."
      : render.state === "disabled"
        ? render.configured
          ? "Render 운영 연동이 비활성화되어 있습니다."
          : "Render 운영 연동 설정이 아직 연결되지 않았습니다."
        : summarizeRenderApiError(render.error || render.errors[0]?.error);

  const noteParts = [
    render.fetchedAt ? `마지막 수집 ${formatObservedTime(render.fetchedAt)}` : "",
    render.lastLogAt ? `최근 로그 ${formatObservedTime(render.lastLogAt)}` : "",
    `로그 창 ${render.logWindowMinutes}분`,
    endpointFailures.length > 0 ? `최근 오류 ${endpointFailures.join(" / ")}` : "",
  ].filter(Boolean);

  return {
    availability,
    message,
    note: noteParts.join(" · ") || "Render 서비스·배포·인스턴스·로그를 운영자용 요약 형태로 표시합니다.",
    services,
    deploys,
    instances,
    logRows,
    placeholders: [
      {
        key: "render-services",
        title: "C1. 서비스 상태",
        body: "whalescope-pipeline / listener / bot의 live, deploying, suspended, failed 상태를 표시합니다.",
      },
      {
        key: "render-deploys",
        title: "C2. 최근 배포",
        body: "서비스별 최근 deploy id, 상태, 시각, trigger를 표시합니다.",
      },
      {
        key: "render-instances",
        title: "C3. 인스턴스 상태",
        body: "worker / cron 인스턴스의 running, starting, succeeded 상태와 기동 시각을 표시합니다.",
      },
      {
        key: "render-logs",
        title: "C4. 최근 Render 로그",
        body: "최근 15분 Render raw 로그를 서비스별로 필터링해서 표시합니다.",
      },
    ],
  };
}

function buildRenderService(value: unknown, index: number): RenderServiceSnapshot | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const name =
    toText(record.name) ||
    toText(record.service) ||
    toText(record.serviceName) ||
    toText(record.id) ||
    `service-${index + 1}`;
  const kind = toText(record.kind) || toText(record.type) || "service";
  const status = toText(record.status) || toText(record.state) || "unknown";
  const detail =
    toText(record.detail) ||
    toText(record.summary) ||
    toText(record.message) ||
    "추가 서비스 상세 정보가 없습니다.";
  const meta = [
    toText(record.id) ? `id ${toText(record.id)}` : "",
    toText(record.lastDeployAt) ? `마지막 deploy ${formatObservedTime(toText(record.lastDeployAt))}` : "",
    toText(record.schedule) ? `schedule ${toText(record.schedule)}` : "",
    toNumber(record.instanceCount) != null ? `instances ${toNumber(record.instanceCount)}` : "",
  ].filter(Boolean);

  return {
    key: `${name}-${index}`,
    name,
    kind,
    status,
    tone: renderTone(status),
    detail,
    meta,
  };
}

function buildRenderListItem(
  value: unknown,
  index: number,
  fallbackLabel: string,
): RenderListItem | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const service =
    toText(record.service) ||
    toText(record.serviceName) ||
    toText(record.name) ||
    fallbackLabel;
  const status = toText(record.status) || toText(record.state) || "unknown";
  const detailParts = [
    toText(record.id) ? `id ${toText(record.id)}` : "",
    toText(record.createdAt) ? formatObservedTime(toText(record.createdAt)) : "",
    toText(record.startedAt) ? `started ${formatObservedTime(toText(record.startedAt))}` : "",
    toText(record.finishedAt) ? `finished ${formatObservedTime(toText(record.finishedAt))}` : "",
    toText(record.trigger) || toText(record.message) || toText(record.detail) || "",
  ].filter(Boolean);

  return {
    key: `${service}-${index}`,
    service,
    status,
    tone: renderTone(status),
    detail: detailParts.join(" · ") || "추가 상세 없음",
  };
}

function buildRenderLogRows(values: unknown[]): SystemLogRow[] {
  return values.flatMap((value, index) => {
    const record = toRecord(value);
    if (!record) {
      return [];
    }
    const timestamp =
      toText(record.timestamp) ||
      toText(record.ts) ||
      toText(record.createdAt) ||
      toText(record.startedAt);
    const service =
      toText(record.service) ||
      toText(record.serviceName) ||
      toText(record.name) ||
      "Render";
    const level = toText(record.level) || toText(record.status) || "info";
    const message =
      toText(record.message) ||
      toText(record.detail) ||
      toText(record.summary) ||
      "로그 메시지가 비어 있습니다.";

    return [
      {
        id: `${service}-${index}`,
        timestamp: timestamp || new Date().toISOString(),
        status: level,
        title: service,
        message,
      },
    ];
  });
}

function buildRenderSection(rawData: DashboardData | null): AdminRenderSection {
  const root = toRecord(rawData);
  const renderSummary = rawData?.adminObservability?.render ?? null;
  const renderRoot =
    toRecord(root?.renderPlatform) ||
    toRecord(root?.render) ||
    toRecord(root?.adminRender) ||
    toRecord(root?.platform);

  const placeholders = [
    {
      key: "render-services",
      title: "C1. 서비스 상태",
      body: "whalescope-pipeline / listener / bot의 live, deploying, suspended, failed 상태를 표시합니다.",
    },
    {
      key: "render-deploys",
      title: "C2. 최근 배포",
      body: "서비스별 최근 deploy id, 상태, 시각, trigger를 표시합니다.",
    },
    {
      key: "render-instances",
      title: "C3. 인스턴스 상태",
      body: "worker / cron 인스턴스의 running, starting, succeeded 상태와 기동 시각을 표시합니다.",
    },
    {
      key: "render-logs",
      title: "C4. 최근 Render 로그",
      body: "최근 15분 Render raw 로그를 서비스별로 필터링해서 표시합니다.",
    },
  ];

  if (renderSummary) {
    const section = buildRenderSectionFromObservability(renderSummary);
    if (section.availability !== "missing" || !renderRoot) {
      return section;
    }
  }

  if (!renderRoot) {
    return {
      availability: "missing",
      message: "Render 통합 데이터가 아직 연결되지 않았습니다.",
      note: "현재 브랜치의 shared dashboard payload에는 Render 전용 필드가 없습니다. 이 섹션만 placeholder/fallback 상태로 유지하고 나머지 섹션은 정상 렌더합니다.",
      services: [],
      deploys: [],
      instances: [],
      logRows: [],
      placeholders,
    };
  }

  const services = (Array.isArray(renderRoot.services) ? renderRoot.services : [])
    .map(buildRenderService)
    .filter((item): item is RenderServiceSnapshot => Boolean(item));
  const deploys = (Array.isArray(renderRoot.deploys) ? renderRoot.deploys : Array.isArray(renderRoot.deployments) ? renderRoot.deployments : [])
    .map((value, index) => buildRenderListItem(value, index, "deploy"))
    .filter((item): item is RenderListItem => Boolean(item));
  const instances = (Array.isArray(renderRoot.instances) ? renderRoot.instances : [])
    .map((value, index) => buildRenderListItem(value, index, "instance"))
    .filter((item): item is RenderListItem => Boolean(item));
  const logs = buildRenderLogRows(
    Array.isArray(renderRoot.logs)
      ? renderRoot.logs
      : Array.isArray(renderRoot.logRows)
        ? renderRoot.logRows
        : [],
  );

  const status = toText(renderRoot.status);
  const errorMessage =
    toText(renderRoot.message) ||
    toText(renderRoot.error) ||
    toText(toRecord(renderRoot.error)?.message);
  const availability: AdminRenderSection["availability"] =
    status === "error" || status === "failed"
      ? "error"
      : services.length || deploys.length || instances.length || logs.length
        ? "available"
        : "missing";

  return {
    availability,
    message:
      availability === "available"
        ? "Render 플랫폼 데이터가 연결되었습니다."
        : errorMessage || "Render 데이터 구조는 존재하지만 아직 채워진 항목이 없습니다.",
    note:
      availability === "error"
        ? "Render API 에러가 있더라도 Section A/B/D는 계속 렌더되도록 분리했습니다."
        : "추후 다른 트랙이 Render payload를 추가하면 이 섹션이 별도 수정 없이 실제 서비스/배포/인스턴스/로그를 표시합니다.",
    services,
    deploys,
    instances,
    logRows: logs,
    dashboardUrl:
      toText(renderRoot.dashboardUrl) ||
      toText(renderRoot.url) ||
      toText(renderRoot.dashboard),
    placeholders,
  };
}

function buildCorrelationSection(args: {
  data: NormalizedDashboard;
  rawData: DashboardData | null;
  workerSection: AdminWorkerSection;
  renderSection: AdminRenderSection;
}): AdminCorrelationSection {
  const { data, rawData, workerSection, renderSection } = args;
  const findings: AdminCorrelationSection["findings"] = [];
  const pipeline = data.serviceHealth.pipeline;
  const source = data.sourceHealth;
  const staleMinutes = source.staleMinutes ?? minutesSince(source.lastUpdatedAt);
  const firstFailure = workerSection.failureRows[0];
  const configItem = data.operatorChecks.find((item) => item.status !== "ok");
  const renderServiceIssue = renderSection.services.find((service) => service.tone !== "good");

  if (renderSection.availability === "available" && renderServiceIssue) {
    findings.push({
      key: "platform-issue",
      title: "플랫폼 상태가 애플리케이션 진단보다 앞서 있습니다.",
      tone: renderServiceIssue.tone,
      detail: `${renderServiceIssue.name}가 ${renderServiceIssue.status} 상태입니다. 데이터 지연은 애플리케이션 로직보다 배포/인스턴스 상태의 영향을 먼저 확인해야 합니다.`,
      action: { label: "Render 상태 보기", href: "#render-platform" },
    });
  }

  if ((pipeline.status === "healthy" || pipeline.status === "degraded") && staleMinutes != null && staleMinutes > 30) {
    findings.push({
      key: "data-stale",
      title:
        renderSection.availability === "available"
          ? "플랫폼은 보이지만 데이터 계층이 stale 합니다."
          : "데이터가 stale 하지만 플랫폼 원인은 아직 미확인입니다.",
      tone: "warn",
      detail:
        renderSection.availability === "available"
          ? `sourceHealth는 ${staleMinutes.toLocaleString("ko-KR")}분 stale 입니다. 플랫폼이 살아 있다면 source API 실패, guard skip, 로직 오류를 우선 확인해야 합니다.`
          : `sourceHealth는 ${staleMinutes.toLocaleString("ko-KR")}분 stale 입니다. Render 섹션이 비어 있어 플랫폼 요인은 아직 검증할 수 없습니다.`,
      action: {
        label: renderSection.availability === "available" ? "최근 로그 확인" : "Render placeholder 확인",
        href: renderSection.availability === "available" ? "#system-log" : "#render-platform",
      },
    });
  }

  if (configItem) {
    findings.push({
      key: "config-gap",
      title: "설정 또는 연결 누락이 감지됐습니다.",
      tone: configItem.status === "missing" ? "bad" : "warn",
      detail: `${configItem.label}: ${configItem.detail}`,
      action: { label: "환경 체크 보기", href: "#worker-health" },
    });
  }

  if (firstFailure) {
    findings.push({
      key: "recent-failure",
      title: "최근 실패·경고 이벤트가 존재합니다.",
      tone: /fail|error/i.test(firstFailure.status) ? "bad" : "warn",
      detail: `${firstFailure.title} · ${firstFailure.message}`,
      action: { label: "실패 로그 보기", href: "#system-log" },
    });
  }

  if (!findings.length) {
    findings.push({
      key: "all-clear",
      title: "현재 교차 이상 없음",
      tone: renderSection.availability === "available" ? "good" : "neutral",
      detail:
        renderSection.availability === "available"
          ? "노출된 데이터 기준으로는 플랫폼, 애플리케이션, 데이터 계층 사이의 즉시 경보가 보이지 않습니다."
          : "애플리케이션 계층은 안정적으로 보이지만 Render 계층은 아직 연결되지 않아 완전한 교차 판정은 제한됩니다.",
    });
  }

  const summary =
    findings[0]?.tone === "good"
      ? `${data.opsSummary.headline} ${data.opsSummary.detail}`
      : findings[0].detail;

  const notes = [
    `데이터 기준 시각: ${formatObservedTime(rawData?.generatedAt ?? data.generatedAt)}`,
    `sourceHealth: ${source.label}${source.failureKind ? ` · ${humanizeSourceFailureKind(source.failureKind)}` : ""}`,
    `pipeline: ${humanizeOpsStatus(pipeline.status)} · 최근 상태 ${formatObservedTime(pipeline.updatedAt)}`,
    renderSection.availability === "available"
      ? `Render 계층: 서비스 ${renderSection.services.length}개 · deploy ${renderSection.deploys.length}건 · 로그 ${renderSection.logRows.length}건`
      : "Render 계층: 아직 payload에 연결되지 않아 placeholder로 유지됩니다.",
  ];

  return {
    title: findings[0].title,
    tone: findings[0].tone,
    summary,
    findings,
    notes,
  };
}

export default async function AdminPage() {
  const language = await getCurrentDashboardLanguage();
  const cookieStore = await cookies();
  const auth = getDashboardAuthResult({
    sessionCookie: cookieStore.get(DASHBOARD_SESSION_COOKIE_NAME)?.value ?? undefined,
  });

  if (auth.productionLocked) {
    return (
      <>
        <TopNavbar initialLanguage={language} />

        <main className={styles.main}>
          <section className={styles.colSpan12}>
            <AdminSessionPanel mode="locked" />
          </section>
        </main>
      </>
    );
  }

  if (!auth.authorized && auth.passwordConfigured) {
    return (
      <>
        <TopNavbar initialLanguage={language} />

        <main className={styles.main}>
          <section className={styles.colSpan12}>
            <AdminSessionPanel mode="login" />
          </section>
        </main>
      </>
    );
  }

  const rawData = await loadDashboardData();
  const data = normalizeDashboardData(rawData);
  const renderSection = buildRenderSection(rawData);
  const hero = buildHero(data, rawData, renderSection);
  const dataSection = buildDataSection(data, rawData);
  const workerSection = buildWorkerSection(data, rawData);
  const correlationSection = buildCorrelationSection({
    data,
    rawData,
    workerSection,
    renderSection,
  });

  return (
    <>
      <TopNavbar initialLanguage={language} />

      <main className={styles.main}>
        {auth.passwordConfigured ? (
          <section className={styles.colSpan12}>
            <AdminSessionPanel
              mode="session"
              message="브라우저 쿠키 세션으로 admin API 요청이 자동 인증됩니다."
            />
          </section>
        ) : null}

        <AdminOperationsOverview
          hero={hero}
          dataSection={dataSection}
          workerSection={workerSection}
          renderSection={renderSection}
          correlationSection={correlationSection}
        />
      </main>
    </>
  );
}
