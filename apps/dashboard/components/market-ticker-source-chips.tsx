"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketTickerSourceStatus } from "@/lib/market-ticker";

import styles from "./market-ticker-source-chips.module.css";

export type MarketTickerChipStatus = MarketTickerSourceStatus;

export type MarketTickerSourceChip = {
  id: string;
  label: string;
  status: MarketTickerChipStatus;
  lastSeenAt: number | null;
  expectedIntervalMs: number;
  originSummary: string;
  statusSummary: string;
  metaLines: string[];
};

type MarketTickerSourceChipsProps = {
  sources: MarketTickerSourceChip[];
  ariaLabel?: string;
  statusLabels?: Partial<Record<MarketTickerChipStatus, string>>;
};

function statusLabel(
  status: MarketTickerChipStatus,
  statusLabels?: Partial<Record<MarketTickerChipStatus, string>>,
): string {
  const override = statusLabels?.[status];
  if (override) {
    return override;
  }
  if (status === "connecting") {
    return "연결 중";
  }
  if (status === "live") {
    return "실시간";
  }
  if (status === "stale") {
    return "지연";
  }
  return "중단";
}

export function MarketTickerSourceChips({
  sources,
  ariaLabel = "시장 데이터 소스 상태",
  statusLabels,
}: MarketTickerSourceChipsProps) {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeSourceId) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!containerRef.current?.contains(event.target)) {
        setActiveSourceId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveSourceId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeSourceId]);

  return (
    <div ref={containerRef} className={styles.list} aria-label={ariaLabel} role="list">
      {sources.map((source) => (
        <div
          key={source.id}
          className={styles.item}
          role="listitem"
          onMouseEnter={() => setActiveSourceId(source.id)}
          onMouseLeave={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setActiveSourceId((current) => (current === source.id ? null : current));
            }
          }}
          onFocus={() => setActiveSourceId(source.id)}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setActiveSourceId((current) => (current === source.id ? null : current));
            }
          }}
        >
          <button
            type="button"
            className={styles.chip}
            data-state={source.status}
            aria-expanded={activeSourceId === source.id}
            aria-describedby={
              activeSourceId === source.id ? `market-ticker-source-tooltip-${source.id}` : undefined
            }
            onClick={() =>
              setActiveSourceId((current) => (current === source.id ? null : source.id))
            }
          >
            <span className={styles.dot} aria-hidden="true" />
            <span>{source.label}</span>
            <span className={styles.status}>{statusLabel(source.status, statusLabels)}</span>
          </button>

          {activeSourceId === source.id ? (
            <div
              id={`market-ticker-source-tooltip-${source.id}`}
              className={styles.tooltip}
              role="tooltip"
            >
              <div className={styles.tooltipHeader}>
                <strong className={styles.tooltipTitle}>{source.label}</strong>
                <span className={styles.tooltipStatus}>
                  {statusLabel(source.status, statusLabels)}
                </span>
              </div>
              <p className={styles.tooltipSummary}>{source.originSummary}</p>
              <p className={styles.tooltipBody}>{source.statusSummary}</p>
              <ul className={styles.tooltipMeta}>
                {source.metaLines.map((line) => (
                  <li key={`${source.id}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
