"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "@/app/insights/insights.module.css";
import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import { getSignalRuleDoc } from "@/lib/signal-rule-docs";

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

type SignalDetailModalProps = {
  signal: SignalLike | null;
  initialLanguage: DashboardLanguage;
  isOpen: boolean;
  onClose: () => void;
  toneLabel: string;
};

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function formatKstDateTime(value: string | undefined, fallback: string): string {
  const text = safeText(value, "");
  if (!text) {
    return fallback;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function signalEvidenceHashes(signal: SignalLike): string[] {
  if (Array.isArray(signal.evidenceTxHashes)) {
    return signal.evidenceTxHashes.filter(Boolean);
  }

  const raw = safeText(signal.evidence_tx_hashes, "");
  if (!raw) {
    return [];
  }

  return raw
    .split(/[,|\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SignalDetailModal({
  signal,
  initialLanguage,
  isOpen,
  onClose,
  toneLabel,
}: SignalDetailModalProps) {
  const { dictionary, language } = useDashboardI18n(initialLanguage);
  const [isMounted, setIsMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    setIsMounted(true);

    return () => {
      setIsMounted(false);
    };
  }, []);

  useEffect(() => {
    if (!isMounted || !isOpen) {
      return undefined;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [isMounted, isOpen, onClose]);

  if (!isMounted || !isOpen || !signal) {
    return null;
  }

  const docs = getSignalRuleDoc(safeText(signal.rule, "signal"), language);
  const detectedAt = formatKstDateTime(
    safeText(signal.windowEnd || signal.window_end || signal.createdAt || signal.created_at, ""),
    dictionary.home.timePending,
  );
  const summary = safeText(signal.narrativeAi, docs.long);
  const evidenceHashes = signalEvidenceHashes(signal);
  const relatedWallets = Array.isArray(signal.relatedWallets) ? signal.relatedWallets : [];
  const relatedAssets = Array.isArray(signal.relatedAssets) ? signal.relatedAssets : [];
  const walletSectionTitle = language === "ko" ? "관련 지갑" : "Related wallets";
  const walletSectionEmpty =
    language === "ko" ? "아직 연결된 지갑 정보가 없습니다." : "No related wallets are attached yet.";
  const assetSectionTitle = language === "ko" ? "관련 자산" : "Related assets";
  const assetSectionEmpty =
    language === "ko" ? "아직 연결된 자산 정보가 없습니다." : "No related assets are attached yet.";

  return createPortal(
    <div className={styles.signalModalBackdrop} onClick={onClose}>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.signalModal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={styles.signalModalHeader}>
          <div className={styles.signalModalHeaderCopy}>
            <p className={styles.signalModalEyebrow}>{dictionary.signals.modalEyebrow}</p>
            <h3 id={titleId} className={styles.signalModalTitle}>
              {docs.label}
            </h3>
            <p id={descriptionId} className={styles.signalModalDescription}>
              {summary}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.signalModalClose}
            onClick={onClose}
            aria-label={dictionary.signals.modalCloseLabel}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className={styles.signalModalMetaGrid}>
          <div className={styles.signalModalMetaItem}>
            <span className={styles.signalModalMetaLabel}>{dictionary.signals.modalWindowLabel}</span>
            <strong>{detectedAt}</strong>
          </div>
          <div className={styles.signalModalMetaItem}>
            <span className={styles.signalModalMetaLabel}>{dictionary.signals.modalSourceLabel}</span>
            <strong>{safeText(signal.source, dictionary.signals.modalUnknownSource)}</strong>
          </div>
          <div className={styles.signalModalMetaItem}>
            <span className={styles.signalModalMetaLabel}>{dictionary.signals.modalScoreLabel}</span>
            <strong>{safeText(signal.score, "-")}</strong>
          </div>
          <div className={styles.signalModalMetaItem}>
            <span className={styles.signalModalMetaLabel}>{dictionary.signals.modalConfidenceLabel}</span>
            <strong>{safeText(signal.confidence, "-")}</strong>
          </div>
          <div className={styles.signalModalMetaItem}>
            <span className={styles.signalModalMetaLabel}>{dictionary.signals.modalToneLabel}</span>
            <strong>{toneLabel}</strong>
          </div>
        </div>

        <div className={styles.signalModalBody}>
          <section className={styles.signalModalSection}>
            <h4>{dictionary.signals.modalRuleTitle}</h4>
            <p>{docs.long}</p>
          </section>

          <section className={styles.signalModalSection}>
            <h4>{dictionary.signals.modalActionTitle}</h4>
            <p>{docs.action}</p>
          </section>

          <section className={styles.signalModalSection}>
            <h4>{dictionary.signals.modalEvidenceTitle}</h4>
            {evidenceHashes.length > 0 ? (
              <ul className={styles.signalEvidenceList}>
                {evidenceHashes.map((hash) => (
                  <li key={hash} className={styles.signalEvidenceItem}>
                    <code>{hash}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{dictionary.signals.modalEvidenceEmpty}</p>
            )}
          </section>

          <section className={styles.signalModalSection}>
            <h4>{walletSectionTitle}</h4>
            {relatedWallets.length > 0 ? (
              <div className={styles.signalChipRow}>
                {relatedWallets.map((wallet) => {
                  const address = safeText(wallet.address, "");
                  const shortAddress =
                    address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
                  const text = [
                    safeText(wallet.label, shortAddress),
                    safeText(wallet.chain, ""),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <span key={`${address}-${wallet.chain ?? ""}`} className={styles.signalChip}>
                      {text || shortAddress}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p>{walletSectionEmpty}</p>
            )}
          </section>

          <section className={styles.signalModalSection}>
            <h4>{assetSectionTitle}</h4>
            {relatedAssets.length > 0 ? (
              <div className={styles.signalChipRow}>
                {relatedAssets.map((asset, index) => (
                  <span
                    key={`${asset.symbol}-${asset.direction ?? "neutral"}-${index}`}
                    className={styles.signalChip}
                    data-tone={
                      asset.direction === "out" || asset.direction === "sell"
                        ? "negative"
                        : asset.direction === "in" || asset.direction === "buy"
                          ? "positive"
                          : undefined
                    }
                  >
                    {[safeText(asset.symbol, ""), safeText(asset.direction, "")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ))}
              </div>
            ) : (
              <p>{assetSectionEmpty}</p>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
