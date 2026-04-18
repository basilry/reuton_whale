"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import { formatDashboardMessage } from "@/lib/i18n/get-dictionary";
import styles from "./telegram-connect-modal.module.css";

type TelegramConnectModalProps = {
  channelQrUrl: string | null;
  channelUrl: string | null;
  channelUsername: string | null;
  className?: string;
  subscriberCount?: number;
  initialLanguage?: DashboardLanguage;
};

type CopyState = "idle" | "success" | "error";

export function TelegramConnectModal({
  channelQrUrl,
  channelUrl,
  channelUsername,
  className,
  subscriberCount = 0,
  initialLanguage,
}: TelegramConnectModalProps) {
  const { dictionary, language } = useDashboardI18n(initialLanguage);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const triggerDescriptionId = useId();
  const hasChannelLink = Boolean(channelUrl);
  const triggerClassName = [styles.trigger, className].filter(Boolean).join(" ");
  const channelHandle = channelUsername ? `@${channelUsername}` : "Telegram";
  const formattedSubscriberCount = subscriberCount.toLocaleString(
    language === "ko" ? "ko-KR" : "en-US",
  );

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
                <p className={styles.eyebrow}>{dictionary.telegram.eyebrow}</p>
                <h3 id={titleId} className={styles.title}>
                  {dictionary.telegram.title}
                </h3>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                aria-label={dictionary.telegram.closeLabel}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            <p id={descriptionId} className={styles.description}>
              {hasChannelLink
                ? formatDashboardMessage(dictionary.telegram.descriptionReady, {
                    channelHandle,
                  })
                : dictionary.telegram.descriptionUnavailable}
            </p>

            <section className={styles.connectOption} aria-label={dictionary.telegram.channelTitle}>
              <div className={styles.optionTop}>
                <p className={styles.optionEyebrow}>{dictionary.telegram.channelEyebrow}</p>
                <h4 className={styles.optionTitle}>{dictionary.telegram.channelTitle}</h4>
                <p className={styles.optionDesc}>
                  {channelUsername
                    ? formatDashboardMessage(dictionary.telegram.channelDescriptionReady, {
                        channelHandle,
                      })
                    : dictionary.telegram.channelDescriptionUnavailable}
                </p>
                <p className={styles.optionDesc}>
                  <strong>{dictionary.telegram.channelBadge}:</strong>{" "}
                  {channelUsername ? channelHandle : dictionary.telegram.unavailableAction}
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
                  tabIndex={hasChannelLink ? undefined : -1}
                  title={hasChannelLink ? channelUrl ?? undefined : dictionary.telegram.triggerHelpUnavailable}
                  onClick={(event) => {
                    if (!hasChannelLink) {
                      event.preventDefault();
                    }
                  }}
                >
                  {dictionary.telegram.openChannel}
                </a>
                <button
                  type="button"
                  className={styles.secondaryAction}
                  onClick={() => handleCopy(channelUrl)}
                  disabled={!hasChannelLink}
                  aria-describedby={hasChannelLink ? undefined : descriptionId}
                >
                  {dictionary.telegram.copyLink}
                </button>
              </div>

              <div className={styles.qrPanel}>
                <div className={styles.qrFrame}>
                  {channelQrUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={
                        channelUsername
                          ? formatDashboardMessage(dictionary.telegram.qrImageAltReady, {
                              channelHandle,
                            })
                          : dictionary.telegram.qrImageAltFallback
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
                      <span>{dictionary.telegram.qrFallback}</span>
                    </div>
                  )}
                </div>

                <div className={styles.qrMeta}>
                  <p className={styles.qrTitle}>{dictionary.telegram.qrTitle}</p>
                  <p className={styles.qrText}>
                    {channelUsername
                      ? formatDashboardMessage(dictionary.telegram.qrTextReady, {
                          channelHandle,
                        })
                      : dictionary.telegram.qrTextUnavailable}
                  </p>
                  <p className={styles.qrText}>
                    {dictionary.telegram.audienceLabel}: <strong>{formattedSubscriberCount}</strong>
                    {dictionary.telegram.audienceUnit}
                  </p>
                  <p className={styles.qrText}>{dictionary.telegram.qrCaption}</p>
                </div>
              </div>
            </section>

            <p className={styles.feedback} aria-live="polite">
              {copyState === "success"
                ? dictionary.telegram.copySuccess
                : copyState === "error"
                  ? dictionary.telegram.copyError
                  : channelUrl ?? dictionary.telegram.linkUnavailable}
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
        aria-describedby={triggerDescriptionId}
        data-disabled={hasChannelLink ? undefined : "true"}
      >
        {hasChannelLink
          ? dictionary.telegram.triggerReady
          : dictionary.telegram.triggerUnavailable}
      </button>
      <span id={triggerDescriptionId} className="sr-only">
        {hasChannelLink
          ? dictionary.telegram.triggerHelpReady
          : dictionary.telegram.triggerHelpUnavailable}
      </span>

      {modal}
    </>
  );
}
