import type { ComponentProps } from "react";
import type { Metadata } from "next";
import { FearGreedGauge } from "@/components/fear-greed-gauge";
import { CuratedWatchlistPanel } from "@/components/curated-watchlist-panel";
import { LiveUpdatesController } from "@/components/live-updates-controller";
import { TopNavbar } from "@/components/top-navbar";
import { InsightsSidebar } from "@/components/insights-sidebar";
import { MarketTickerStrip } from "@/components/market-ticker-strip";
import { NewsWidget } from "@/components/news-widget";
import { SignalSection } from "@/components/signal-section";
import { TelegramConnectModal } from "@/components/telegram-connect-modal";
import { WhaleStoryPanel } from "@/components/whale-story-panel";
import { cleanGeneratedBrief, truncateBriefHeadline } from "@/lib/format";
import { humanizeSourceFailureKind } from "@/lib/humanize";
import { formatDashboardMessage } from "@/lib/i18n/get-dictionary";
import { getCurrentDashboardDictionary, getCurrentDashboardLanguage } from "@/lib/i18n/server";
import { getDashboardData, type DashboardData } from "@/lib/metrics";
import { getTelegramPublicConfig } from "@/lib/public-app-config";
import { getFearGreedData } from "@/lib/fear-greed";
import styles from "./insights/insights.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WhaleScope | User Home",
  description: "Human-readable whale movement briefs, curated wallets, and live market context for users.",
};

type InsightState = {
  data: DashboardData | null;
  sourceConnected: boolean;
};

type SignalTone = "critical" | "watch" | "positive" | "neutral";

type BriefAnalysisItem = {
  label: string;
  value: string;
  description: string;
  tone: SignalTone;
};

type DashboardDictionary = Awaited<ReturnType<typeof getCurrentDashboardDictionary>>;
type HomeSignal = ComponentProps<typeof SignalSection>["signals"][number];
type FearGreedCopy = ComponentProps<typeof FearGreedGauge>["copy"];
const BRIEF_SCHEDULE_HOURS_KST = [0, 8, 16] as const;
const WATCHLIST_COLLAPSED_COUNT = 6;

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "$0";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getSignalTone(severity: string, score: number): SignalTone {
  const normalized = severity.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("high") || score >= 80) {
    return "critical";
  }
  if (normalized.includes("medium") || normalized.includes("watch") || score >= 50) {
    return "watch";
  }
  if (normalized.includes("positive") || normalized.includes("accum")) {
    return "positive";
  }
  return "neutral";
}

function buildBriefAnalysis(
  data: DashboardData | null,
  brief: ReturnType<typeof buildBriefCopy>,
  mood: ReturnType<typeof buildMarketMood>,
  dictionary: DashboardDictionary,
): BriefAnalysisItem[] {
  const latestBrief = data?.latestBrief;
  const signalThemes = latestBrief?.signalThemes ?? [];
  const highlights = latestBrief?.highlights ?? [];
  const totalVolumeUsd = latestBrief?.totalVolumeUsd ?? 0;
  const signalCount = data?.metrics.signalCount ?? 0;
  const transactionCount = data?.metrics.transactionCount ?? 0;

  return [
    {
      label: dictionary.home.briefAnalysisCore,
      value: brief.summary,
      description: mood.copy,
      tone: mood.tone,
    },
    {
      label: dictionary.home.briefAnalysisPoints,
      value:
        highlights.slice(0, 2).join(" · ") ||
        signalThemes.slice(0, 2).join(" · ") ||
        dictionary.home.briefAnalysisPointsFallback,
      description:
        signalThemes.length > 0
          ? formatDashboardMessage(dictionary.home.briefAnalysisPointsDescActive, {
              count: signalThemes.length,
            })
          : dictionary.home.briefAnalysisPointsDesc,
      tone: signalCount > 0 ? "positive" : "neutral",
    },
    {
      label: dictionary.home.briefAnalysisScale,
      value: formatDashboardMessage(dictionary.home.briefAnalysisScaleValue, {
        volume: formatCurrency(totalVolumeUsd),
        count: formatCompactNumber(transactionCount),
      }),
      description:
        latestBrief?.alertCount && latestBrief.alertCount > 0
          ? formatDashboardMessage(dictionary.home.briefAnalysisScaleWithAlerts, {
              count: latestBrief.alertCount,
            })
          : formatDashboardMessage(dictionary.home.briefAnalysisScaleNoAlerts, {
              count: formatCompactNumber(signalCount),
            }),
      tone: transactionCount > 0 ? "watch" : "neutral",
    },
  ];
}

function buildBriefCopy(data: DashboardData | null, dictionary: DashboardDictionary): {
  title: string;
  summary: string;
  highlights: string[];
  note: string;
  isFallback: boolean;
} {
  const brief = data?.latestBrief;
  if (brief) {
    return {
      title: dictionary.home.briefTitle,
      summary: brief.summary
        ? cleanGeneratedBrief(brief.summary)
        : dictionary.home.briefNoSummary,
      highlights:
        (brief.highlights?.length ?? 0) > 0
          ? brief.highlights
          : [
              formatDashboardMessage(dictionary.home.briefFallbackSignals, {
                count: formatCompactNumber(data?.metrics.signalCount ?? 0),
              }),
              formatDashboardMessage(dictionary.home.briefFallbackTransactions, {
                count: formatCompactNumber(data?.metrics.transactionCount ?? 0),
              }),
            ],
      note:
        brief.alertCount > 0
          ? formatDashboardMessage(dictionary.home.briefNoteWithAlerts, { count: brief.alertCount })
          : dictionary.home.briefNoteNoAlerts,
      isFallback: safeText(brief.noteRaw, "").includes("fallback_tx_based"),
    };
  }

  return {
    title: dictionary.home.briefTitle,
    summary: dictionary.home.briefWaitingSummary,
    highlights: [dictionary.home.briefWaitingHighlightRun, dictionary.home.briefWaitingHighlightData],
    note: dictionary.home.briefAnalysisPointsDesc,
    isFallback: false,
  };
}

function humanizeMoodDriver(
  label: string,
  value: string,
  language: "ko" | "en",
): string {
  switch (label) {
    case "exchange_inflow":
      return language === "ko" ? `거래소 유입 중심 ${value}` : `Exchange inflow · ${value}`;
    case "exchange_outflow":
      return language === "ko" ? `거래소 유출 중심 ${value}` : `Exchange outflow · ${value}`;
    case "exchange_inflow_signals":
      return language === "ko" ? `거래소 유입 신호 ${value}건` : `${value} exchange inflow signals`;
    case "exchange_outflow_signals":
      return language === "ko" ? `거래소 유출 신호 ${value}건` : `${value} exchange outflow signals`;
    case "critical_signals":
      return language === "ko" ? `강한 신호 ${value}건` : `${value} critical signals`;
    case "watch_signals":
      return language === "ko" ? `관찰 신호 ${value}건` : `${value} watch signals`;
    case "transaction_count":
      return language === "ko" ? `최근 거래 ${value}건` : `${value} recent transactions`;
    case "priced_volume_usd":
      return language === "ko" ? `USD 환산 규모 ${value}` : `USD volume ${value}`;
    case "top_asset":
      return language === "ko" ? `대표 자산 ${value}` : `Top asset ${value}`;
    default:
      return `${label}: ${value}`;
  }
}

function buildMarketMood(
  data: DashboardData | null,
  dictionary: DashboardDictionary,
  language: "ko" | "en",
): {
  label: string;
  copy: string;
  detail: string;
  tone: SignalTone;
  drivers: string[];
} {
  const structuredMood = data?.latestBrief?.marketMood;
  if (structuredMood) {
    const drivers = structuredMood.drivers.map((driver) =>
      humanizeMoodDriver(driver.label, driver.value, language),
    );

    if (structuredMood.mood === "risk_off") {
      return {
        label: dictionary.home.marketMoodCautionLabel,
        copy: dictionary.home.briefAnalysisMoodCaution,
        detail: drivers[0] ?? dictionary.home.marketMoodCautionDetail.replace("{critical}", "0").replace("{watch}", "0"),
        tone: "critical",
        drivers,
      };
    }

    if (structuredMood.mood === "risk_on") {
      return {
        label: language === "ko" ? "위험 선호" : "Risk-on",
        copy:
          language === "ko"
            ? "거래소 유출 또는 축적 흐름이 우세해 매수 심리가 상대적으로 강합니다."
            : "Outflow and accumulation signals outweigh inflow pressure, suggesting stronger risk appetite.",
        detail: drivers[0] ?? dictionary.home.marketMoodStableDetail,
        tone: "positive",
        drivers,
      };
    }

    if (structuredMood.mood === "watch") {
      return {
        label: dictionary.home.marketMoodWatchLabel,
        copy: dictionary.home.briefAnalysisMoodWatch,
        detail: drivers[0] ?? dictionary.home.marketMoodWatchDetail.replace("{watch}", "0"),
        tone: "watch",
        drivers,
      };
    }

    return {
      label: dictionary.home.marketMoodStableLabel,
      copy: dictionary.home.briefAnalysisMoodStable,
      detail: drivers[0] ?? dictionary.home.marketMoodStableDetail,
      tone: "neutral",
      drivers,
    };
  }

  const recentSignals = data?.recentSignals ?? [];
  const criticalCount = recentSignals.filter((item) => {
    const tone = getSignalTone(safeText(item.severity, ""), safeNumber(item.score));
    return tone === "critical";
  }).length;
  const watchCount = recentSignals.filter((item) => {
    const tone = getSignalTone(safeText(item.severity, ""), safeNumber(item.score));
    return tone === "watch";
  }).length;

  if (!data) {
    return {
      label: dictionary.home.marketMoodWaitingLabel,
      copy: dictionary.home.briefAnalysisMoodWaiting,
      detail: dictionary.home.marketMoodWaitingDetail,
      tone: "neutral",
      drivers: [],
    };
  }

  if (criticalCount > 0) {
    return {
      label: dictionary.home.marketMoodCautionLabel,
      copy: dictionary.home.briefAnalysisMoodCaution,
      detail: formatDashboardMessage(dictionary.home.marketMoodCautionDetail, {
        critical: criticalCount,
        watch: watchCount,
      }),
      tone: "critical",
      drivers: [],
    };
  }

  if (watchCount > 0) {
    return {
      label: dictionary.home.marketMoodWatchLabel,
      copy: dictionary.home.briefAnalysisMoodWatch,
      detail: formatDashboardMessage(dictionary.home.marketMoodWatchDetail, {
        watch: watchCount,
      }),
      tone: "watch",
      drivers: [],
    };
  }

  return {
    label: dictionary.home.marketMoodStableLabel,
    copy: dictionary.home.briefAnalysisMoodStable,
    detail: dictionary.home.marketMoodStableDetail,
    tone: "neutral",
    drivers: [],
  };
}

function formatKstDateTime(value?: string): string {
  const text = safeText(value, "");
  if (!text) {
    return "";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function formatKstTime(value: string | undefined, fallback: string): string {
  const full = formatKstDateTime(value);
  if (!full) {
    return fallback;
  }
  return full.slice(-8, -3);
}

function formatKstDateTimeWithoutSeconds(value?: string): string {
  const full = formatKstDateTime(value);
  if (!full) {
    return "";
  }
  return full.slice(0, 16);
}

function getNextBriefAt(now = new Date()): Date {
  const offsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + offsetMs);
  const year = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth();
  const day = kstNow.getUTCDate();
  const hour = kstNow.getUTCHours();

  const nextHour = BRIEF_SCHEDULE_HOURS_KST.find((candidate) => candidate > hour);
  if (typeof nextHour === "number") {
    return new Date(Date.UTC(year, month, day, nextHour, 0, 0) - offsetMs);
  }

  return new Date(Date.UTC(year, month, day + 1, BRIEF_SCHEDULE_HOURS_KST[0], 0, 0) - offsetMs);
}

function buildNextBriefLabel(language: "ko" | "en", now = new Date()): string {
  const nextBriefAt = formatKstDateTimeWithoutSeconds(getNextBriefAt(now).toISOString());
  return language === "ko"
    ? `다음 브리핑 ${nextBriefAt} KST`
    : `Next brief ${nextBriefAt} KST`;
}

function humanizePipelineStatus(status: string | undefined, dictionary: DashboardDictionary): string {
  const normalized = safeText(status, "").toLowerCase();
  if (!normalized) {
    return dictionary.status.checking;
  }
  if (normalized.includes("completed_with_errors") || normalized.includes("warn")) {
    return dictionary.status.completedWithWarnings;
  }
  if (normalized.includes("completed")) {
    return dictionary.status.completed;
  }
  if (normalized.includes("failed") || normalized.includes("error")) {
    return dictionary.status.failed;
  }
  if (normalized.includes("started") || normalized.includes("running")) {
    return dictionary.status.running;
  }
  return status ?? dictionary.status.checking;
}

function buildPipelineSummary(data: DashboardData | null, dictionary: DashboardDictionary): string {
  if (!data?.latestRun) {
    return dictionary.status.pipelineSummaryPending;
  }

  const statusLabel = humanizePipelineStatus(data.latestRun.status, dictionary);
  const updatedAt = formatKstDateTime(data.latestRun.updatedAt) || dictionary.home.timePending;
  const errorCount = safeNumber(data.latestRun.errorCount);

  if (errorCount > 0) {
    return formatDashboardMessage(dictionary.status.pipelineSummaryWithErrors, {
      status: statusLabel,
      count: errorCount,
      time: updatedAt,
    });
  }

  return formatDashboardMessage(dictionary.status.pipelineSummaryOk, {
    status: statusLabel,
    time: updatedAt,
  });
}

async function loadInsightState(): Promise<InsightState> {
  try {
    const data = await getDashboardData({
      transactionLimit: 6,
      signalLimit: 6,
      systemLogLimit: 4,
      includeAdminExtras: false,
    });

    return {
      data,
      sourceConnected: true,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error("[insights/page]", error.message, error.stack);
    } else {
      console.error("[insights/page]", String(error));
    }
    return {
      data: null,
      sourceConnected: false,
    };
  }
}

export default async function InsightsPage() {
  const [dictionary, language, state, fearGreed] = await Promise.all([
    getCurrentDashboardDictionary(),
    getCurrentDashboardLanguage(),
    loadInsightState(),
    getFearGreedData(),
  ]);
  const data = state.data;
  const brief = buildBriefCopy(data, dictionary);
  const mood = buildMarketMood(data, dictionary, language);
  const briefAnalysis = buildBriefAnalysis(data, brief, mood, dictionary);
  const telegramConfig = getTelegramPublicConfig();
  const watchlist = data?.watchlist ?? [];
  const stories = data?.whaleStories ?? [];
  const recentSignals = ((data?.recentSignals ?? []) as HomeSignal[]).slice(0, 3);
  const connectionMeta = data?.sourceHealth?.failureKind
    ? `${dictionary.home.sourceFailurePrefix}: ${
        language === "ko" ? humanizeSourceFailureKind(data.sourceHealth.failureKind) : data.sourceHealth.failureKind
      }`
    : data?.sourceHealth?.lastUpdatedAt
      ? `${dictionary.home.sourceLastUpdatedPrefix}: ${formatKstDateTime(data.sourceHealth.lastUpdatedAt)}`
      : "";
  const telegramSubscribers = data?.metrics.subscriberCount ?? 0;
  const pipelineSummary = buildPipelineSummary(data, dictionary);
  const briefRefreshLabel = data?.latestBrief?.generatedAt
    ? formatDashboardMessage(dictionary.home.briefRefreshLabel, {
        time: formatKstTime(data.latestBrief.generatedAt, dictionary.home.timePending),
      })
    : data?.latestBrief?.date ?? dictionary.home.briefDateFallback;
  const nextBriefLabel = buildNextBriefLabel(language);
  const hasFearGreedReading = fearGreed.status === "ready" && Boolean(fearGreed.current);
  const fearGreedCopy: FearGreedCopy = {
    title: dictionary.home.fearGreedTitle,
    subtitle: dictionary.home.fearGreedSubtitle,
    classificationLabels: {
      extreme_fear: dictionary.home.fearGreedClassificationExtremeFear,
      fear: dictionary.home.fearGreedClassificationFear,
      neutral: dictionary.home.fearGreedClassificationNeutral,
      greed: dictionary.home.fearGreedClassificationGreed,
      extreme_greed: dictionary.home.fearGreedClassificationExtremeGreed,
    },
    compareLabels: {
      yesterday: dictionary.home.fearGreedCompareYesterday,
      week: dictionary.home.fearGreedCompareWeek,
      month: dictionary.home.fearGreedCompareMonth,
    },
    nextUpdateLabel: dictionary.home.fearGreedNextUpdateLabel,
    nextUpdateValue: dictionary.home.fearGreedNextUpdateValue,
    nextUpdateUnavailable: dictionary.home.fearGreedNextUpdateUnavailable,
    sourceLabel: dictionary.home.fearGreedSourceLabel,
    staleWarning: dictionary.home.fearGreedStaleWarning,
    ariaLabel: dictionary.home.fearGreedAriaLabel,
    disclaimer: dictionary.home.fearGreedDisclaimer,
  };
  const legacyMoodFallback = (
    <div className={styles.moodFallbackStack}>
      <span className={styles.moodFallbackLabel}>{mood.label}</span>
      <h4 className={styles.moodTitle}>{mood.copy}</h4>
      <p className={styles.moodDesc}>{mood.detail}</p>
      {mood.drivers.length > 0 ? (
        <div className={styles.moodDrivers}>
          {mood.drivers.map((driver) => (
            <span key={driver} className={styles.moodDriverChip}>
              {driver}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  const briefAnalysisIcons = ["analytics", "diversity_3", "warning"];

  return (
    <main className={styles.page}>
      <TopNavbar initialLanguage={language} />

      {/* ── Layout Shell: InsightsSidebar + content + news rail ── */}
      <div className={styles.layoutShell}>
        <InsightsSidebar
          ariaLabel={dictionary.sidebar.ariaLabel}
          brandSubtitle={dictionary.sidebar.brandSubtitle}
          labels={{
            "#market-ticker": dictionary.sidebar.marketTicker,
            "#brief": dictionary.sidebar.brief,
            "#signals": dictionary.sidebar.signals,
            "#watchlist": dictionary.sidebar.watchlist,
            "#telegram": dictionary.sidebar.telegram,
          }}
        />

        {/* ── Content ── */}
        <div className={styles.content}>
          {/* ── Page Header ── */}
          <section className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageTitle}>{dictionary.home.title}</h1>
              <p className={styles.pageSubtitle}>{dictionary.home.subtitle}</p>
              <div className={styles.connectionBlock}>
                <div className={styles.connectionRow}>
                  <LiveUpdatesController
                    chipClassName={styles.connectionChip}
                    dotClassName={styles.connectionDot}
                    language={language}
                  />
                </div>
                {connectionMeta ? <p className={styles.connectionMeta}>{connectionMeta}</p> : null}
              </div>
            </div>
          </section>

          <section id="market-ticker" className={styles.tickerSlot}>
            <MarketTickerStrip
              eyebrow={dictionary.home.marketTickerEyebrow}
              title={dictionary.home.marketTickerTitle}
              initialLanguage={language}
            />
          </section>

          {/* ── Bento Grid ── */}
          <div className={styles.bentoGrid}>
            {/* ── 1. Market Mood ── */}
            <div className={styles.moodCard}>
              <div className={styles.moodGaugeCol}>
                <FearGreedGauge
                  copy={fearGreedCopy}
                  data={fearGreed}
                  fallback={legacyMoodFallback}
                  language={language}
                />
              </div>
              {hasFearGreedReading ? (
                <div className={styles.moodSummary}>
                  <p className={styles.moodSummaryEyebrow}>{mood.label}</p>
                  <h4 className={styles.moodTitle}>{mood.copy}</h4>
                  <p className={styles.moodDesc}>{mood.detail}</p>
                  {mood.drivers.length > 0 ? (
                    <div className={styles.moodDrivers}>
                      {mood.drivers.map((driver) => (
                        <span key={driver} className={styles.moodDriverChip}>
                          {driver}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* ── 2. Today's Whale Brief ── */}
            <article className={styles.heroCard} id="brief">
              <div className={styles.heroCardGlow} aria-hidden="true" />
              <div className={styles.heroCardInner}>
                <div className={styles.heroTopline}>
                  <span className={styles.labelPill}>{dictionary.home.briefPill}</span>
                  {brief.isFallback ? (
                    <span className={styles.labelPill}>{dictionary.home.briefFallbackBadge}</span>
                  ) : null}
                  <span className={styles.dateMuted}>{briefRefreshLabel}</span>
                  <span className={styles.dateMuted}>{nextBriefLabel}</span>
                </div>
                <h2 className={styles.heroTitle}>{dictionary.home.briefTitle}</h2>
                <p className={styles.heroSummary}>&ldquo;{truncateBriefHeadline(brief.summary)}&rdquo;</p>

                <div className={styles.analysisItems}>
                  {briefAnalysis.map((item, i) => (
                    <div key={item.label} className={styles.analysisItem}>
                      <div className={styles.analysisIcon}>
                        <span className={styles.materialIcon}>{briefAnalysisIcons[i] ?? "info"}</span>
                      </div>
                      <div>
                        <p className={styles.analysisItemTitle}>{item.label}</p>
                        <p className={styles.analysisItemDesc}>{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.riskBanner}>
                  <p className={styles.riskBannerText}>
                    <strong>{dictionary.home.riskBannerLabel}:</strong> {brief.note}
                  </p>
                </div>
              </div>
            </article>

            {/* ── 3. Key Signals ── */}
            <SignalSection
              initialLanguage={language}
              signals={recentSignals}
            />

            {/* ── 4. Watchlist + Whale Stories ── */}
            <div className={styles.watchStoryRow} style={{ gridColumn: "1 / -1" }}>
              {/* Watchlist */}
              <div className={styles.watchlistCard} id="watchlist">
                <CuratedWatchlistPanel
                  items={watchlist}
                  initialLanguage={language}
                  collapsedCount={WATCHLIST_COLLAPSED_COUNT}
                  title={dictionary.home.watchlistTitle}
                  lead={dictionary.home.watchlistLead}
                  emptyTitle={dictionary.curated.emptyTitle}
                  emptyBody={dictionary.curated.emptyBody}
                />
              </div>

              {/* Whale Stories */}
              <div className={styles.storiesCard}>
                <h3 className={styles.storiesTitle}>{dictionary.home.storiesTitle}</h3>
                <WhaleStoryPanel
                  stories={stories}
                  emptyMessage={dictionary.stories.emptyBody}
                  generatedPrefix={dictionary.home.storyGeneratedPrefix}
                />
              </div>
            </div>

            {/* ── 5. Telegram CTA ── */}
            <div className={styles.telegramCta} id="telegram">
              <div className={styles.telegramCtaContent}>
                <h2 className={styles.telegramCtaTitle}>
                  {dictionary.home.telegramTitle.split("\n").map((line, index) => (
                    <span key={`${line}-${index}`}>
                      {index > 0 ? <br /> : null}
                      {line}
                    </span>
                  ))}
                </h2>
                <p className={styles.telegramCtaDesc}>
                  {dictionary.home.telegramDescription}{" "}
                  <strong>
                    {formatDashboardMessage(dictionary.home.telegramAudienceTemplate, {
                      count: telegramSubscribers,
                    })}
                  </strong>
                </p>
              </div>
              <TelegramConnectModal
                channelQrUrl={telegramConfig.channelQrUrl}
                channelUrl={telegramConfig.channelUrl}
                channelUsername={telegramConfig.channelUsername}
                className={styles.telegramCtaBtn}
                subscriberCount={telegramSubscribers}
                initialLanguage={language}
              />
            </div>

            {/* ── 6. AI Explainability ── */}
            <div className={styles.explainSection}>
              <h3 className={styles.explainTitle}>{dictionary.home.explainTitle}</h3>
              <div className={styles.explainFlow}>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon}>
                    <span className={styles.materialIcon}>database</span>
                  </div>
                  <span className={styles.explainStepLabel}>{dictionary.home.explainRawData}</span>
                </div>
                <div className={styles.explainConnector}>
                  <div className={styles.explainConnectorDot} />
                </div>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon}>
                    <span className={styles.materialIcon}>sensors</span>
                  </div>
                  <span className={styles.explainStepLabel}>{dictionary.home.explainSignalExtraction}</span>
                </div>
                <div className={styles.explainConnector}>
                  <div className={styles.explainConnectorDot} />
                </div>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon} data-highlight="true">
                    <span className={styles.materialIcon}>auto_awesome</span>
                  </div>
                  <span className={styles.explainStepLabel} data-highlight="true">{dictionary.home.explainAiBrief}</span>
                </div>
                <div className={styles.explainConnector}>
                  <div className={styles.explainConnectorDot} />
                </div>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon} data-highlight="filled">
                    <span className={styles.materialIcon}>notifications_active</span>
                  </div>
                  <span className={styles.explainStepLabel} data-highlight="true">{dictionary.home.explainRealtimeAlert}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Risk Disclaimer ── */}
          <article className={styles.riskCard} id="risk">
            <h3>{dictionary.home.riskTitle}</h3>
            <p>{dictionary.home.riskBody}</p>
            <p className={styles.riskMeta}>{pipelineSummary}</p>
            {data?.opsSummary?.detail ? <p className={styles.riskMeta}>{data.opsSummary.detail}</p> : null}
            {!state.sourceConnected ? <p className={styles.riskMeta}>{dictionary.home.riskWaiting}</p> : null}
          </article>
        </div>

        <aside className={styles.newsRail} aria-label={dictionary.home.newsRailAriaLabel}>
          <NewsWidget limit={4} />
        </aside>
      </div>
      {/* layoutShell */}

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <h3 className={styles.footerBrand}>{dictionary.home.footerTitle}</h3>
            <p className={styles.footerDesc}>
              {dictionary.home.footerDescription}
            </p>
            <p className={styles.footerCompany}>
              <span className={styles.footerCompanyLabel}>
                {dictionary.home.footerCompanyLabel}
              </span>
              <a
                className={styles.footerCompanyLink}
                href="https://bukhae.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                {dictionary.home.footerCompanyName}
                <span aria-hidden="true">↗</span>
              </a>
            </p>
            <p className={styles.footerCopyright}>
              {formatDashboardMessage(dictionary.home.footerCopyright, {
                year: new Date().getFullYear(),
              })}
            </p>
          </div>
          <div className={styles.footerRight}>
            <p>
              <strong>{dictionary.home.riskTitle}:</strong> {dictionary.home.footerWarning}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
