"use client";

import { useMemo, type ReactNode } from "react";
import { formatDashboardMessage } from "@/lib/i18n/get-dictionary";
import type { FearGreedClassification, FearGreedData, FearGreedSnapshot } from "@/lib/fear-greed";
import { useDashboardI18n } from "@/lib/i18n/client";
import styles from "./fear-greed-gauge.module.css";

type FearGreedGaugeCopy = {
  title: string;
  subtitle: string;
  classificationLabels: Record<FearGreedClassification, string>;
  compareLabels: {
    yesterday: string;
    week: string;
    month: string;
  };
  nextUpdateLabel: string;
  nextUpdateValue: string;
  nextUpdateUnavailable: string;
  sourceLabel: string;
  staleWarning: string;
  ariaLabel: string;
  disclaimer: string;
};

type FearGreedGaugeProps = {
  data: FearGreedData | null;
  fallback: ReactNode;
  language: "ko" | "en";
  copy: FearGreedGaugeCopy;
};

const SEMICIRCLE_PATH = "M 40 160 A 120 120 0 0 1 280 160";
const SEGMENTS = [
  { start: 0, end: 24, tone: "extreme_fear" },
  { start: 24, end: 49, tone: "fear" },
  { start: 49, end: 51, tone: "neutral" },
  { start: 51, end: 74, tone: "greed" },
  { start: 74, end: 100, tone: "extreme_greed" },
] as const satisfies ReadonlyArray<{
  start: number;
  end: number;
  tone: FearGreedClassification;
}>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSignedDelta(current: number, snapshot?: FearGreedSnapshot): number | null {
  if (!snapshot) {
    return null;
  }
  return current - snapshot.value;
}

function formatSignedDelta(value: number | null): string {
  if (value == null || value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatRelativeNextUpdate(
  seconds: number | null,
  language: "ko" | "en",
  pattern: string,
  fallback: string,
): string {
  if (seconds == null) {
    return fallback;
  }

  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (language === "ko") {
    return formatDashboardMessage(pattern, {
      hours,
      minutes,
    });
  }

  const hourLabel = hours === 1 ? "hour" : "hours";
  const minuteLabel = minutes === 1 ? "minute" : "minutes";
  return `${hours} ${hourLabel} ${minutes} ${minuteLabel}`;
}

function buildComparisonValue(
  label: string,
  currentValue: number,
  snapshot: FearGreedSnapshot | undefined,
): { label: string; value: string; delta: string | null } {
  if (!snapshot) {
    return {
      label,
      value: "--",
      delta: null,
    };
  }

  return {
    label,
    value: String(snapshot.value),
    delta: formatSignedDelta(getSignedDelta(currentValue, snapshot)),
  };
}

export function FearGreedGauge({ data, fallback, language, copy }: FearGreedGaugeProps) {
  const { dictionary, language: currentLanguage } = useDashboardI18n(language);
  const runtimeCopy = useMemo<FearGreedGaugeCopy>(
    () => ({
      title: dictionary.home.fearGreedTitle,
      subtitle: dictionary.home.fearGreedSubtitle,
      classificationLabels: {
        extreme_fear: dictionary.home.fearGreedClassificationExtremeFear,
        fear: dictionary.home.fearGreedClassificationFear,
        neutral: dictionary.home.fearGreedClassificationNeutral,
        greed: dictionary.home.fearGreedClassificationGreed,
        extreme_greed: dictionary.home.fearGreedClassificationExtremeGreed,
      },
      compareLabels: {
        yesterday: dictionary.home.fearGreedCompareYesterday,
        week: dictionary.home.fearGreedCompareWeek,
        month: dictionary.home.fearGreedCompareMonth,
      },
      nextUpdateLabel: dictionary.home.fearGreedNextUpdateLabel,
      nextUpdateValue: dictionary.home.fearGreedNextUpdateValue,
      nextUpdateUnavailable: dictionary.home.fearGreedNextUpdateUnavailable,
      sourceLabel: dictionary.home.fearGreedSourceLabel,
      staleWarning: dictionary.home.fearGreedStaleWarning,
      ariaLabel: dictionary.home.fearGreedAriaLabel,
      disclaimer: dictionary.home.fearGreedDisclaimer,
    }),
    [dictionary],
  );
  const activeCopy = runtimeCopy ?? copy;

  if (!data) {
    return (
      <section className={styles.card}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{activeCopy.title}</p>
          <p className={styles.subtitle}>{activeCopy.subtitle}</p>
        </header>
        <div className={styles.fallback}>{fallback}</div>
      </section>
    );
  }

  const currentValue = clamp(data.current.value, 0, 100);
  const classificationLabel = activeCopy.classificationLabels[data.current.classification];
  const progress = Math.max(currentValue, 0.0001);
  const needleRotation = currentValue * 1.8 - 90;
  const comparisons = [
    buildComparisonValue(activeCopy.compareLabels.yesterday, currentValue, data.yesterday),
    buildComparisonValue(activeCopy.compareLabels.week, currentValue, data.weekAgo),
    buildComparisonValue(activeCopy.compareLabels.month, currentValue, data.monthAgo),
  ];
  const ariaLabel = formatDashboardMessage(activeCopy.ariaLabel, {
    value: currentValue,
    classification: classificationLabel,
    delta_yesterday: formatSignedDelta(getSignedDelta(currentValue, data.yesterday)),
    delta_week: formatSignedDelta(getSignedDelta(currentValue, data.weekAgo)),
  });
  const nextUpdateLabel = formatRelativeNextUpdate(
    data.nextUpdateInSeconds,
    currentLanguage,
    activeCopy.nextUpdateValue,
    activeCopy.nextUpdateUnavailable,
  );

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{activeCopy.title}</p>
        <p className={styles.subtitle}>{activeCopy.subtitle}</p>
      </header>

      <div className={styles.gaugeFrame}>
        <svg
          aria-label={ariaLabel}
          className={styles.gauge}
          role="img"
          viewBox="0 0 320 220"
        >
          <path className={styles.track} d={SEMICIRCLE_PATH} pathLength={100} />
          {SEGMENTS.map((segment) => (
            <path
              key={`${segment.tone}-${segment.start}`}
              className={styles.segment}
              d={SEMICIRCLE_PATH}
              data-tone={segment.tone}
              pathLength={100}
              strokeDasharray={`${segment.end - segment.start} ${100 - (segment.end - segment.start)}`}
              strokeDashoffset={-segment.start}
            />
          ))}
          <path
            className={styles.progress}
            d={SEMICIRCLE_PATH}
            data-tone={data.current.classification}
            pathLength={100}
            strokeDasharray={`${progress} ${100 - progress}`}
          />
          <line
            className={styles.needle}
            data-tone={data.current.classification}
            style={{ transform: `rotate(${needleRotation}deg)` }}
            x1="160"
            x2="160"
            y1="160"
            y2="58"
          />
          <circle className={styles.hub} cx="160" cy="160" r="9" />
          <text className={styles.value} x="160" y="112">
            {currentValue}
          </text>
          <text className={styles.classification} x="160" y="138">
            {classificationLabel}
          </text>
        </svg>

        <div className={styles.compareGrid}>
          {comparisons.map((item) => (
            <div key={item.label} className={styles.compareItem}>
              <span className={styles.compareLabel}>{item.label}</span>
              <strong className={styles.compareValue}>{item.value}</strong>
              {item.delta ? <span className={styles.compareDelta}>{item.delta}</span> : null}
            </div>
          ))}
        </div>

        <div className={styles.meta}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>{activeCopy.nextUpdateLabel}</span>
            <span className={styles.metaValue}>{nextUpdateLabel}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>{activeCopy.sourceLabel}</span>
            <a
              className={styles.sourceLink}
              href={data.sourceUrl}
              rel="noreferrer noopener"
              target="_blank"
            >
              Alternative.me
            </a>
          </div>
        </div>

        {data.isStale ? <div className={styles.warning}>{activeCopy.staleWarning}</div> : null}
        <p className={styles.disclaimer}>{activeCopy.disclaimer}</p>
      </div>
    </section>
  );
}
