export type TransactionRow = {
  id: string;
  timestamp: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: string;
  to: string;
  chain: string;
  hash: string;
  direction?: string;
};

type TransactionsTableProps = {
  rows: TransactionRow[];
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value || 0);
}

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "Unknown";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function EmptyState() {
  return (
    <div className="empty-state empty-state--table">
      <p className="empty-state__title">최근 거래가 아직 없습니다.</p>
      <p className="empty-state__body">
        파이프라인 실행 후 Google Sheets의 transactions 시트가 채워지면 이 표에 최신 거래가 나타납니다.
      </p>
    </div>
  );
}

export function TransactionsTable({ rows }: TransactionsTableProps) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Recent transactions</p>
          <h2>Latest whale movement</h2>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Asset</th>
                  <th>Amount</th>
                  <th>USD</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Chain</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Time">{formatTime(row.timestamp)}</td>
                    <td data-label="Asset">
                      <span className="table-chip">{row.symbol}</span>
                    </td>
                    <td data-label="Amount">{formatNumber(row.amount)}</td>
                    <td data-label="USD">{formatUsd(row.amountUsd)}</td>
                    <td data-label="From">
                      <span className="mono">{row.from}</span>
                    </td>
                    <td data-label="To">
                      <span className="mono">{row.to}</span>
                    </td>
                    <td data-label="Chain">{row.chain}</td>
                    <td data-label="Hash">
                      <span className="mono mono--truncate">{row.hash}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-list">
            {rows.map((row) => (
              <article key={`${row.id}-mobile`} className="stack-card">
                <div className="stack-card__top">
                  <div>
                    <p className="stack-card__label">{formatTime(row.timestamp)}</p>
                    <h3>{row.symbol}</h3>
                  </div>
                  <span className="table-chip">{row.chain}</span>
                </div>
                <dl className="stack-card__grid">
                  <div>
                    <dt>Amount</dt>
                    <dd>{formatNumber(row.amount)}</dd>
                  </div>
                  <div>
                    <dt>USD</dt>
                    <dd>{formatUsd(row.amountUsd)}</dd>
                  </div>
                  <div>
                    <dt>From</dt>
                    <dd className="mono">{row.from}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd className="mono">{row.to}</dd>
                  </div>
                </dl>
                <p className="stack-card__hash mono">{row.hash}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
