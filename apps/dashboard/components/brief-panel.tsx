import { RunStatusBadge } from "@/components/run-status-badge";
import styles from "./brief-panel.module.css";

type BriefPanelProps = {
  brief: {
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
  latestRun: {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  };
  sourceState: "connected" | "fallback";
};

function formatUsd(value?: number) {
  if (!value) {
    return "No volume yet";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCaption(value?: string) {
  if (!value) {
    return "No timestamp";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function EmptyBrief({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyStateTitle}>{title}</p>
      <p className={styles.emptyStateBody}>{body}</p>
    </div>
  );
}

export function BriefPanel({ brief, latestRun, sourceState }: BriefPanelProps) {
  const highlights = brief.highlights ?? [];
  const themes = brief.signalThemes ?? [];
  const topTransactions = brief.topTransactions ?? [];

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Daily brief</p>
          <h2>Latest curated brief</h2>
        </div>
        <RunStatusBadge status={latestRun.status} />
      </div>

      <div className={styles.summary}>
        <p className={styles.summaryCopy}>{brief.summary}</p>
        <div className={styles.stats}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockLabel}>Brief date</span>
            <strong className={styles.statBlockValue}>{brief.date || "Not generated yet"}</strong>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockLabel}>Generated at</span>
            <strong className={styles.statBlockValue}>{formatCaption(brief.generatedAt)}</strong>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockLabel}>Alert count</span>
            <strong className={styles.statBlockValue}>{brief.alertCount ?? 0}</strong>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockLabel}>Volume</span>
            <strong className={styles.statBlockValue}>{formatUsd(brief.totalVolumeUsd)}</strong>
          </div>
        </div>
      </div>

      <div className={styles.bands}>
        <div className={styles.band}>
          <p className={styles.bandLabel}>Highlights</p>
          {highlights.length > 0 ? (
            <ul className={styles.bulletList}>
              {highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <EmptyBrief
              title="구조화된 하이라이트 없음"
              body="요약 본문은 생성됐지만 별도 하이라이트 필드는 아직 저장되지 않았습니다."
            />
          )}
        </div>

        <div className={styles.band}>
          <p className={styles.bandLabel}>Signal themes</p>
          {themes.length > 0 ? (
            <div className={styles.tagCloud}>
              {themes.map((item) => (
                <span key={item} className={styles.tagCloudItem}>
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <EmptyBrief
              title="테마 태그 없음"
              body="현재 브리핑 스키마에는 별도 테마 태그가 없어 원문 요약과 시그널 표를 기준으로 확인합니다."
            />
          )}
        </div>
      </div>

      <div className={styles.foot}>
        <div>
          <p className={styles.footLabel}>Top transactions</p>
          {topTransactions.length > 0 ? (
            <div className={styles.miniGrid}>
              {topTransactions.slice(0, 3).map((item) => (
                <article key={`${item.symbol}-${item.chain}-${item.amountUsd}`} className={styles.miniCard}>
                  <span className={styles.miniCardEyebrow}>{item.chain}</span>
                  <strong className={styles.miniCardTitle}>{item.symbol}</strong>
                  <span className={styles.miniCardValue}>{formatUsd(item.amountUsd)}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBrief
              title="상위 거래 없음"
              body="브리핑 행의 top_transactions 값이 비어 있거나 아직 파싱 가능한 JSON이 아닙니다."
            />
          )}
        </div>

        <div className={styles.source}>
          <span className={sourceState === "connected" ? styles.sourcePill : styles.sourcePillFallback}>
            {sourceState === "connected" ? "Live Sheets data" : "Preview data"}
          </span>
          <p>{latestRun.message}</p>
        </div>
      </div>
    </section>
  );
}
