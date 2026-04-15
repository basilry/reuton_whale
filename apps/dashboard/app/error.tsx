"use client";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  return (
    <main className="dashboard-page">
      <div className="dashboard-shell dashboard-shell--error">
        <section className="panel error-panel">
          <p className="panel__eyebrow">Dashboard error</p>
          <h1>대시보드를 불러오지 못했습니다.</h1>
          <p className="error-panel__message">
            {error.message || "알 수 없는 오류가 발생했습니다."}
          </p>
          {error.digest ? (
            <p className="error-panel__digest">Digest: {error.digest}</p>
          ) : null}
          <button type="button" className="primary-button" onClick={reset}>
            Retry
          </button>
        </section>
      </div>
    </main>
  );
}
