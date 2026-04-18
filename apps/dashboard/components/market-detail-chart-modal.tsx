"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { MarketTickerDefinition, MarketTickerItem } from "@/lib/market-ticker";

import { MarketDetailChart } from "./market-detail-chart";
import styles from "./market-detail-chart-modal.module.css";

type MarketDetailChartModalProps = {
  definition: MarketTickerDefinition | null;
  item: MarketTickerItem | null;
  isOpen: boolean;
  onClose: () => void;
};

export function MarketDetailChartModal({
  definition,
  item,
  isOpen,
  onClose,
}: MarketDetailChartModalProps) {
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

  if (!isMounted || !isOpen || !definition || !item) {
    return null;
  }

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
            <p className={styles.eyebrow}>Market Detail</p>
            <h3 id={titleId} className={styles.title}>
              {item.asset} 상세 차트
            </h3>
            <p id={descriptionId} className={styles.description}>
              Binance USD, Upbit KRW 기준 가격 흐름과 김치 프리미엄을 한 번에 확인합니다.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={`${item.asset} 상세 차트 닫기`}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className={styles.content}>
          <MarketDetailChart definition={definition} item={item} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
