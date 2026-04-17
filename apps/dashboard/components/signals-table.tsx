import styles from "./signals-table.module.css";

export type SignalRow = {
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

type SignalsTableProps = {
  rows: SignalRow[];
};

function toneForSeverity(severity: string) {
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

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyStateTitle}>Signals are empty.</p>
      <p className={styles.emptyStateBody}>
        LLM 브리프 이전의 규칙 기반 시그널이 아직 생성되지 않았습니다.
      </p>
    </div>
  );
}

export function SignalsTable({ rows }: SignalsTableProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Signals</p>
          <h2>Rule outputs</h2>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className={styles.tableShell}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Rule</th>
                  <th>Severity</th>
                  <th>Score</th>
                  <th>Source</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Created">{row.createdAt || "Unknown"}</td>
                    <td data-label="Rule">
                      <strong>{row.rule}</strong>
                    </td>
                    <td data-label="Severity">
                      <span
                        className={styles.severityPill}
                        data-tone={toneForSeverity(row.severity)}
                      >
                        {row.severity}
                      </span>
                    </td>
                    <td data-label="Score" className={styles.scoreCell}>{row.score.toFixed(1)}</td>
                    <td data-label="Source">{row.source}</td>
                    <td data-label="Summary">
                      <div className={styles.signalSummary}>
                        <p>{row.summary}</p>
                        {row.evidenceTxHashes.length > 0 ? (
                          <span className={styles.signalSummaryMeta}>
                            Evidence: {row.evidenceTxHashes.slice(0, 2).join(", ")}
                            {row.evidenceTxHashes.length > 2 ? "..." : ""}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.cardList}>
            {rows.map((row) => (
              <article key={`${row.id}-mobile`} className={styles.stackCard}>
                <div className={styles.stackCardTop}>
                  <div>
                    <p className={styles.stackCardLabel}>{row.createdAt || "Unknown"}</p>
                    <h3>{row.rule}</h3>
                  </div>
                  <span
                    className={styles.severityPill}
                    data-tone={toneForSeverity(row.severity)}
                  >
                    {row.severity}
                  </span>
                </div>
                <p className={styles.stackCardSummary}>{row.summary}</p>
                <dl className={styles.stackCardGrid}>
                  <div>
                    <dt>Score</dt>
                    <dd>{row.score.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{row.source}</dd>
                  </div>
                  <div className={styles.stackCardWide}>
                    <dt>Evidence</dt>
                    <dd className={styles.mono}>
                      {row.evidenceTxHashes.length > 0 ? row.evidenceTxHashes.join(", ") : "No evidence hashes"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
