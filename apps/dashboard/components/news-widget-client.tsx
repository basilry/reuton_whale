"use client";

import { useId, useState } from "react";

import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import { formatDashboardMessage } from "@/lib/i18n/get-dictionary";
import type { NewsWidgetData } from "@/lib/news";

import styles from "./news-widget.module.css";

type NewsWidgetClientProps = {
  data: NewsWidgetData;
  mobileLimit?: number;
  initialLanguage?: DashboardLanguage;
};

function formatUpdatedAt(value: string, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
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

function formatPublishedAt(value: string, fallback: string, language: "ko" | "en"): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function sourceBadgeLabel(
  source: NewsWidgetData["source"],
  dictionary: ReturnType<typeof useDashboardI18n>["dictionary"],
): string {
  if (source === "news_feed") {
    return dictionary.news.sourceBadgeNewsFeed;
  }
  if (source === "derived") {
    return dictionary.news.sourceBadgeDerived;
  }
  return dictionary.news.sourceBadgeFallback;
}

function sourceCaption(
  source: NewsWidgetData["source"],
  dictionary: ReturnType<typeof useDashboardI18n>["dictionary"],
): string {
  if (source === "news_feed") {
    return dictionary.news.sourceCaptionNewsFeed;
  }
  if (source === "derived") {
    return dictionary.news.sourceCaptionDerived;
  }
  return dictionary.news.sourceCaptionFallback;
}

function buildStalenessWarning(
  data: NewsWidgetData,
  dictionary: ReturnType<typeof useDashboardI18n>["dictionary"],
): string | null {
  const staleness = data.staleness;
  if (!staleness) {
    return null;
  }

  const minutes = staleness.minutes;
  switch (staleness.reason) {
    case "pipeline_stale":
      if (minutes == null) {
        return dictionary.news.warningPipelineStaleUnknown;
      }
      return formatDashboardMessage(dictionary.news.warningPipelineStale, {
        minutes,
      });
    case "article_quiet":
      if (minutes == null) {
        return null;
      }
      return formatDashboardMessage(dictionary.news.warningArticleQuiet, {
        minutes,
      });
    case "derived_stale":
      if (minutes == null) {
        return null;
      }
      return formatDashboardMessage(dictionary.news.warningDerivedStale, {
        minutes,
      });
    case "fallback":
      return dictionary.news.warningFallback;
    default:
      return null;
  }
}

export function NewsWidgetClient({
  data,
  mobileLimit = 2,
  initialLanguage,
}: NewsWidgetClientProps) {
  const { dictionary, language } = useDashboardI18n(initialLanguage);
  const [isExpanded, setIsExpanded] = useState(false);
  const listId = useId();
  const hasOverflow = data.items.length > mobileLimit;
  const stalenessWarning = buildStalenessWarning(data, dictionary);

  return (
    <>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <p className={styles.eyebrow}>{dictionary.news.eyebrow}</p>
          <h2 id="news-widget-title" className={styles.title}>
            {dictionary.news.title}
          </h2>
        </div>
        <span className={styles.sourceBadge} data-source={data.source}>
          {sourceBadgeLabel(data.source, dictionary)}
        </span>
      </div>

      <div className={styles.metaBlock}>
        <p className={styles.caption}>{sourceCaption(data.source, dictionary)}</p>
        <p className={styles.updatedAt}>
          {dictionary.news.updatedAtLabel}{" "}
          <time dateTime={data.lastUpdatedAt || undefined}>
            {formatUpdatedAt(data.lastUpdatedAt, dictionary.news.updatedAtPending)}
          </time>
        </p>
        {stalenessWarning ? (
          <p
            className={styles.warning}
            data-level={data.staleness?.level ?? "warn"}
            role="status"
          >
            {stalenessWarning}
          </p>
        ) : null}
      </div>

      <div
        id={listId}
        className={styles.list}
        data-collapsed={hasOverflow && !isExpanded ? "true" : undefined}
      >
        {data.items.map((item) => {
          const displaySource =
            item.id === "news-fallback-empty"
              ? dictionary.news.fallbackItemSource
              : item.source;
          const displayTitle =
            item.id === "news-fallback-empty"
              ? dictionary.news.fallbackItemTitle
              : item.title;
          const displaySummary =
            item.id === "news-fallback-empty"
              ? dictionary.news.fallbackItemSummary
              : item.summary;
          const content = (
            <>
              <div className={styles.itemMeta}>
                <span className={styles.itemSource}>{displaySource}</span>
                <span className={styles.itemDate}>
                  {formatPublishedAt(item.publishedAt, dictionary.news.publishedAtPending, language)}
                </span>
              </div>
              <h3 className={styles.itemTitle}>{displayTitle}</h3>
              <p className={styles.itemSummary}>{displaySummary}</p>
              {item.tags.length > 0 ? (
                <div className={styles.tagRow}>
                  {item.tags.map((tag) => (
                    <span key={`${item.id}-${tag}`} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          );

          return item.url ? (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className={styles.item}
            >
              {content}
            </a>
          ) : (
            <article key={item.id} className={styles.item}>
              {content}
            </article>
          );
        })}
      </div>

      {hasOverflow ? (
        <button
          type="button"
          className={styles.expandButton}
          aria-controls={listId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {isExpanded ? "expand_less" : "expand_more"}
          </span>
          {isExpanded
            ? dictionary.news.expandLess
            : formatDashboardMessage(dictionary.news.expandMore, {
                count: data.items.length - mobileLimit,
              })}
        </button>
      ) : null}
    </>
  );
}
