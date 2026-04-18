"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import type { MarketTickerDefinition, MarketTickerItem } from "@/lib/market-ticker";

import { MarketDetailChart } from "./market-detail-chart";
import styles from "./market-detail-chart-modal.module.css";

type MarketDetailChartModalProps = {
  definition: MarketTickerDefinition | null;
  item: MarketTickerItem | null;
  isOpen: boolean;
  onClose: () => void;
  initialLanguage: DashboardLanguage;
};

export function MarketDetailChartModal({
  definition,
  item,
  isOpen,
  onClose,
  initialLanguage,
}: MarketDetailChartModalProps) {
  const { language } = useDashboardI18n(initialLanguage);
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

  const copy =
    language === "ko"
      ? {
          eyebrow: "Market Detail",
          titleSuffix: "상세 차트",
          description: "Binance USD, Upbit KRW 기준 가격 흐름과 김치 프리미엄을 한 번에 확인합니다.",
          closeLabel: `${item.asset} 상세 차트 닫기`,
        }
      : {
          eyebrow: "Market Detail",
          titleSuffix: "detail chart",
          description: "Review Binance USD, Upbit KRW, and the kimchi premium in one chart view.",
          closeLabel: `Close ${item.asset} detail chart`,
        };

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
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h3 id={titleId} className={styles.title}>
              {item.asset} {copy.titleSuffix}
            </h3>
            <p id={descriptionId} className={styles.description}>
              {copy.description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={copy.closeLabel}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className={styles.content}>
          <MarketDetailChart definition={definition} item={item} initialLanguage={initialLanguage} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
