"use client";

import { useEffect, useState } from "react";

export type SystemLogRow = {
  id?: string;
  timestamp: string;
  status: string;
  title: string;
  message: string;
};

type SystemLogPanelProps = {
  rows: SystemLogRow[];
};

function toneForStatus(status: string) {
  const value = status.toLowerCase();

  if (value.includes("failed") || value.includes("error")) {
    return "bad";
  }
  if (value.includes("warn") || value.includes("completed_with_errors")) {
    return "warn";
  }
  if (value.includes("completed") || value.includes("healthy")) {
    return "good";
  }
  return "neutral";
}

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "Unknown";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function EmptyState() {
  return (
    <div className="empty-state empty-state--rail">
      <p className="empty-state__title">시스템 로그가 비어 있습니다.</p>
      <p className="empty-state__body">
        최근 파이프라인 실행 또는 운영 이벤트가 기록되면 이 패널에 표시됩니다.
      </p>
    </div>
  );
}

export function SystemLogPanel({ rows }: SystemLogPanelProps) {
  const [selected, setSelected] = useState<SystemLogRow | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <section className="panel panel--log">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">System log</p>
          <h2>Operational pulse</h2>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="log-list">
          {rows.slice(0, 6).map((row, index) => (
            <button
              key={row.id ?? `${row.timestamp}-${index}`}
              type="button"
              className="log-item log-item--button"
              onClick={() => setSelected(row)}
            >
              <div className="log-item__meta">
                <span className={`severity-pill severity-pill--${toneForStatus(row.status)}`}>
                  {row.status}
                </span>
                <time dateTime={row.timestamp}>{formatTime(row.timestamp)}</time>
              </div>
              <h3>{row.title}</h3>
              <p>{typeof row.message === "string" ? row.message : "상세 로그 확인 필요"}</p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="log-modal__backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div className="log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="log-modal__header">
              <span className={`severity-pill severity-pill--${toneForStatus(selected.status)}`}>
                {selected.status}
              </span>
              <time dateTime={selected.timestamp}>{formatTime(selected.timestamp)}</time>
              <button
                type="button"
                className="log-modal__close"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <h3 className="log-modal__title">{selected.title}</h3>
            <pre className="log-modal__message">
              {typeof selected.message === "string" ? selected.message : "상세 로그 확인 필요"}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
