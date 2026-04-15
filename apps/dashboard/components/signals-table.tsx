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
    <div className="empty-state empty-state--rail">
      <p className="empty-state__title">Signals are empty.</p>
      <p className="empty-state__body">
        LLM 브리프 이전의 규칙 기반 시그널이 아직 생성되지 않았습니다.
      </p>
    </div>
  );
}

export function SignalsTable({ rows }: SignalsTableProps) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Signals</p>
          <h2>Rule outputs</h2>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="table-shell">
            <table className="data-table data-table--signals">
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
                      <span className={`severity-pill severity-pill--${toneForSeverity(row.severity)}`}>
                        {row.severity}
                      </span>
                    </td>
                    <td data-label="Score">{row.score.toFixed(1)}</td>
                    <td data-label="Source">{row.source}</td>
                    <td data-label="Summary">
                      <div className="signal-summary">
                        <p>{row.summary}</p>
                        {row.evidenceTxHashes.length > 0 ? (
                          <span className="signal-summary__meta">
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

          <div className="card-list">
            {rows.map((row) => (
              <article key={`${row.id}-mobile`} className="stack-card stack-card--signal">
                <div className="stack-card__top">
                  <div>
                    <p className="stack-card__label">{row.createdAt || "Unknown"}</p>
                    <h3>{row.rule}</h3>
                  </div>
                  <span className={`severity-pill severity-pill--${toneForSeverity(row.severity)}`}>
                    {row.severity}
                  </span>
                </div>
                <p className="stack-card__summary">{row.summary}</p>
                <dl className="stack-card__grid">
                  <div>
                    <dt>Score</dt>
                    <dd>{row.score.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{row.source}</dd>
                  </div>
                  <div className="stack-card__wide">
                    <dt>Evidence</dt>
                    <dd className="mono">
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
