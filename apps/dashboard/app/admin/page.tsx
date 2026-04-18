import { TopNavbar } from "@/components/top-navbar";
import { AdminSessionPanel } from "@/components/admin-session-panel";
import { SignalActionCard } from "@/components/signal-action-card";
import { SystemLogPanel, type SystemLogRow } from "@/components/system-log-panel";
import { DASHBOARD_SESSION_COOKIE_NAME, getDashboardAuthResult } from "@/lib/auth";
import { DashboardConfigError } from "@/lib/env";
import {
  chainIconColor,
  chainIconName,
  formatAmount,
  formatCompactCount,
  formatScore,
  formatTime,
  formatUsd,
  humanizeLatestRunStatus,
  humanizeLog,
  humanizeLogMessage,
  humanizeSignal,
  humanizeTransaction,
  toneForListenerStatus,
  toneForStatus,
} from "@/lib/humanize";
import { getDashboardData } from "@/lib/metrics";
import { normalizeDashboardData } from "@/lib/normalize";
import { cookies } from "next/headers";
import type { DashboardData, NormalizedDashboard } from "@/lib/types";
import styles from "../page.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const auth = getDashboardAuthResult({
    sessionCookie: cookieStore.get(DASHBOARD_SESSION_COOKIE_NAME)?.value ?? undefined,
  });

  if (auth.productionLocked) {
    return (
      <>
        <TopNavbar />

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
        <TopNavbar />

        <main className={styles.main}>
          <section className={styles.colSpan12}>
            <AdminSessionPanel mode="login" />
          </section>
        </main>
      </>
    );
  }

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
      <TopNavbar />

      <main className={styles.main}>
        {auth.passwordConfigured ? (
          <section className={styles.colSpan12}>
            <AdminSessionPanel
              mode="session"
              message="브라우저 쿠키 세션으로 admin API 요청이 자동 인증됩니다."
            />
          </section>
        ) : null}

        {/* Hero Summary Banner */}
        <section className={styles.colSpan12}>
          <div className={styles.hero}>
            <div className={styles.heroWaveIcon} aria-hidden="true">
              <span className="material-symbols-outlined">waves</span>
            </div>
            <div className={styles.heroContent}>
              <h1 className={styles.heroTitle}>WhaleScope 운영 대시보드</h1>
              <div className={styles.heroSummaryBox}>
                <span className="material-symbols-outlined">auto_awesome</span>
                <p className={styles.heroSummaryText}>
                  오늘 감지된 주요 고래 이동은 <strong>{formatCompactCount(data.metrics.transactionCount)}건</strong>이며,
                  CEX 유입 시그널 <strong>{formatCompactCount(data.metrics.signalCount)}건</strong>과
                  일일 브리핑 <strong>{formatCompactCount(data.metrics.dailyBriefCount)}건</strong>이 확인되었습니다.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Service Health Grid */}
        <section className={styles.colSpan12}>
          <div className={styles.serviceGrid}>
            {serviceCards.map((card, idx) => {
              const action = SERVICE_ACTIONS[idx] ?? null;
              const icon = SERVICE_ICONS[idx] ?? "dns";
              return (
                <div key={card.title} className={styles.serviceCard}>
                  <div>
                    <div className={styles.serviceCardHeader}>
                      <div className={styles.serviceIcon} data-tone={card.tone}>
                        <span className="material-symbols-outlined">{icon}</span>
                      </div>
                      <span className={styles.serviceBadge} data-tone={card.tone}>
                        {card.status}
                      </span>
                    </div>
                    <h3 className={styles.serviceTitle}>{card.title}</h3>
                    <p className={styles.serviceDesc}>{card.description}</p>
                  </div>
                  {action ? (
                    <a
                      href={action.href}
                      className={`${styles.serviceAction} ${
                        action.variant === "primary" ? styles.serviceActionPrimary : styles.serviceActionSecondary
                      }`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{action.icon}</span>
                      {action.label}
                    </a>
                  ) : (
                    <div className={styles.serviceLive}>
                      <span className={styles.serviceLiveDot} />
                      시스템 활성 상태
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Daily Brief (8 cols) */}
        <section className={styles.colSpan8} id="daily-brief">
          <div className={styles.briefCard}>
            <div className={styles.briefHeader}>
              <h2 className={styles.briefHeaderTitle}>오늘의 고래 브리핑</h2>
              <span className={styles.briefHeaderTime}>
                마지막 업데이트: {formatTime(data.generatedAt, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>

            <article>
              <h3 className={styles.briefArticleTitle}>
                {data.latestBrief.summary.length > 60
                  ? data.latestBrief.summary.slice(0, 60).trim()
                  : data.latestBrief.summary}
              </h3>

              <p className={styles.briefBody}>{data.latestBrief.summary}</p>

              <div className={styles.briefTwoCol}>
                <div className={`${styles.briefColBox} ${styles.briefColBoxSignals}`}>
                  <h4 className={`${styles.briefColTitle} ${styles.briefColTitlePrimary}`}>
                    <span className="material-symbols-outlined">search</span> 주목 시그널
                  </h4>
                  {data.latestBrief.highlights && data.latestBrief.highlights.length > 0 ? (
                    <ul className={styles.briefColList}>
                      {data.latestBrief.highlights.map((item) => (
                        <li key={item}>&#8226; {item}</li>
                      ))}
                    </ul>
                  ) : signals.length > 0 ? (
                    <ul className={styles.briefColList}>
                      {signals.slice(0, 3).map((s) => (
                        <li key={s.id}>&#8226; {s.title}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.briefColText}>아직 수집된 시그널이 없습니다.</p>
                  )}
                </div>

                <div className={`${styles.briefColBox} ${styles.briefColBoxInsights}`}>
                  <h4 className={`${styles.briefColTitle} ${styles.briefColTitleTertiary}`}>
                    <span className="material-symbols-outlined">trending_up</span> 시장 시사점
                  </h4>
                  {data.latestBrief.signalThemes && data.latestBrief.signalThemes.length > 0 ? (
                    <p className={styles.briefColText}>
                      {data.latestBrief.signalThemes.join(", ")}
                    </p>
                  ) : (
                    <p className={styles.briefColText}>
                      {humanizeLogMessage(data.latestRun.message, data.latestRun.status)}
                    </p>
                  )}
                </div>
              </div>

              <p className={styles.briefDisclaimer}>
                본 콘텐츠는 정보 제공 목적으로만 작성되었으며, 투자 조언이 아닙니다. 모든 투자의 책임은 본인에게 있습니다.
              </p>
            </article>
          </div>
        </section>

        {/* Right Side: Signals + Checklist (4 cols) */}
        <section className={`${styles.colSpan4} ${styles.rightColumn}`}>
          {/* Core Signals */}
          <div className={styles.signalsPanel} id="signals">
            <h3 className={styles.signalsPanelTitle}>
              <span className="material-symbols-outlined">emergency_home</span> 핵심 시그널
            </h3>

            {signals.length > 0 ? (
              <div className={styles.signalsPanelList}>
                {signals.slice(0, 4).map((row) => (
                  <SignalActionCard
                    key={row.id}
                    signalId={row.id}
                    createdAt={row.createdAt}
                    title={row.title}
                    summary={row.summary}
                    severityLabel={row.severityLabel}
                    confidenceLabel={row.confidenceLabel}
                    score={formatScore(row.score)}
                    tone={row.tone}
                    timeLabel={formatTime(row.createdAt, { hour: "2-digit", minute: "2-digit" })}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p className={styles.emptyStateTitle}>시그널 없음</p>
                <p className={styles.emptyStateBody}>파이프라인 실행 후 시그널이 이 영역에 표시됩니다.</p>
              </div>
            )}
          </div>

          {/* Operator Checklist (dark) */}
          <div className={styles.checklistCard} id="operator-checklist">
            <h3 className={styles.checklistCardTitle}>
              <span className="material-symbols-outlined">checklist</span> 운영 체크리스트
            </h3>
            <div>
              {operatorChecklist.map((item) => {
                const isDone = item.tone === "good";
                const checkedAttr = isDone ? "true" : "false";
                return (
                  <div key={item.label} className={styles.checklistItem}>
                    <div className={styles.checklistCheckbox} data-checked={checkedAttr}>
                      {isDone && <span className="material-symbols-outlined">check</span>}
                    </div>
                    <span className={styles.checklistLabel} data-checked={checkedAttr}>
                      {item.label}
                    </span>
                    <span className={styles.checklistStatus} data-checked={checkedAttr}>
                      {item.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Whale Movement Timeline (8 cols) */}
        <section className={styles.colSpan8} id="transactions">
          <div className={styles.timelineCard}>
            <h2 className={styles.timelineCardTitle}>고래 이동 타임라인</h2>
            {transactions.length > 0 ? (
              <div className={styles.timelineList}>
                {transactions.map((row) => (
                  <div key={row.id} className={styles.timelineItem}>
                    <div className={styles.timelineItemIcon}>
                      <span className="material-symbols-outlined" style={{ color: chainIconColor(row.chain) }}>
                        {chainIconName(row.chain)}
                      </span>
                    </div>
                    <div className={styles.timelineItemBody}>
                      <p className={styles.timelineItemHeadline}>
                        <strong style={{ color: chainIconColor(row.chain) }}>{row.symbol} {formatAmount(row.amount)}개</strong>
                        가 {row.fromLabel}에서{" "}
                        <span className={styles.timelineDirectionBadge} data-dir="in">
                          {row.toLabel}
                        </span>
                        {" "}로 이동했습니다.
                      </p>
                      <span className={styles.timelineItemMeta}>
                        {formatTime(row.timestamp, { hour: "2-digit", minute: "2-digit" })} 전 &#8226; {row.chainLabel}
                        {row.amountUsd > 0 ? ` &#8226; ${formatUsd(row.amountUsd)}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <p className={styles.emptyStateTitle}>아직 수집된 거래가 없습니다.</p>
                <p className={styles.emptyStateBody}>파이프라인을 실행하면 최신 거래가 타임라인에 표시됩니다.</p>
              </div>
            )}
          </div>
        </section>

        {/* Operation Log (4 cols) */}
        <section id="log" className={`${styles.colSpan4} ${styles.oplogCard}`}>
          <h2 className={styles.oplogCardTitle}>운영 알림 센터</h2>
          <SystemLogPanel rows={logRows} />
        </section>
      </main>
    </>
  );
}
