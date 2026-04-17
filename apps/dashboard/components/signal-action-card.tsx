"use client";

import { useState } from "react";
import styles from "./signal-action-card.module.css";

// Status kept in-component (ephemeral). The PATCH response body is
// ignored beyond its `ok` flag — the API is non-persistent by design for this
// demo (see /api/signals/[id]/route.ts for the in-memory store).
type CardStatus = "idle" | "saving" | "acknowledged" | "dismissed" | "error";

export type SignalActionCardProps = {
  signalId: string;
  createdAt: string;
  title: string;
  summary: string;
  severityLabel: string;
  confidenceLabel: string;
  score: string | number;
  tone: string;
  timeLabel: string;
};

export function SignalActionCard(props: SignalActionCardProps) {
  const [status, setStatus] = useState<CardStatus>("idle");

  async function applyAction(action: "acknowledge" | "dismiss") {
    // Guard: never start a second request while one is in flight.
    if (status === "saving") return;
    setStatus("saving");
    try {
      const res = await fetch(`/api/signals/${encodeURIComponent(props.signalId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus(action === "acknowledge" ? "acknowledged" : "dismissed");
    } catch {
      setStatus("error");
    }
  }

  if (status === "dismissed") {
    return null;
  }

  const badgeText =
    status === "acknowledged"
      ? "확인됨"
      : status === "error"
        ? "처리 실패"
        : null;

  const validTones = ["good", "warn", "bad", "neutral"] as const;
  const tone = validTones.includes(props.tone as (typeof validTones)[number])
    ? props.tone
    : "neutral";

  return (
    <div
      className={styles.card}
      data-tone={tone}
      data-status={status}
      data-signal-id={props.signalId}
    >
      <div className={styles.topRow}>
        <div className={styles.severityDot}>
          <span className={styles.dot} />
          <span className={styles.severityLabel}>
            {props.severityLabel}
          </span>
        </div>
        <span className={styles.time}>{props.timeLabel}</span>
      </div>
      <h4 className={styles.title}>{props.title}</h4>
      <p className={styles.desc}>{props.summary}</p>
      <div className={styles.meta}>
        <span>Score {props.score}</span>
        <span>{props.confidenceLabel}</span>
        {badgeText ? <span className={styles.actionBadge}>{badgeText}</span> : null}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => applyAction("acknowledge")}
          disabled={status === "saving" || status === "acknowledged"}
        >
          {status === "saving" ? "처리 중..." : "확인됨"}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={() => applyAction("dismiss")}
          disabled={status === "saving"}
        >
          무시
        </button>
      </div>
    </div>
  );
}
