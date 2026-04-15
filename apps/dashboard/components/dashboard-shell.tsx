import type { ReactNode } from "react";

import { RunStatusBadge } from "@/components/run-status-badge";

type DashboardShellProps = {
  title: string;
  subtitle: string;
  description: string;
  generatedAt: string;
  source: string;
  sourceState: "connected" | "fallback";
  latestRun: {
    status: string;
    message: string;
    errorCount: number;
    updatedAt: string;
  };
  children: ReactNode;
};

function formatDisplayTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function DashboardShell({
  title,
  subtitle,
  description,
  generatedAt,
  source,
  sourceState,
  latestRun,
  children,
}: DashboardShellProps) {
  return (
    <main className="dashboard-page">
      <div className="dashboard-page__backdrop dashboard-page__backdrop--left" />
      <div className="dashboard-page__backdrop dashboard-page__backdrop--right" />

      <div className="dashboard-shell">
        <header className="hero-panel panel">
          <div className="hero-panel__eyebrow-row">
            <p className="eyebrow">WhaleScope / Next.js dashboard</p>
            <div className="hero-panel__status-group">
              <span className={`source-pill source-pill--${sourceState}`}>
                {sourceState === "connected" ? "Sheets connected" : "Fallback preview"}
              </span>
              <RunStatusBadge status={latestRun.status} compact />
            </div>
          </div>

          <div className="hero-panel__copy">
            <div className="hero-panel__title-group">
              <h1>{title}</h1>
              <p className="hero-panel__subtitle">{subtitle}</p>
            </div>

            <div className="hero-panel__meta">
              <div className="meta-chip">
                <span className="meta-chip__label">Source</span>
                <strong>{source}</strong>
              </div>
              <div className="meta-chip">
                <span className="meta-chip__label">Last render</span>
                <strong>{formatDisplayTime(generatedAt)}</strong>
              </div>
              <div className="meta-chip">
                <span className="meta-chip__label">Latest run</span>
                <strong>{formatDisplayTime(latestRun.updatedAt)}</strong>
              </div>
            </div>
          </div>

          <p className="hero-panel__description">{description}</p>
          <p className="hero-panel__note">
            {latestRun.message}
            {latestRun.errorCount > 0 ? ` (${latestRun.errorCount} error${latestRun.errorCount === 1 ? "" : "s"})` : ""}
          </p>
        </header>

        {children}
      </div>
    </main>
  );
}
