export default function Loading() {
  return (
    <main className="dashboard-page">
      <div className="dashboard-page__backdrop dashboard-page__backdrop--left" />
      <div className="dashboard-page__backdrop dashboard-page__backdrop--right" />

      <div className="dashboard-shell">
        <header className="hero-panel panel">
          <div className="skeleton skeleton--line skeleton--eyebrow" />
          <div className="skeleton skeleton--line skeleton--title" />
          <div className="skeleton skeleton--line skeleton--copy" />
          <div className="skeleton-row">
            <div className="skeleton skeleton--chip" />
            <div className="skeleton skeleton--chip" />
            <div className="skeleton skeleton--chip" />
          </div>
        </header>

        <section className="metric-grid" aria-label="Loading metrics">
          {Array.from({ length: 5 }).map((_, index) => (
            <article key={index} className="metric-card metric-card--neutral">
              <div className="skeleton skeleton--line skeleton--metric-label" />
              <div className="skeleton skeleton--line skeleton--metric-value" />
              <div className="skeleton skeleton--line skeleton--metric-hint" />
            </article>
          ))}
        </section>

        <section className="dashboard-grid dashboard-grid--primary">
          <div className="dashboard-grid__main">
            <div className="panel">
              <div className="skeleton skeleton--line skeleton--section-title" />
              <div className="skeleton skeleton--line skeleton--section-copy" />
              <div className="skeleton-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="skeleton skeleton--card" />
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="skeleton skeleton--line skeleton--section-title" />
              <div className="skeleton-table">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="skeleton skeleton--table-row" />
                ))}
              </div>
            </div>
          </div>
          <aside className="dashboard-grid__rail">
            <div className="panel">
              <div className="skeleton skeleton--line skeleton--section-title" />
              <div className="skeleton-table">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="skeleton skeleton--table-row" />
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="skeleton skeleton--line skeleton--section-title" />
              <div className="skeleton-table">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="skeleton skeleton--table-row" />
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
