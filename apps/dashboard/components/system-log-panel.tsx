"use client";

import { useEffect, useState } from "react";
import styles from "./system-log-panel.module.css";

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
    <div className={styles.emptyState}>
      <p className={styles.emptyTitle}>시스템 로그가 비어 있습니다.</p>
      <p className={styles.emptyBody}>
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
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>System log</p>
          <h2 className={styles.panelTitle}>Operational pulse</h2>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className={styles.logList}>
          {rows.slice(0, 6).map((row, index) => (
            <button
              key={row.id ?? `${row.timestamp}-${index}`}
              type="button"
              className={styles.logItem}
              onClick={() => setSelected(row)}
            >
              <div className={styles.logMeta}>
                <span
                  className={styles.severityPill}
                  data-tone={toneForStatus(row.status)}
                >
                  {row.status}
                </span>
                <time dateTime={row.timestamp}>{formatTime(row.timestamp)}</time>
              </div>
              <h3 className={styles.logItemTitle}>{row.title}</h3>
              <p className={styles.logItemDesc}>{typeof row.message === "string" ? row.message : "상세 로그 확인 필요"}</p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span
                className={styles.severityPill}
                data-tone={toneForStatus(selected.status)}
              >
                {selected.status}
              </span>
              <time dateTime={selected.timestamp}>{formatTime(selected.timestamp)}</time>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <h3 className={styles.modalTitle}>{selected.title}</h3>
            <pre className={styles.modalMessage}>
              {typeof selected.message === "string" ? selected.message : "상세 로그 확인 필요"}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
