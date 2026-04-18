"use client";

import { useEffect, useId, useRef, useState } from "react";

import styles from "./telegram-connect-modal.module.css";

type TelegramConnectModalProps = {
  botUrl: string | null;
  className?: string;
  qrUrl: string | null;
  subscriberCount?: number;
  username: string | null;
};

type CopyState = "idle" | "success" | "error";

export function TelegramConnectModal({
  botUrl,
  className,
  qrUrl,
  subscriberCount = 0,
  username,
}: TelegramConnectModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasBotLink = Boolean(botUrl);
  const triggerClassName = [styles.trigger, className].filter(Boolean).join(" ");

  useEffect(() => {
    if (!isOpen) {
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
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCopyState("idle");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function handleCopy() {
    if (!botUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(botUrl);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setIsOpen(true)}
      >
        텔레그램 연결하기
      </button>

      {isOpen ? (
        <div
          className={styles.backdrop}
          onClick={() => setIsOpen(false)}
        >
          <div
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            aria-modal="true"
            className={styles.modal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className={styles.header}>
              <div>
                <p className={styles.eyebrow}>Telegram Connect</p>
                <h3 id={titleId} className={styles.title}>
                  텔레그램에서 실시간 고래 알림을 받으세요
                </h3>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                aria-label="텔레그램 연결 안내 닫기"
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <p id={descriptionId} className={styles.description}>
              {hasBotLink
                ? "봇을 열고 /start를 누르면 개인 알림을 시작할 수 있습니다."
                : "현재 텔레그램 연결 링크를 준비 중입니다. 잠시 후 다시 확인해 주세요."}
            </p>

            <div className={styles.actions}>
              <a
                className={styles.primaryAction}
                data-disabled={hasBotLink ? undefined : "true"}
                href={botUrl ?? undefined}
                rel="noreferrer"
                target="_blank"
                aria-disabled={hasBotLink ? undefined : true}
                onClick={(event) => {
                  if (!hasBotLink) {
                    event.preventDefault();
                  }
                }}
              >
                봇 열기
              </a>
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={handleCopy}
                disabled={!hasBotLink}
              >
                링크 복사
              </button>
            </div>

            <div className={styles.qrPanel}>
              <div className={styles.qrFrame}>
                {qrUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={
                      username
                        ? `텔레그램 봇 @${username} 연결 QR 코드`
                        : "텔레그램 연결 QR 코드"
                    }
                    className={styles.qrImage}
                    height={240}
                    loading="lazy"
                    src={qrUrl}
                    width={240}
                  />
                ) : (
                  <div className={styles.qrFallback}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      qr_code_2
                    </span>
                    <span>QR 준비 중</span>
                  </div>
                )}
              </div>

              <div className={styles.qrMeta}>
                <p className={styles.qrTitle}>앱에서 바로 연결</p>
                <p className={styles.qrText}>
                  {username
                    ? `QR을 스캔하거나 @${username} 검색 후 /start를 입력하세요.`
                    : "배포 환경에 텔레그램 봇 공개 주소가 설정되면 QR이 표시됩니다."}
                </p>
                <p className={styles.qrText}>
                  현재 안내 대상: <strong>{subscriberCount.toLocaleString("ko-KR")}</strong>명
                </p>
              </div>
            </div>

            <p className={styles.feedback} aria-live="polite">
              {copyState === "success"
                ? "텔레그램 봇 링크를 복사했습니다."
                : copyState === "error"
                  ? "링크를 복사하지 못했습니다. 직접 열어 주세요."
                  : botUrl ?? "텔레그램 링크 준비 중"}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
