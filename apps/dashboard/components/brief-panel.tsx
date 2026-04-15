import { RunStatusBadge } from "@/components/run-status-badge";

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
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__body">{body}</p>
    </div>
  );
}

export function BriefPanel({ brief, latestRun, sourceState }: BriefPanelProps) {
  const highlights = brief.highlights ?? [];
  const themes = brief.signalThemes ?? [];
  const topTransactions = brief.topTransactions ?? [];

  return (
    <section className="panel brief-panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Daily brief</p>
          <h2>Latest curated brief</h2>
        </div>
        <RunStatusBadge status={latestRun.status} />
      </div>

      <div className="brief-panel__summary">
        <p className="brief-panel__summary-copy">{brief.summary}</p>
        <div className="brief-panel__stats">
          <div className="stat-block">
            <span className="stat-block__label">Brief date</span>
            <strong className="stat-block__value">{brief.date || "Not generated yet"}</strong>
          </div>
          <div className="stat-block">
            <span className="stat-block__label">Generated at</span>
            <strong className="stat-block__value">{formatCaption(brief.generatedAt)}</strong>
          </div>
          <div className="stat-block">
            <span className="stat-block__label">Alert count</span>
            <strong className="stat-block__value">{brief.alertCount ?? 0}</strong>
          </div>
          <div className="stat-block">
            <span className="stat-block__label">Volume</span>
            <strong className="stat-block__value">{formatUsd(brief.totalVolumeUsd)}</strong>
          </div>
        </div>
      </div>

      <div className="brief-panel__bands">
        <div className="brief-panel__band">
          <p className="brief-panel__band-label">Highlights</p>
          {highlights.length > 0 ? (
            <ul className="bullet-list">
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

        <div className="brief-panel__band">
          <p className="brief-panel__band-label">Signal themes</p>
          {themes.length > 0 ? (
            <div className="tag-cloud">
              {themes.map((item) => (
                <span key={item} className="tag-cloud__item">
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

      <div className="brief-panel__foot">
        <div>
          <p className="brief-panel__foot-label">Top transactions</p>
          {topTransactions.length > 0 ? (
            <div className="brief-panel__mini-grid">
              {topTransactions.slice(0, 3).map((item) => (
                <article key={`${item.symbol}-${item.chain}-${item.amountUsd}`} className="mini-card">
                  <span className="mini-card__eyebrow">{item.chain}</span>
                  <strong className="mini-card__title">{item.symbol}</strong>
                  <span className="mini-card__value">{formatUsd(item.amountUsd)}</span>
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

        <div className="brief-panel__source">
          <span className={`source-pill source-pill--${sourceState}`}>
            {sourceState === "connected" ? "Live Sheets data" : "Preview data"}
          </span>
          <p>{latestRun.message}</p>
        </div>
      </div>
    </section>
  );
}
