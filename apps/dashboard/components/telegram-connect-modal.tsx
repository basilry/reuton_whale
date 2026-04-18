"use client";

import { useEffect, useId, useRef, useState } from "react";

import styles from "./telegram-connect-modal.module.css";

type TelegramConnectModalProps = {
  botUrl: string | null;
  channelQrUrl: string | null;
  channelUrl: string | null;
  channelUsername: string | null;
  className?: string;
  qrUrl: string | null;
  subscriberCount?: number;
  username: string | null;
};

type CopyState = "idle" | "bot-success" | "channel-success" | "error";

export function TelegramConnectModal({
  botUrl,
  channelQrUrl,
  channelUrl,
  channelUsername,
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
  const hasChannelLink = Boolean(channelUrl);
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

  async function handleCopy(targetUrl: string | null, kind: "bot" | "channel") {
    if (!targetUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopyState(kind === "bot" ? "bot-success" : "channel-success");
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
              {hasBotLink || hasChannelLink
                ? "개인 맞춤 알림은 봇에서, 공개 브리핑 구독은 채널에서 시작할 수 있습니다. QR은 모두 대시보드 내부 경로로 생성됩니다."
                : "현재 텔레그램 연결 링크를 준비 중입니다. 잠시 후 다시 확인해 주세요."}
            </p>

            <div className={styles.connectGrid}>
              <section className={styles.connectOption} aria-label="개인 알림 봇 연결">
                <div className={styles.optionTop}>
                  <p className={styles.optionEyebrow}>Personal Bot</p>
                  <h4 className={styles.optionTitle}>나만의 실시간 알림</h4>
                  <p className={styles.optionDesc}>
                    {username
                      ? `@${username}에서 /start를 누르면 개인 맞춤 알림을 시작할 수 있습니다.`
                      : "배포 환경에 봇 공개 주소가 설정되면 개인 알림 연결이 열립니다."}
                  </p>
                </div>

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
                    onClick={() => handleCopy(botUrl, "bot")}
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
                            : "텔레그램 봇 연결 QR 코드"
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
              </section>

              <section className={styles.connectOption} aria-label="공개 브리핑 채널 연결">
                <div className={styles.optionTop}>
                  <p className={styles.optionEyebrow}>Broadcast Channel</p>
                  <h4 className={styles.optionTitle}>공개 브리핑 채널 구독</h4>
                  <p className={styles.optionDesc}>
                    {channelUsername
                      ? `@${channelUsername} 채널에서 전체 브리핑과 공용 시그널 공지를 받아볼 수 있습니다.`
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
                    onClick={() => handleCopy(channelUrl, "channel")}
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
                        ? `QR을 스캔하거나 @${channelUsername} 채널을 열어 업데이트를 구독하세요.`
                        : "배포 환경에 공개 채널 주소가 설정되면 QR이 표시됩니다."}
                    </p>
                    <p className={styles.qrText}>
                      개인 맞춤 응답은 봇, 공용 브리핑은 채널에서 확인할 수 있습니다.
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <p className={styles.feedback} aria-live="polite">
              {copyState === "bot-success"
                ? "텔레그램 봇 링크를 복사했습니다."
                : copyState === "channel-success"
                  ? "텔레그램 채널 링크를 복사했습니다."
                : copyState === "error"
                  ? "링크를 복사하지 못했습니다. 직접 열어 주세요."
                  : botUrl ?? channelUrl ?? "텔레그램 링크 준비 중"}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
