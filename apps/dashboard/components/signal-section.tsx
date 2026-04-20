"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import styles from "@/app/insights/insights.module.css";
import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import { formatDashboardMessage } from "@/lib/i18n/get-dictionary";
import { getSignalRuleDoc } from "@/lib/signal-rule-docs";

const SignalDetailModal = dynamic(
  () => import("./signal-detail-modal").then((mod) => mod.SignalDetailModal),
  { ssr: false, loading: () => null },
);

type SignalTone = "critical" | "watch" | "positive" | "neutral";

type SignalLike = {
  signal_id?: string;
  id?: string;
  created_at?: string;
  createdAt?: string;
  rule?: string;
  severity?: string;
  score?: string | number;
  confidence?: string;
  source?: string;
  summary?: string;
  evidence_tx_hashes?: string;
  evidenceTxHashes?: string[];
  window_start?: string;
  windowStart?: string;
  window_end?: string;
  windowEnd?: string;
  narrativeAi?: string;
  relatedWallets?: Array<{
    address: string;
    label?: string;
    chain?: string;
  }>;
  relatedAssets?: Array<{
    symbol: string;
    direction?: string;
  }>;
};

type SignalSectionProps = {
  initialLanguage: DashboardLanguage;
  signals: SignalLike[];
};

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function getSignalTone(severity: string, score: number): SignalTone {
  const normalized = severity.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("high") || score >= 80) {
    return "critical";
  }
  if (normalized.includes("medium") || normalized.includes("watch") || score >= 50) {
    return "watch";
  }
  if (normalized.includes("positive") || normalized.includes("accum")) {
    return "positive";
  }
  return "neutral";
}

function toneLabel(tone: SignalTone, dictionary: ReturnType<typeof useDashboardI18n>["dictionary"]): string {
  switch (tone) {
    case "critical":
      return dictionary.signals.toneCritical;
    case "watch":
      return dictionary.signals.toneWatch;
    case "positive":
      return dictionary.signals.tonePositive;
    default:
      return dictionary.signals.toneNeutral;
  }
}

function narrativeCopy(
  label: string,
  tone: SignalTone,
  dictionary: ReturnType<typeof useDashboardI18n>["dictionary"],
): string {
  switch (tone) {
    case "critical":
      return formatDashboardMessage(dictionary.signals.signalDetectedStrong, { label });
    case "watch":
      return formatDashboardMessage(dictionary.signals.signalDetectedWatch, { label });
    default:
      return formatDashboardMessage(dictionary.signals.signalDetectedNeutral, { label });
  }
}

export function SignalSection({ initialLanguage, signals }: SignalSectionProps) {
  const { dictionary, language } = useDashboardI18n(initialLanguage);
  const [activeSignalId, setActiveSignalId] = useState<string | null>(null);

  const activeSignal = useMemo(
    () =>
      signals.find((item) => safeText(item.id || item.signal_id, "") === activeSignalId) ?? null,
    [activeSignalId, signals],
  );

  const signalIcons: Record<SignalTone, string> = {
    critical: "trending_up",
    watch: "waves",
    positive: "cognition",
    neutral: "sensors",
  };

  return (
    <>
      <div className={styles.signalSection} id="signals">
        <h3 className={styles.signalSectionTitle}>{dictionary.home.signalsTitle}</h3>
        <div className={styles.signalGrid}>
          {signals.length > 0 ? (
            signals.slice(0, 3).map((signal, index) => {
              const tone = getSignalTone(safeText(signal.severity, ""), safeNumber(signal.score));
              const docs = getSignalRuleDoc(safeText(signal.rule, "signal"), language);
              const label = docs.label;
              const signalId = safeText(signal.id || signal.signal_id, String(index));

              return (
                <article key={signalId} className={styles.signalCard} data-tone={tone}>
                  <div className={styles.signalCardTop}>
                    <span className={styles.materialIcon} style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                      {signalIcons[tone]}
                    </span>
                    <span className={styles.signalToneBadge}>{toneLabel(tone, dictionary)}</span>
                  </div>
                  <h4 className={styles.signalCardTitle}>{label}</h4>
                  <p className={styles.signalCardDesc}>{narrativeCopy(label, tone, dictionary)}</p>
                  <button
                    type="button"
                    className={styles.signalCardLink}
                    onClick={() => setActiveSignalId(signalId)}
                  >
                    {dictionary.signals.cardCtaOpenDetail} →
                  </button>
                </article>
              );
            })
          ) : (
            <article className={styles.emptyCard}>
              <h4>{dictionary.signals.emptyTitle}</h4>
              <p>{dictionary.signals.emptyBody}</p>
            </article>
          )}
        </div>
      </div>

      <SignalDetailModal
        signal={activeSignal}
        initialLanguage={initialLanguage}
        isOpen={Boolean(activeSignal)}
        onClose={() => setActiveSignalId(null)}
        toneLabel={
          activeSignal
            ? toneLabel(
                getSignalTone(
                  safeText(activeSignal.severity, ""),
                  safeNumber(activeSignal.score),
                ),
                dictionary,
              )
            : dictionary.signals.toneNeutral
        }
      />
    </>
  );
}
