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
  humanizeLog,
  humanizeLogMessage,
  humanizeOpsStatus,
  humanizeSourceFailureKind,
  humanizeSignal,
  humanizeTransaction,
  toneForOpsStatus,
} from "@/lib/humanize";
import { getDashboardData } from "@/lib/metrics";
import { getCurrentDashboardLanguage } from "@/lib/i18n/server";
import { normalizeDashboardData } from "@/lib/normalize";
import { cookies } from "next/headers";
import type { DashboardData, NormalizedDashboard, OpsServiceName } from "@/lib/types";
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

const SERVICE_META: Record<OpsServiceName, {
  icon: string;
  action: {
    label: string;
    icon: string;
    variant: "primary" | "secondary";
    href: string;
  } | null;
}> = {
  pipeline: {
    icon: "dns",
    action: { label: "실행 로그", icon: "list_alt", variant: "primary", href: "#log" },
  },
  listener: {
    icon: "settings_input_antenna",
    action: { label: "상태 로그", icon: "monitor_heart", variant: "secondary", href: "#log" },
  },
  bot: {
    icon: "smart_toy",
    action: { label: "운영 요약", icon: "campaign", variant: "secondary", href: "#operator-checklist" },
  },
  dashboard: {
    icon: "dashboard",
    action: null,
  },
  data_source: {
    icon: "database",
    action: { label: "시그널 보기", icon: "search", variant: "secondary", href: "#signals" },
  },
};

function buildServiceCards(data: NormalizedDashboard) {
  return SERVICE_ORDER.map((name) => {
    const item = data.serviceHealth[name];
    const hintParts = [
      item.updatedAt
        ? `최근 상태: ${formatTime(item.updatedAt, { dateStyle: "medium", timeStyle: "short" })}`
        : "",
      item.source ? `관측 소스: ${item.source}` : "",
      name === "data_source" && data.sourceHealth.failureKind
        ? `원인 분류: ${humanizeSourceFailureKind(data.sourceHealth.failureKind)}`
        : "",
    ].filter(Boolean);

    return {
      key: name,
      title: item.title,
      status: item.label || humanizeOpsStatus(item.status),
      tone: toneForOpsStatus(item.status),
      description:
        name === "pipeline"
          ? humanizeLogMessage(item.summary, data.latestRun.status)
          : item.summary,
      hint: hintParts.join(" · ") || item.detail,
      action: SERVICE_META[name].action,
      icon: SERVICE_META[name].icon,
    };
  });
}

function buildRuntimeChecklist(data: NormalizedDashboard) {
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

function buildConfigChecklist(data: NormalizedDashboard) {
  return data.operatorChecks.map((item) => ({
    key: item.key,
    label: item.label,
    tone:
      item.status === "ok"
        ? ("good" as const)
        : item.status === "missing"
          ? ("bad" as const)
          : ("warn" as const),
    status: item.status === "ok" ? "완료" : item.status === "missing" ? "누락" : "확인",
    detail: item.detail,
  }));
}

export default async function DashboardPage() {
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

  const data = normalizeDashboardData(await loadDashboardData());
  const serviceCards = buildServiceCards(data);
  const runtimeChecklist = buildRuntimeChecklist(data);
  const configChecklist = buildConfigChecklist(data);
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
                  <strong>{data.opsSummary.headline}</strong> {data.opsSummary.detail} 오늘 감지된 주요 고래 이동은{" "}
                  <strong>{formatCompactCount(data.metrics.transactionCount)}건</strong>이며, CEX 유입 시그널{" "}
                  <strong>{formatCompactCount(data.metrics.signalCount)}건</strong>과 일일 브리핑{" "}
                  <strong>{formatCompactCount(data.metrics.dailyBriefCount)}건</strong>이 확인되었습니다.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Service Health Grid */}
        <section className={styles.colSpan12}>
          <div className={styles.serviceGrid}>
            {serviceCards.map((card) => {
              const action = card.action;
              const icon = card.icon;
              return (
                <div key={card.key} className={styles.serviceCard}>
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
                    <p className={styles.serviceDesc} style={{ marginTop: "var(--space-xs)" }}>
                      {card.hint}
                    </p>
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
              {runtimeChecklist.map((item) => {
                const isDone = item.tone === "good";
                const checkedAttr = isDone ? "true" : "false";
                return (
                  <div key={item.key} className={styles.checklistItem} style={{ alignItems: "flex-start" }}>
                    <div className={styles.checklistCheckbox} data-checked={checkedAttr}>
                      {isDone && <span className="material-symbols-outlined">check</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                        <span className={styles.checklistLabel} data-checked={checkedAttr}>
                          {item.label}
                        </span>
                        <span className={styles.checklistStatus} data-checked={checkedAttr}>
                          {item.status}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: "var(--text-2xs)",
                          color: "var(--inverse-on-surface-muted)",
                          lineHeight: "var(--leading-normal)",
                        }}
                      >
                        {item.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.checklistCard}>
            <h3 className={styles.checklistCardTitle}>
              <span className="material-symbols-outlined">tune</span> 환경/연결 체크
            </h3>
            <div>
              {configChecklist.map((item) => {
                const isDone = item.tone === "good";
                const checkedAttr = isDone ? "true" : "false";
                return (
                  <div key={item.key} className={styles.checklistItem} style={{ alignItems: "flex-start" }}>
                    <div className={styles.checklistCheckbox} data-checked={checkedAttr}>
                      {isDone && <span className="material-symbols-outlined">check</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                        <span className={styles.checklistLabel} data-checked={checkedAttr}>
                          {item.label}
                        </span>
                        <span className={styles.checklistStatus} data-checked={checkedAttr}>
                          {item.status}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: "var(--text-2xs)",
                          color: "var(--inverse-on-surface-muted)",
                          lineHeight: "var(--leading-normal)",
                        }}
                      >
                        {item.detail}
                      </p>
                    </div>
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
