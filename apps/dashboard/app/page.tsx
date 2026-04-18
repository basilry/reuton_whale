import type { Metadata } from "next";
import { TopNavbar } from "@/components/top-navbar";
import { InsightsSidebar } from "@/components/insights-sidebar";
import { MarketTickerStrip } from "@/components/market-ticker-strip";
import { NewsWidget } from "@/components/news-widget";
import { TelegramConnectModal } from "@/components/telegram-connect-modal";
import { cleanGeneratedBrief } from "@/lib/format";
import { getDashboardData, type DashboardData } from "@/lib/metrics";
import { getTelegramPublicConfig } from "@/lib/public-app-config";
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

function truncateHash(value?: string): string {
  const text = safeText(value, "");
  if (!text) {
    return "상세";
  }
  if (text.startsWith("0x") && text.length > 8) {
    return `${text.slice(0, 6)}…${text.slice(-4)}`;
  }
  return text.length <= 14 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function getSignalLabel(rule: string): string {
  const normalized = rule.toLowerCase();
  const map: Record<string, string> = {
    cex_inflow_spike: "거래소 유입 급증",
    cex_outflow_spike: "거래소 유출 급증",
    smart_money_accumulation: "스마트머니 매집 가능성",
    cold_to_hot_transfer: "보관 지갑에서 활동 지갑 이동",
    corroborated_move: "온체인과 알림이 함께 확인된 움직임",
    whale_cluster_move: "고래 군집 이동",
  };

  return map[normalized] ?? rule.replace(/[_-]+/g, " ");
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

function getToneLabel(tone: SignalTone): string {
  switch (tone) {
    case "critical":
      return "강한 주의";
    case "watch":
      return "관찰 필요";
    case "positive":
      return "긍정";
    default:
      return "중립";
  }
}

function getCuratedCategoryLabel(category: string): string {
  const normalized = category.trim().toLowerCase();
  const map: Record<string, string> = {
    exchange: "거래소",
    market_maker: "마켓메이커",
    fund: "펀드",
    custody: "커스터디",
    bridge: "브리지",
    protocol: "프로토콜",
    foundation: "재단",
    unknown: "미분류",
  };

  return map[normalized] ?? category;
}

function humanizeChain(chain: string): string {
  const normalized = chain.trim().toLowerCase();
  const map: Record<string, string> = {
    ethereum: "Ethereum",
    eth: "Ethereum",
    solana: "Solana",
    sol: "Solana",
    bitcoin: "Bitcoin",
    btc: "Bitcoin",
  };

  return map[normalized] ?? chain;
}

function buildBriefAnalysis(data: DashboardData | null, brief: ReturnType<typeof buildBriefCopy>, mood: ReturnType<typeof buildMarketMood>): BriefAnalysisItem[] {
  const latestBrief = data?.latestBrief;
  const signalThemes = latestBrief?.signalThemes ?? [];
  const highlights = latestBrief?.highlights ?? [];
  const totalVolumeUsd = latestBrief?.totalVolumeUsd ?? 0;
  const signalCount = data?.metrics.signalCount ?? 0;
  const transactionCount = data?.metrics.transactionCount ?? 0;

  return [
    {
      label: "핵심 해석",
      value: brief.summary,
      description: mood.copy,
      tone: mood.label === "주의" ? "critical" : mood.label === "관찰" ? "watch" : "neutral",
    },
    {
      label: "주요 포인트",
      value:
        highlights.slice(0, 2).join(" · ") ||
        signalThemes.slice(0, 2).join(" · ") ||
        "아직 강조 포인트가 충분하지 않습니다.",
      description:
        signalThemes.length > 0
          ? `${signalThemes.length}개의 시그널 테마가 브리핑에 반영되었습니다.`
          : "시그널 테마가 더 쌓이면 분석이 구체화됩니다.",
      tone: signalCount > 0 ? "positive" : "neutral",
    },
    {
      label: "규모 요약",
      value: `${formatCurrency(totalVolumeUsd)} · ${formatCompactNumber(transactionCount)}건`,
      description:
        latestBrief?.alertCount && latestBrief.alertCount > 0
          ? `경고 포인트 ${latestBrief.alertCount}건이 함께 기록되었습니다.`
          : `최근 ${formatCompactNumber(signalCount)}개 신호가 관찰되었습니다.`,
      tone: transactionCount > 0 ? "watch" : "neutral",
    },
  ];
}

function buildBriefCopy(data: DashboardData | null): {
  title: string;
  summary: string;
  highlights: string[];
  note: string;
} {
  const brief = data?.latestBrief;
  if (brief) {
    return {
      title: "오늘의 고래 브리핑",
      summary: brief.summary
        ? cleanGeneratedBrief(brief.summary)
        : "오늘 수집된 브리핑이 없습니다.",
      highlights:
        brief.highlights.length > 0
          ? brief.highlights
          : [
              `주요 감지 건수 ${formatCompactNumber(data?.metrics.signalCount ?? 0)}건`,
              `관측된 거래 ${formatCompactNumber(data?.metrics.transactionCount ?? 0)}건`,
            ],
      note:
        brief.alertCount > 0
          ? `${brief.alertCount}개의 경고성 포인트가 함께 기록되었습니다.`
          : "경고성 포인트는 제한적입니다.",
    };
  }

  return {
    title: "오늘의 고래 브리핑",
    summary:
      "아직 연결된 브리핑이 없습니다. 정보수집 파이프라인이 실행되면 사람이 읽는 형태의 요약이 여기에 표시됩니다.",
    highlights: ["실행 대기", "데이터 연결 필요"],
    note: "데이터 수집이 다시 시작되면 실제 브리핑이 여기에 반영됩니다.",
  };
}

function buildMarketMood(data: DashboardData | null): {
  label: string;
  copy: string;
  detail: string;
} {
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
      label: "연결 대기",
      copy: "데이터가 아직 연결되지 않았습니다.",
      detail: "수집 워커를 실행하면 시장 분위기가 계산됩니다.",
    };
  }

  if (criticalCount > 0) {
    return {
      label: "주의",
      copy: "거래소 유입과 단기 변동성 가능성이 함께 관찰됩니다.",
      detail: `${criticalCount}개의 강한 신호와 ${watchCount}개의 관찰 신호가 있습니다.`,
    };
  }

  if (watchCount > 0) {
    return {
      label: "관찰",
      copy: "큰 방향 전환보다는 흐름 확인이 필요한 상태입니다.",
      detail: `${watchCount}개의 관찰 신호가 있으며, 추세 확인이 필요합니다.`,
    };
  }

  return {
    label: "안정",
    copy: "특이 급변 신호는 적고, 브리핑은 완만한 흐름을 가리킵니다.",
    detail: "현재 감지된 시그널이 적어 시장 분위기는 중립에 가깝습니다.",
  };
}

function buildSignalNarrative(signal: DashboardData["recentSignals"][number]): string {
  const label = getSignalLabel(signal.rule || "signal");
  const score = safeNumber(signal.score);
  const severity = safeText(signal.severity, "").toLowerCase();

  if (severity.includes("critical") || score >= 80) {
    return `${label}가 강하게 감지되었습니다. 관심이 필요한 구간입니다.`;
  }

  if (severity.includes("high") || score >= 50) {
    return `${label} 신호가 관찰되었습니다. 흐름을 함께 확인하세요.`;
  }

  return `${label} 신호가 약하게 관찰되었습니다. 참고용으로 지켜볼 수 있습니다.`;
}

async function loadInsightState(): Promise<InsightState> {
  try {
    const data = await getDashboardData({
      transactionLimit: 6,
      signalLimit: 6,
      systemLogLimit: 4,
    });

    return {
      data,
      sourceConnected: true,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error("[insights/page]", error.message, error.stack);
    } else {
      console.error("[insights/page]", error);
    }
    return {
      data: null,
      sourceConnected: false,
    };
  }
}

export default async function InsightsPage() {
  const state = await loadInsightState();
  const data = state.data;
  const brief = buildBriefCopy(data);
  const mood = buildMarketMood(data);
  const briefAnalysis = buildBriefAnalysis(data, brief, mood);
  const telegramConfig = getTelegramPublicConfig();
  const watchlist = data?.watchlist ?? [];
  const stories = data?.whaleStories ?? [];

  const connectedLabel = state.sourceConnected ? "데이터 연결됨" : "데이터 연결 대기";
  const telegramSubscribers = data?.metrics.subscriberCount ?? 0;

  const signalIcons: Record<SignalTone, string> = {
    critical: "trending_up",
    watch: "waves",
    positive: "cognition",
    neutral: "sensors",
  };

  const briefAnalysisIcons = ["analytics", "diversity_3", "warning"];

  return (
    <main className={styles.page}>
      <TopNavbar />

      {/* ── Layout Shell: InsightsSidebar + content + news rail ── */}
      <div className={styles.layoutShell}>
        <InsightsSidebar />

        {/* ── Content ── */}
        <div className={styles.content}>
          {/* ── Page Header ── */}
          <section className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageTitle}>시장 인텔리전스</h1>
              <p className={styles.pageSubtitle}>전략적 통찰을 위한 연구 중심 큐레이션</p>
              <div className={styles.connectionChip}>
                <span className={styles.connectionDot} />
                {connectedLabel}
              </div>
            </div>
          </section>

          <section id="market-ticker" className={styles.tickerSlot}>
            <MarketTickerStrip
              eyebrow="Public Market Feed"
              title="실시간 시장 티커"
            />
          </section>

          {/* ── Bento Grid ── */}
          <div className={styles.bentoGrid}>
            {/* ── 1. Today's Whale Brief ── */}
            <article className={styles.heroCard} id="brief">
              <div className={styles.heroCardGlow} aria-hidden="true" />
              <div className={styles.heroCardInner}>
                <div className={styles.heroTopline}>
                  <span className={styles.labelPill}>데일리 리포트</span>
                  <span className={styles.dateMuted}>{data?.latestBrief?.date ?? "오늘"}</span>
                </div>
                <h2 className={styles.heroTitle}>{brief.title}</h2>
                <p className={styles.heroSummary}>&ldquo;{brief.summary}&rdquo;</p>

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
                    <strong>리스크 고지:</strong> {brief.note}
                  </p>
                </div>
              </div>
            </article>

            {/* ── 2. Market Mood ── */}
            <div className={styles.moodCard}>
              <h3 className={styles.moodLabel}>시장 분위기</h3>
              <div className={styles.moodGauge}>
                <svg viewBox="0 0 192 192">
                  <circle className={styles.moodGaugeBg} cx="96" cy="96" r="80" />
                  <circle className={styles.moodGaugeFill} cx="96" cy="96" r="80" />
                </svg>
                <div className={styles.moodGaugeCenter}>
                  <span className={styles.materialIcon} style={{ fontVariationSettings: "'FILL' 1", fontSize: "2.25rem" }}>water_drop</span>
                  <span className={styles.moodToneLabel}>{mood.label}</span>
                </div>
              </div>
              <h4 className={styles.moodTitle}>{mood.copy}</h4>
              <p className={styles.moodDesc}>{mood.detail}</p>
            </div>

            {/* ── 3. Key Signals ── */}
            <div className={styles.signalSection} id="signals">
              <h3 className={styles.signalSectionTitle}>감지된 주요 시그널</h3>
              <div className={styles.signalGrid}>
                {(data?.recentSignals ?? []).length > 0 ? (
                  (data?.recentSignals ?? []).slice(0, 3).map((signal, index) => {
                    const tone = getSignalTone(safeText(signal.severity, ""), safeNumber(signal.score));
                    const label = getSignalLabel(signal.rule || "signal");
                    return (
                      <article key={signal.signal_id || String(index)} className={styles.signalCard} data-tone={tone}>
                        <div className={styles.signalCardTop}>
                          <span className={styles.materialIcon} style={{ fontVariationSettings: "'FILL' 1" }}>
                            {signalIcons[tone]}
                          </span>
                          <span className={styles.signalToneBadge}>{getToneLabel(tone)}</span>
                        </div>
                        <h4 className={styles.signalCardTitle}>{label}</h4>
                        <p className={styles.signalCardDesc}>{buildSignalNarrative(signal)}</p>
                        <span className={styles.signalCardLink}>분석 내용 보기 →</span>
                      </article>
                    );
                  })
                ) : (
                  <article className={styles.emptyCard}>
                    <h4>아직 감지된 시그널이 없습니다.</h4>
                    <p>수집 워커가 실행되면 이 영역에 이해하기 쉬운 경고와 관찰 신호가 표시됩니다.</p>
                  </article>
                )}
              </div>
            </div>

            {/* ── 4. Watchlist + Whale Stories ── */}
            <div className={styles.watchStoryRow} style={{ gridColumn: "1 / -1" }}>
              {/* Watchlist */}
              <div className={styles.watchlistCard} id="watchlist">
                <h3 className={styles.watchlistTitle}>큐레이션 감시 지갑</h3>
                <p className={styles.watchlistLead}>
                  거래소, 커스터디, 주요 참여자 주소 중 시장 해석에 의미가 있는 지갑만 선별해 보여줍니다.
                </p>
                {watchlist.length > 0 ? (
                  <div className={styles.watchlistItems}>
                    {watchlist.map((item) => {
                      const isHighlight = item.tone === "critical" || item.relatedSignalCount > 0;
                      return (
                        <div key={item.id} className={styles.watchItem} data-highlight={isHighlight ? "true" : undefined}>
                          <div className={styles.watchItemLeft}>
                            <div className={styles.watchAvatar}>{item.symbol.slice(0, 1)}</div>
                            <div>
                              <p className={styles.watchSymbol}>{item.title}</p>
                              <p
                                className={styles.watchNote}
                                data-tone={item.tone === "critical" ? "critical" : item.tone === "positive" ? "positive" : undefined}
                              >
                                {item.note}
                              </p>
                              <div className={styles.watchMeta}>
                                <span>{humanizeChain(item.chain)}</span>
                                <span>{getCuratedCategoryLabel(item.category)} · Grade {item.grade}</span>
                              </div>
                            </div>
                          </div>
                          <div className={styles.watchItemRight}>
                            <span className={styles.watchBadge} data-tone={item.tone}>
                              {item.badge}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <article className={styles.emptyCard}>
                    <h4>아직 큐레이션 감시 지갑이 준비되지 않았습니다.</h4>
                    <p>큐레이션 지갑 레지스트리가 연결되면, 시장 해석에 중요한 주소만 이 영역에 표시됩니다.</p>
                  </article>
                )}
              </div>

              {/* Whale Stories */}
              <div className={styles.storiesCard}>
                <h3 className={styles.storiesTitle}>고래 스토리</h3>
                {stories.map((story) => (
                  <div
                    key={story.id}
                    className={styles.storyItem}
                  >
                    <div className={styles.storyItemInner}>
                      <div className={styles.storyDot} data-tone={story.tone} />
                      <div>
                        <p className={styles.storyBody}>
                          <strong>{story.title}</strong> {story.body}
                        </p>
                        <div className={styles.storyMeta}>
                          <span>{story.meta}</span>
                          {story.hash ? <span>{truncateHash(story.hash)}</span> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 5. Telegram CTA ── */}
            <div className={styles.telegramCta} id="telegram">
              <div className={styles.telegramCtaContent}>
                <h2 className={styles.telegramCtaTitle}>
                  WhaleScope 공개 채널에서<br />실시간 브리핑을 받아보세요.
                </h2>
                <p className={styles.telegramCtaDesc}>
                  채널 QR 또는 링크로 바로 입장해, 핵심 브리핑과 공용 시그널 업데이트를 빠르게 확인할 수 있습니다.
                  현재 구독자 수는 <strong>{telegramSubscribers}</strong>명입니다.
                </p>
              </div>
              <TelegramConnectModal
                channelQrUrl={telegramConfig.channelQrUrl}
                channelUrl={telegramConfig.channelUrl}
                channelUsername={telegramConfig.channelUsername}
                className={styles.telegramCtaBtn}
                subscriberCount={telegramSubscribers}
              />
            </div>

            {/* ── 6. AI Explainability ── */}
            <div className={styles.explainSection}>
              <h3 className={styles.explainTitle}>WhaleScope 지능형 분석 작동 방식</h3>
              <div className={styles.explainFlow}>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon}>
                    <span className={styles.materialIcon}>database</span>
                  </div>
                  <span className={styles.explainStepLabel}>원시 데이터</span>
                </div>
                <div className={styles.explainConnector}>
                  <div className={styles.explainConnectorDot} />
                </div>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon}>
                    <span className={styles.materialIcon}>sensors</span>
                  </div>
                  <span className={styles.explainStepLabel}>시그널 추출</span>
                </div>
                <div className={styles.explainConnector}>
                  <div className={styles.explainConnectorDot} />
                </div>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon} data-highlight="true">
                    <span className={styles.materialIcon}>auto_awesome</span>
                  </div>
                  <span className={styles.explainStepLabel} data-highlight="true">AI 브리핑</span>
                </div>
                <div className={styles.explainConnector}>
                  <div className={styles.explainConnectorDot} />
                </div>
                <div className={styles.explainStep}>
                  <div className={styles.explainStepIcon} data-highlight="filled">
                    <span className={styles.materialIcon}>notifications_active</span>
                  </div>
                  <span className={styles.explainStepLabel} data-highlight="true">실시간 알림</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Risk Disclaimer ── */}
          <article className={styles.riskCard} id="risk">
            <h3>리스크 고지</h3>
            <p>
              WhaleScope는 투자 조언을 제공하지 않습니다. 모든 정보는 공개 데이터와 AI 요약을 기반으로 한 참고용
              리서치입니다.
            </p>
            {!state.sourceConnected ? <p className={styles.riskMeta}>데이터 연결을 확인 중입니다. 잠시 후 다시 시도하세요.</p> : null}
          </article>
        </div>

        <aside className={styles.newsRail} aria-label="뉴스 및 큐레이션">
          <NewsWidget limit={4} />
        </aside>
      </div>
      {/* layoutShell */}

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <h3 className={styles.footerBrand}>WhaleScope</h3>
            <p className={styles.footerDesc}>
              WhaleScope는 대규모 블록체인 이동에 대한 통찰을 제공하는 AI 기반 큐레이션 서비스입니다.
              우리는 자연어 해석을 통해 정교한 데이터를 대중화하는 것을 목표로 합니다.
            </p>
          </div>
          <div className={styles.footerRight}>
            <p>
              <strong>리스크 경고:</strong> WhaleScope는 투자 조언을 제공하지 않습니다.
              암호화폐 투자는 상당한 위험을 수반합니다. 손실을 감당할 수 있는 금액 내에서만 거래해야 합니다.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
