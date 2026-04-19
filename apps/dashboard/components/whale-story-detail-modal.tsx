"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatStoryTimestamp } from "@/lib/story-time";
import type { WhaleStory, WhaleStoryParticipant } from "@/lib/types";
import styles from "./whale-story-detail-modal.module.css";

type WhaleStoryDetailModalProps = {
  story: WhaleStory | null;
  isOpen: boolean;
  onClose: () => void;
};

function formatUsd(value?: number): string {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return "규모 미상";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value);
}

function formatTokenAmount(value?: number, symbol?: string): string {
  const asset = symbol?.trim() || "자산 미상";
  if (!Number.isFinite(value) || !value || value <= 0) {
    return asset;
  }

  const absolute = Math.abs(value);
  const maximumFractionDigits =
    absolute >= 1_000 ? 0 : absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : 6;

  return `${new Intl.NumberFormat("en-US", {
    notation: absolute >= 100_000 ? "compact" : "standard",
    maximumFractionDigits,
  }).format(value)} ${asset}`;
}

function humanizeChain(value?: string): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "체인 미상";
  }
  if (normalized === "eth" || normalized === "ethereum") {
    return "Ethereum";
  }
  if (normalized === "sol" || normalized === "solana") {
    return "Solana";
  }
  if (normalized === "btc" || normalized === "bitcoin") {
    return "Bitcoin";
  }
  return value ?? "체인 미상";
}

function roleLabel(role: WhaleStoryParticipant["role"]): string {
  return role === "from" ? "보낸 쪽" : "받은 쪽";
}

function truncateHash(value?: string): string {
  if (!value) {
    return "해시 미상";
  }
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function participantBadges(participant: WhaleStoryParticipant): string[] {
  const badges: string[] = [];
  if (participant.curatedWallet?.category) {
    badges.push(`카테고리 ${participant.curatedWallet.category}`);
  }
  if (participant.curatedWallet?.grade) {
    badges.push(`등급 ${participant.curatedWallet.grade}`);
  }
  if (participant.curatedWallet?.chain) {
    badges.push(humanizeChain(participant.curatedWallet.chain));
  }
  if (participant.curatedWallet?.matchReason) {
    badges.push(`매칭 ${participant.curatedWallet.matchReason}`);
  }
  return badges;
}

export function WhaleStoryDetailModal({
  story,
  isOpen,
  onClose,
}: WhaleStoryDetailModalProps) {
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

  if (!isMounted || !isOpen || !story) {
    return null;
  }

  const participants = Array.isArray(story.participants) ? story.participants : [];
  const fromParticipant = participants.find((participant) => participant.role === "from") ?? null;
  const toParticipant = participants.find((participant) => participant.role === "to") ?? null;
  const signalCount = story.supportingSignalIds.length;
  const facts = [
    story.symbol ? `자산 ${story.symbol}` : "",
    story.amountToken ? `수량 ${formatTokenAmount(story.amountToken, story.symbol)}` : "",
    story.amountUsd ? `USD 기준 ${formatUsd(story.amountUsd)}` : "",
    story.counterpartyNote ?? "",
  ].filter(Boolean);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>Whale Story Detail</p>
            <h3 id={titleId} className={styles.title}>
              {story.title}
            </h3>
            <p id={descriptionId} className={styles.description}>
              {story.body}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="고래 스토리 상세 닫기"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>체인</span>
            <strong className={styles.metaValue}>{humanizeChain(story.chain)}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>발생 시각</span>
            <strong className={styles.metaValue}>
              {story.occurredAt ? formatStoryTimestamp(story.occurredAt) : story.meta || "시간 미상"}
            </strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>자산 규모</span>
            <strong className={styles.metaValue}>
              {formatTokenAmount(story.amountToken, story.symbol)}
            </strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>USD 환산</span>
            <strong className={styles.metaValue}>{formatUsd(story.amountUsd)}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>연결 시그널</span>
            <strong className={styles.metaValue}>
              {signalCount > 0 ? `${signalCount}건` : "없음"}
            </strong>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.column}>
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>이동 경로</h4>
              <div className={styles.participantGrid}>
                {[fromParticipant, toParticipant].map((participant) =>
                  participant ? (
                    <article
                      key={`${participant.role}-${participant.address ?? participant.label}`}
                      className={styles.participantCard}
                    >
                      <span className={styles.participantRole}>{roleLabel(participant.role)}</span>
                      <p className={styles.participantLabel}>{participant.label}</p>
                      <p className={styles.participantAddress}>
                        {participant.address ?? "주소 미상"}
                      </p>
                      {participantBadges(participant).length > 0 ? (
                        <div className={styles.participantBadgeRow}>
                          {participantBadges(participant).map((badge) => (
                            <span key={badge} className={styles.participantBadge}>
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ) : null,
                )}
              </div>
            </section>

            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>스토리 팩트</h4>
              {facts.length > 0 ? (
                <ul className={styles.factList}>
                  {facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.sectionText}>추가로 확정된 정량 정보가 아직 없습니다.</p>
              )}
            </section>
          </div>

          <div className={styles.column}>
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>해시 및 탐색</h4>
              <p className={styles.sectionText}>{story.hash ? truncateHash(story.hash) : "해시 미상"}</p>
              {story.hash ? <p className={styles.participantAddress}>{story.hash}</p> : null}
              {story.explorerUrl ? (
                <a
                  className={styles.linkAction}
                  href={story.explorerUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  익스플로러에서 열기
                </a>
              ) : (
                <p className={styles.sectionText}>현재 체인용 탐색기 링크를 만들지 못했습니다.</p>
              )}
            </section>

            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>연결된 시그널</h4>
              {signalCount > 0 ? (
                <ul className={styles.signalList}>
                  {story.supportingSignalIds.map((signalId) => (
                    <li key={signalId}>
                      <span className={styles.signalId}>{signalId}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.sectionText}>
                  직접 연결된 시그널은 아직 없고, 거래 자체 설명만 표시합니다.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
