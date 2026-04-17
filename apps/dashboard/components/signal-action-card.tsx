"use client";

import { useState } from "react";

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

  return (
    <div className={`signal-item signal-item--${props.tone}`} data-signal-id={props.signalId}>
      <div className="signal-item__top-row">
        <div className="signal-item__severity-dot">
          <span className={`signal-item__dot signal-item__dot--${props.tone}`} />
          <span className={`signal-item__severity-label signal-item__severity-label--${props.tone}`}>
            {props.severityLabel}
          </span>
        </div>
        <span className="signal-item__time">{props.timeLabel}</span>
      </div>
      <h4 className="signal-item__title">{props.title}</h4>
      <p className="signal-item__desc">{props.summary}</p>
      <div className="signal-item__meta">
        <span>Score {props.score}</span>
        <span>{props.confidenceLabel}</span>
        {badgeText ? <span className="signal-item__action-badge">{badgeText}</span> : null}
      </div>
      <div className="signal-item__actions">
        <button
          type="button"
          className="signal-item__btn signal-item__btn--primary"
          onClick={() => applyAction("acknowledge")}
          disabled={status === "saving" || status === "acknowledged"}
        >
          {status === "saving" ? "처리 중..." : "확인됨"}
        </button>
        <button
          type="button"
          className="signal-item__btn signal-item__btn--secondary"
          onClick={() => applyAction("dismiss")}
          disabled={status === "saving"}
        >
          무시
        </button>
      </div>
    </div>
  );
}
