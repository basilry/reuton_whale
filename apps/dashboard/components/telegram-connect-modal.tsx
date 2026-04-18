"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./telegram-connect-modal.module.css";

type TelegramConnectModalProps = {
  channelQrUrl: string | null;
  channelUrl: string | null;
  channelUsername: string | null;
  className?: string;
  subscriberCount?: number;
};

type CopyState = "idle" | "success" | "error";

export function TelegramConnectModal({
  channelQrUrl,
  channelUrl,
  channelUsername,
  className,
  subscriberCount = 0,
}: TelegramConnectModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasChannelLink = Boolean(channelUrl);
  const triggerClassName = [styles.trigger, className].filter(Boolean).join(" ");
  const channelHandle = channelUsername ? `@${channelUsername}` : "공개 채널";

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
  }, [isMounted, isOpen]);

  useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCopyState("idle");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function handleCopy(targetUrl: string | null) {
    if (!targetUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }

  const modal = !isMounted || !isOpen
    ? null
    : createPortal(
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
                  텔레그램 채널에서 실시간 고래 브리핑을 받으세요
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
              {hasChannelLink
                ? `${channelHandle} 채널에서 공개 브리핑과 주요 고래 이벤트 요약을 받아볼 수 있습니다.`
                : "현재 텔레그램 채널 링크를 준비 중입니다. 잠시 후 다시 확인해 주세요."}
            </p>

            <section className={styles.connectOption} aria-label="공개 브리핑 채널 연결">
              <div className={styles.optionTop}>
                <p className={styles.optionEyebrow}>Telegram Channel</p>
                <h4 className={styles.optionTitle}>공개 브리핑 채널 구독</h4>
                <p className={styles.optionDesc}>
                  {channelUsername
                    ? `${channelHandle} 채널에서 전체 브리핑과 공용 시그널 공지를 확인할 수 있습니다.`
                    : "공개 브리핑 채널 주소가 설정되면 여기에서 바로 구독할 수 있습니다."}
                </p>
              </div>

              <div className={styles.actions}>
                <a
                  className={styles.primaryAction}
                  data-disabled={hasChannelLink ? undefined : "true"}
                  href={channelUrl ?? undefined}
                  rel="noreferrer"
                  target="_blank"
                  aria-disabled={hasChannelLink ? undefined : true}
                  onClick={(event) => {
                    if (!hasChannelLink) {
                      event.preventDefault();
                    }
                  }}
                >
                  채널 열기
                </a>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => handleCopy(channelUrl)}
                  disabled={!hasChannelLink}
                >
                  링크 복사
                </button>
              </div>

              <div className={styles.qrPanel}>
                <div className={styles.qrFrame}>
                  {channelQrUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={
                        channelUsername
                          ? `텔레그램 채널 @${channelUsername} 연결 QR 코드`
                          : "텔레그램 채널 연결 QR 코드"
                      }
                      className={styles.qrImage}
                      height={240}
                      loading="lazy"
                      src={channelQrUrl}
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
                  <p className={styles.qrTitle}>브리핑 채널 바로가기</p>
                  <p className={styles.qrText}>
                    {channelUsername
                      ? `QR을 스캔하거나 ${channelHandle} 채널을 열어 업데이트를 구독하세요.`
                      : "배포 환경에 공개 채널 주소가 설정되면 QR이 표시됩니다."}
                  </p>
                  <p className={styles.qrText}>
                    현재 안내 대상: <strong>{subscriberCount.toLocaleString("ko-KR")}</strong>명
                  </p>
                </div>
              </div>
            </section>

            <p className={styles.feedback} aria-live="polite">
              {copyState === "success"
                ? "텔레그램 채널 링크를 복사했습니다."
                : copyState === "error"
                  ? "링크를 복사하지 못했습니다. 직접 열어 주세요."
                  : channelUrl ?? "텔레그램 링크 준비 중"}
            </p>
          </div>
        </div>,
        document.body,
      );

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setIsOpen(true)}
      >
        텔레그램 연결하기
      </button>

      {modal}
    </>
  );
}
