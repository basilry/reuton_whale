"use client";

import styles from "./market-ticker-source-chips.module.css";

export type MarketTickerChipStatus = "connecting" | "live" | "stale" | "down";

export type MarketTickerSourceChip = {
  id: string;
  label: string;
  status: MarketTickerChipStatus;
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
  return (
    <div className={styles.list} aria-label={ariaLabel} role="list">
      {sources.map((source) => (
        <span
          key={source.id}
          className={styles.chip}
          data-state={source.status}
          role="listitem"
        >
          <span className={styles.dot} aria-hidden="true" />
          <span>{source.label}</span>
          <span className={styles.status}>{statusLabel(source.status, statusLabels)}</span>
        </span>
      ))}
    </div>
  );
}
