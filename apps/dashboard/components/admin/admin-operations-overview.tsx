import type { CSSProperties } from "react";

import styles from "@/app/page.module.css";
import { SystemLogPanel, type SystemLogRow } from "@/components/system-log-panel";

export type AdminTone = "good" | "warn" | "bad" | "neutral";

export type AdminOperationsHero = {
  title: string;
  summary: string;
  meta: string[];
  links: Array<{
    label: string;
    href: string;
  }>;
};

export type AdminDataIngestionItem = {
  key: string;
  label: string;
  source: string;
  status: string;
  tone: AdminTone;
  count: string;
  observedAt: string;
  detail: string;
};

export type AdminSnapshotCard = {
  key: string;
  title: string;
  eyebrow: string;
  body: string;
  meta: string[];
};

export type AdminStatBlock = {
  label: string;
  value: string;
  detail: string;
  tone?: AdminTone;
};

export type AdminDataSection = {
  items: AdminDataIngestionItem[];
  snapshots: AdminSnapshotCard[];
  stats: AdminStatBlock[];
  note: string;
};

export type AdminServiceCard = {
  key: string;
  title: string;
  status: string;
  tone: AdminTone;
  summary: string;
  detail: string;
  action?: {
    label: string;
    href: string;
  } | null;
};

export type AdminInsightCard = {
  key: string;
  title: string;
  tone: AdminTone;
  lines: string[];
  hint: string;
};

export type AdminChecklistItem = {
  key: string;
  label: string;
  status: string;
  detail: string;
  tone: AdminTone;
};

export type AdminWorkerSection = {
  services: AdminServiceCard[];
  jobRows: Array<{
    key: string;
    lane: string;
    job: string;
    status: string;
    tone: AdminTone;
    cadence: string;
    observedAt: string;
    source: string;
    detail: string;
  }>;
  insights: AdminInsightCard[];
  failureRows: SystemLogRow[];
  runtimeChecklist: AdminChecklistItem[];
  configChecklist: AdminChecklistItem[];
};

export type AdminRenderService = {
  key: string;
  name: string;
  kind: string;
  status: string;
  tone: AdminTone;
  detail: string;
  meta: string[];
};

export type AdminRenderDeploy = {
  key: string;
  service: string;
  status: string;
  tone: AdminTone;
  detail: string;
};

export type AdminRenderInstance = {
  key: string;
  service: string;
  status: string;
  tone: AdminTone;
  detail: string;
};

export type AdminRenderSection = {
  availability: "available" | "missing" | "error";
  message: string;
  note: string;
  services: AdminRenderService[];
  deploys: AdminRenderDeploy[];
  instances: AdminRenderInstance[];
  logRows: SystemLogRow[];
  dashboardUrl?: string;
  placeholders: Array<{
    key: string;
    title: string;
    body: string;
  }>;
};

export type AdminCorrelationFinding = {
  key: string;
  title: string;
  detail: string;
  tone: AdminTone;
  action?: {
    label: string;
    href: string;
  };
};

export type AdminCorrelationSection = {
  title: string;
  tone: AdminTone;
  summary: string;
  findings: AdminCorrelationFinding[];
  notes: string[];
};

export type AdminOperationsOverviewProps = {
  hero: AdminOperationsHero;
  dataSection: AdminDataSection;
  workerSection: AdminWorkerSection;
  renderSection: AdminRenderSection;
  correlationSection: AdminCorrelationSection;
};

const stackStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-lg)",
};

const sectionBodyStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-lg)",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
  gap: "var(--space-lg)",
};

const twoColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
  gap: "var(--space-lg)",
};

const threeColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
  gap: "var(--space-lg)",
};

const sectionLeadStyle: CSSProperties = {
  margin: 0,
  maxWidth: "56rem",
  fontSize: "var(--text-sm)",
  color: "var(--on-surface-variant)",
  lineHeight: "var(--leading-relaxed)",
};

const metaWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
  marginTop: "var(--space-md)",
};

const metaChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-3xs)",
  padding: "var(--space-3xs) var(--space-sm)",
  borderRadius: "var(--radius-full)",
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--on-surface-variant)",
  fontSize: "var(--text-2xs)",
  fontWeight: "var(--weight-semibold)",
};

const linkWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
  marginTop: "var(--space-lg)",
};

const linkChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "var(--space-xs) var(--space-md)",
  borderRadius: "var(--radius-full)",
  background: "var(--surface-container-high)",
  color: "var(--on-surface)",
  textDecoration: "none",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--weight-bold)",
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-sm)",
};

const detailListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "1rem",
  display: "grid",
  gap: "var(--space-xs)",
  color: "var(--on-surface-variant)",
  fontSize: "var(--text-sm)",
  lineHeight: "var(--leading-relaxed)",
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  maxWidth: "100%",
  minWidth: 0,
  borderRadius: "var(--radius-xl)",
  border: "1px solid var(--line)",
  background: "var(--surface)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "960px",
};

const tableHeadCellStyle: CSSProperties = {
  padding: "12px 14px",
  textAlign: "left",
  fontSize: "var(--text-2xs)",
  fontWeight: "var(--weight-bold)",
  letterSpacing: "var(--tracking-wide)",
  textTransform: "uppercase",
  color: "var(--on-surface-variant)",
  background: "var(--surface-container-low)",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};

const tableCellStyle: CSSProperties = {
  padding: "14px",
  verticalAlign: "top",
  borderBottom: "1px solid var(--line)",
  fontSize: "var(--text-sm)",
  color: "var(--on-surface)",
  lineHeight: "var(--leading-relaxed)",
};

const tableSecondaryTextStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "var(--text-2xs)",
  color: "var(--on-surface-variant)",
};

const statValueStyle: CSSProperties = {
  margin: "var(--space-xs) 0 0",
  fontSize: "var(--text-xl)",
  fontWeight: "var(--weight-extrabold)",
  color: "var(--on-surface)",
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-2xs)",
  fontWeight: "var(--weight-bold)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-wide)",
  color: "var(--accent)",
};

const cardTitleStyle: CSSProperties = {
  margin: "var(--space-xs) 0 0",
  fontSize: "var(--text-base)",
  fontWeight: "var(--weight-bold)",
  color: "var(--on-surface)",
};

const cardBodyStyle: CSSProperties = {
  margin: "var(--space-sm) 0 0",
  fontSize: "var(--text-sm)",
  color: "var(--on-surface-variant)",
  lineHeight: "var(--leading-relaxed)",
};

const dividerStyle: CSSProperties = {
  margin: "var(--space-lg) 0",
  border: 0,
  borderTop: "1px solid var(--line)",
};

function renderBadge(label: string, tone: AdminTone) {
  return renderWorkerStatusBadge(label, tone);
}

function statusIcon(tone: AdminTone): string {
  if (tone === "good") {
    return "check_circle";
  }
  if (tone === "warn") {
    return "warning";
  }
  if (tone === "bad") {
    return "error";
  }
  return "schedule";
}

function renderWorkerStatusBadge(label: string, tone: AdminTone) {
  return (
    <span
      aria-label={`상태 ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 10px",
        borderRadius: "999px",
        border: "1px solid var(--line)",
        background:
          tone === "good"
            ? "color-mix(in srgb, var(--good) 12%, white)"
            : tone === "warn"
              ? "color-mix(in srgb, var(--warn) 14%, white)"
              : tone === "bad"
                ? "color-mix(in srgb, var(--bad) 12%, white)"
                : "var(--surface-container-high)",
        color:
          tone === "good"
            ? "#116149"
            : tone === "warn"
              ? "#8a4a00"
              : tone === "bad"
                ? "#9c2f2f"
                : "var(--on-surface-variant)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)",
        whiteSpace: "nowrap",
      }}
    >
      <ToneDot tone={tone} />
      <span className="material-symbols-outlined" style={{ fontSize: "15px", lineHeight: 1 }}>
        {statusIcon(tone)}
      </span>
      <span>{label}</span>
    </span>
  );
}

function ToneDot({ tone }: { tone: AdminTone }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: "10px",
        height: "10px",
        borderRadius: "999px",
        display: "inline-block",
        background:
          tone === "good"
            ? "var(--good)"
            : tone === "warn"
              ? "var(--warn)"
              : tone === "bad"
                ? "var(--bad)"
                : "var(--accent)",
      }}
    />
  );
}

function SectionTitle(props: { eyebrow: string; title: string; description: string }) {
  return (
    <div className={styles.briefHeader}>
      <div style={{ display: "grid", gap: "var(--space-xs)" }}>
        <p style={eyebrowStyle}>{props.eyebrow}</p>
        <h2 className={styles.briefHeaderTitle}>{props.title}</h2>
        <p style={sectionLeadStyle}>{props.description}</p>
      </div>
    </div>
  );
}

function ChecklistCard(props: { title: string; items: AdminChecklistItem[] }) {
  return (
    <div className={styles.checklistCard}>
      <h3 className={styles.checklistCardTitle}>{props.title}</h3>
      <div>
        {props.items.map((item) => {
          const checkedAttr = item.tone === "good" ? "true" : "false";
          return (
            <div key={item.key} className={styles.checklistItem} style={{ alignItems: "flex-start" }}>
              <div className={styles.checklistCheckbox} data-checked={checkedAttr}>
                {checkedAttr === "true" ? <span className="material-symbols-outlined">check</span> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                  <span className={styles.checklistLabel} data-checked={checkedAttr}>
                    {item.label}
                  </span>
                  {renderWorkerStatusBadge(item.status, item.tone)}
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
  );
}

export function AdminOperationsOverview(props: AdminOperationsOverviewProps) {
  const { hero, dataSection, workerSection, renderSection, correlationSection } = props;

  return (
    <>
      <section className={styles.colSpan12}>
        <div className={styles.hero}>
          <div className={styles.heroWaveIcon} aria-hidden="true">
            <span className="material-symbols-outlined">monitoring</span>
          </div>
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>{hero.title}</h1>
            <p className={styles.heroSummaryText} style={{ maxWidth: "52rem" }}>
              {hero.summary}
            </p>
            <div style={metaWrapStyle}>
              {hero.meta.map((item) => (
                <span key={item} style={metaChipStyle}>
                  {item}
                </span>
              ))}
            </div>
            <div style={linkWrapStyle}>
              {hero.links.map((link) => (
                <a key={link.href} href={link.href} style={linkChipStyle}>
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.colSpan12} id="data-ingestion">
        <div className={styles.briefCard}>
          <SectionTitle
            eyebrow="Section A"
            title="수집 데이터 현황"
            description="Sheets 원장 기준으로 어떤 운영 데이터가 최근에 갱신됐는지, 어떤 탭은 숫자만 있고 어떤 탭은 최신 시각만 노출되는지 구분해서 보여줍니다."
          />

          <div style={sectionBodyStyle}>
            <div style={cardGridStyle}>
              {dataSection.items.map((item) => (
                <article key={item.key} className={styles.serviceCard}>
                  <div style={stackStyle}>
                    <div className={styles.serviceCardHeader}>
                      <div style={{ display: "grid", gap: "var(--space-2xs)" }}>
                        <p style={eyebrowStyle}>{item.source}</p>
                        <h3 className={styles.serviceTitle}>{item.label}</h3>
                      </div>
                      {renderBadge(item.status, item.tone)}
                    </div>
                    <p className={styles.serviceDesc}>관측 수치: {item.count}</p>
                    <p className={styles.serviceDesc}>최근 적재: {item.observedAt}</p>
                    <p className={styles.serviceDesc}>{item.detail}</p>
                  </div>
                </article>
              ))}
            </div>

            <div style={twoColumnStyle}>
              <div className={styles.timelineCard}>
                <h3 className={styles.timelineCardTitle}>최신 레코드 스냅샷</h3>
                <div style={cardGridStyle}>
                  {dataSection.snapshots.map((snapshot) => (
                    <article key={snapshot.key} className={styles.serviceCard}>
                      <p style={eyebrowStyle}>{snapshot.eyebrow}</p>
                      <h4 style={cardTitleStyle}>{snapshot.title}</h4>
                      <p style={cardBodyStyle}>{snapshot.body}</p>
                      <ul style={detailListStyle}>
                        {snapshot.meta.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>

              <div className={styles.timelineCard}>
                <h3 className={styles.timelineCardTitle}>비용·발송 관측</h3>
                <div style={threeColumnStyle}>
                  {dataSection.stats.map((stat) => (
                    <article key={stat.label} className={styles.serviceCard}>
                      <p style={eyebrowStyle}>{stat.label}</p>
                      <p style={statValueStyle}>{stat.value}</p>
                      <p className={styles.serviceDesc} style={{ marginTop: "var(--space-sm)" }}>
                        {stat.detail}
                      </p>
                      {stat.tone ? (
                        <div style={{ marginTop: "var(--space-sm)" }}>{renderBadge("관측", stat.tone)}</div>
                      ) : null}
                    </article>
                  ))}
                </div>
                <hr style={dividerStyle} />
                <p className={styles.serviceDesc}>{dataSection.note}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.colSpan12} id="worker-health">
        <div className={styles.briefCard}>
          <SectionTitle
            eyebrow="Section B"
            title="워커 / 파이프라인 상태"
            description="Pipeline, listener, bot, dashboard, data source를 애플리케이션 관점에서 분리해 표시하고 최근 실패 이벤트와 운영 체크를 같은 구역에 모읍니다."
          />

          <div style={sectionBodyStyle}>
            <div className={styles.serviceGrid} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
              {workerSection.services.map((service) => (
                <article key={service.key} className={styles.serviceCard}>
                  <div style={stackStyle}>
                    <div className={styles.serviceCardHeader}>
                      <h3 className={styles.serviceTitle}>{service.title}</h3>
                      {renderWorkerStatusBadge(service.status, service.tone)}
                    </div>
                    <p className={styles.serviceDesc}>{service.summary}</p>
                    <p className={styles.serviceDesc}>{service.detail}</p>
                  </div>
                  {service.action ? (
                    <a href={service.action.href} className={`${styles.serviceAction} ${styles.serviceActionSecondary}`}>
                      {service.action.label}
                    </a>
                  ) : null}
                </article>
              ))}
            </div>

            <div className={styles.timelineCard}>
              <div className={styles.serviceCardHeader}>
                <h3 className={styles.timelineCardTitle}>Job 상세 테이블</h3>
                {renderWorkerStatusBadge(
                  `${workerSection.jobRows.length.toLocaleString("ko-KR")}개 job`,
                  workerSection.jobRows.some((row) => row.tone === "bad")
                    ? "bad"
                    : workerSection.jobRows.some((row) => row.tone === "warn")
                      ? "warn"
                      : workerSection.jobRows.length > 0
                        ? "good"
                        : "neutral",
                )}
              </div>
              <p className={styles.serviceDesc} style={{ marginTop: "var(--space-sm)" }}>
                Pipeline, listener, bot, dashboard, data source를 카드보다 더 세분화해서 최근 관측 시각과 원천, 주기, 상태를 한 표에서 비교합니다.
              </p>
              {workerSection.jobRows.length > 0 ? (
                <div style={{ ...tableWrapStyle, marginTop: "var(--space-md)" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeadCellStyle}>영역</th>
                        <th style={tableHeadCellStyle}>Job</th>
                        <th style={tableHeadCellStyle}>상태</th>
                        <th style={tableHeadCellStyle}>주기</th>
                        <th style={tableHeadCellStyle}>최근 관측</th>
                        <th style={tableHeadCellStyle}>원천</th>
                        <th style={tableHeadCellStyle}>운영 메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workerSection.jobRows.map((row, index) => (
                        <tr
                          key={row.key}
                          style={{
                            background: index % 2 === 0 ? "var(--surface)" : "var(--surface-container-low)",
                          }}
                        >
                          <td style={tableCellStyle}>
                            <strong>{row.lane}</strong>
                          </td>
                          <td style={tableCellStyle}>
                            <strong>{row.job}</strong>
                          </td>
                          <td style={tableCellStyle}>{renderWorkerStatusBadge(row.status, row.tone)}</td>
                          <td style={tableCellStyle}>{row.cadence}</td>
                          <td style={tableCellStyle}>{row.observedAt}</td>
                          <td style={tableCellStyle}>{row.source}</td>
                          <td style={tableCellStyle}>
                            <span>{row.detail}</span>
                            <p style={tableSecondaryTextStyle}>색, 아이콘, 텍스트를 함께 봐야 오탐 없이 상태를 해석할 수 있습니다.</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.emptyState} style={{ marginTop: "var(--space-md)" }}>
                  <p className={styles.emptyStateTitle}>표시할 job 관측치가 없습니다.</p>
                  <p className={styles.emptyStateBody}>worker observability가 연결되면 pipeline/listener/bot/data source 상세가 여기에 표시됩니다.</p>
                </div>
              )}
            </div>

            <div style={twoColumnStyle}>
              <div className={styles.timelineCard}>
                <h3 className={styles.timelineCardTitle}>운영 진단 카드</h3>
                <div style={cardGridStyle}>
                  {workerSection.insights.map((insight) => (
                    <article key={insight.key} className={styles.serviceCard}>
                      <div className={styles.serviceCardHeader}>
                        <h4 className={styles.serviceTitle}>{insight.title}</h4>
                        {renderWorkerStatusBadge("관측", insight.tone)}
                      </div>
                      <ul style={detailListStyle}>
                        {insight.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <p className={styles.serviceDesc} style={{ marginTop: "var(--space-sm)" }}>
                        {insight.hint}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <div style={twoColumnStyle}>
                <ChecklistCard title="런타임 체크" items={workerSection.runtimeChecklist} />
                <ChecklistCard title="환경 / 연결 체크" items={workerSection.configChecklist} />
              </div>
            </div>

            <div className={styles.oplogCard} id="system-log">
              <h3 className={styles.oplogCardTitle}>최근 실패·경고 이벤트</h3>
              {workerSection.failureRows.length > 0 ? (
                <SystemLogPanel rows={workerSection.failureRows} />
              ) : (
                <div className={styles.emptyState}>
                  <p className={styles.emptyStateTitle}>최근 경고 이벤트가 없습니다.</p>
                  <p className={styles.emptyStateBody}>
                    현재 노출된 `system_log` 범위에서는 즉시 조치가 필요한 실패·경고가 보이지 않습니다.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.colSpan12} id="render-platform">
        <div className={styles.briefCard}>
          <SectionTitle
            eyebrow="Section C"
            title="Render 플랫폼 상태"
            description="Render 서비스, 배포, 인스턴스, 플랫폼 로그는 별도 계층으로 분리합니다. 현재 payload에 Render 데이터가 없으면 이 영역만 명시적으로 fallback 됩니다."
          />

          <div style={sectionBodyStyle}>
            <div className={styles.timelineCard}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <ToneDot tone={renderSection.availability === "error" ? "bad" : renderSection.availability === "available" ? "good" : "neutral"} />
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--on-surface-variant)" }}>
                  {renderSection.message}
                </p>
                {renderSection.dashboardUrl ? (
                  <a href={renderSection.dashboardUrl} target="_blank" rel="noreferrer" style={linkChipStyle}>
                    Render 대시보드
                  </a>
                ) : null}
              </div>
              <p className={styles.serviceDesc} style={{ marginTop: "var(--space-sm)" }}>
                {renderSection.note}
              </p>
            </div>

            {renderSection.availability === "available" ? (
              <>
                <div style={cardGridStyle}>
                  {renderSection.services.map((service) => (
                    <article key={service.key} className={styles.serviceCard}>
                      <div className={styles.serviceCardHeader}>
                        <div style={{ display: "grid", gap: "var(--space-2xs)" }}>
                          <p style={eyebrowStyle}>{service.kind}</p>
                          <h3 className={styles.serviceTitle}>{service.name}</h3>
                        </div>
                        {renderBadge(service.status, service.tone)}
                      </div>
                      <p className={styles.serviceDesc}>{service.detail}</p>
                      <ul style={{ ...detailListStyle, marginTop: "var(--space-sm)" }}>
                        {service.meta.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>

                <div style={twoColumnStyle}>
                  <div className={styles.timelineCard}>
                    <h3 className={styles.timelineCardTitle}>최근 배포 내역</h3>
                    {renderSection.deploys.length > 0 ? (
                      <div style={listStyle}>
                        {renderSection.deploys.map((deploy) => (
                          <div key={deploy.key} className={styles.serviceCard}>
                            <div className={styles.serviceCardHeader}>
                              <h4 className={styles.serviceTitle}>{deploy.service}</h4>
                              {renderBadge(deploy.status, deploy.tone)}
                            </div>
                            <p className={styles.serviceDesc}>{deploy.detail}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyState}>
                        <p className={styles.emptyStateTitle}>표시할 배포 내역이 없습니다.</p>
                        <p className={styles.emptyStateBody}>Render deploy payload가 연결되면 최근 3건이 여기에 표시됩니다.</p>
                      </div>
                    )}
                  </div>

                  <div className={styles.timelineCard}>
                    <h3 className={styles.timelineCardTitle}>인스턴스 상태</h3>
                    {renderSection.instances.length > 0 ? (
                      <div style={listStyle}>
                        {renderSection.instances.map((instance) => (
                          <div key={instance.key} className={styles.serviceCard}>
                            <div className={styles.serviceCardHeader}>
                              <h4 className={styles.serviceTitle}>{instance.service}</h4>
                              {renderBadge(instance.status, instance.tone)}
                            </div>
                            <p className={styles.serviceDesc}>{instance.detail}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyState}>
                        <p className={styles.emptyStateTitle}>표시할 인스턴스가 없습니다.</p>
                        <p className={styles.emptyStateBody}>Worker / cron 인스턴스 목록은 Render instance payload가 들어오면 표시됩니다.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.oplogCard}>
                  <h3 className={styles.oplogCardTitle}>최근 Render 로그</h3>
                  {renderSection.logRows.length > 0 ? (
                    <SystemLogPanel rows={renderSection.logRows} />
                  ) : (
                    <div className={styles.emptyState}>
                      <p className={styles.emptyStateTitle}>로그가 아직 없습니다.</p>
                      <p className={styles.emptyStateBody}>최근 15분 Render 로그가 연결되면 서비스별 raw 로그가 이 패널에 표시됩니다.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={cardGridStyle}>
                {renderSection.placeholders.map((placeholder) => (
                  <article key={placeholder.key} className={styles.serviceCard}>
                    <p style={eyebrowStyle}>placeholder</p>
                    <h3 className={styles.serviceTitle}>{placeholder.title}</h3>
                    <p className={styles.serviceDesc}>{placeholder.body}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={styles.colSpan12} id="correlation-summary">
        <div className={styles.briefCard}>
          <SectionTitle
            eyebrow="Section D"
            title="상관관계 / 판정"
            description="데이터 계층, 워커 계층, 플랫폼 계층을 함께 해석해 지금 무엇이 문제인지 사람 언어로 요약합니다."
          />

          <div style={sectionBodyStyle}>
            <div className={styles.timelineCard}>
              <div className={styles.serviceCardHeader}>
                <h3 className={styles.timelineCardTitle} style={{ margin: 0 }}>
                  {correlationSection.title}
                </h3>
                {renderBadge("요약", correlationSection.tone)}
              </div>
              <p style={cardBodyStyle}>{correlationSection.summary}</p>
            </div>

            <div style={twoColumnStyle}>
              <div className={styles.timelineCard}>
                <h3 className={styles.timelineCardTitle}>교차 판단</h3>
                {correlationSection.findings.length > 0 ? (
                  <div style={listStyle}>
                    {correlationSection.findings.map((finding) => (
                      <article key={finding.key} className={styles.serviceCard}>
                        <div className={styles.serviceCardHeader}>
                          <h4 className={styles.serviceTitle}>{finding.title}</h4>
                          {renderBadge("finding", finding.tone)}
                        </div>
                        <p className={styles.serviceDesc}>{finding.detail}</p>
                        {finding.action ? (
                          <a href={finding.action.href} className={`${styles.serviceAction} ${styles.serviceActionSecondary}`}>
                            {finding.action.label}
                          </a>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <p className={styles.emptyStateTitle}>현재 교차 이상 없음</p>
                    <p className={styles.emptyStateBody}>노출된 데이터 범위에서는 추가 교차 경보가 생성되지 않았습니다.</p>
                  </div>
                )}
              </div>

              <div className={styles.timelineCard}>
                <h3 className={styles.timelineCardTitle}>운영 메모</h3>
                <ul style={detailListStyle}>
                  {correlationSection.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
