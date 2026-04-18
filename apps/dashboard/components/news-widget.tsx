import { loadNewsWidgetData, type NewsWidgetData } from "@/lib/news";

import styles from "./news-widget.module.css";

type NewsWidgetProps = {
  limit?: number;
  data?: NewsWidgetData;
};

function formatUpdatedAt(value: string): string {
  if (!value) {
    return "업데이트 대기";
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
      .map((part) => [part.type, part.value])
  );

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function formatPublishedAt(value: string): string {
  if (!value) {
    return "업데이트 대기";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function sourceBadgeLabel(source: NewsWidgetData["source"]): string {
  if (source === "news_feed") {
    return "RSS";
  }
  if (source === "derived") {
    return "브리핑";
  }
  return "준비 중";
}

function sourceCaption(source: NewsWidgetData["source"]): string {
  if (source === "news_feed") {
    return "수집된 기사에서 바로 읽을 수 있는 맥락만 추렸습니다.";
  }
  if (source === "derived") {
    return "뉴스 행이 비어 있어 브리핑과 시그널 요약으로 대체했습니다.";
  }
  return "연결 전에도 빈 화면 대신 현재 상태를 이해할 수 있게 유지합니다.";
}

export async function NewsWidget({ limit = 4, data }: NewsWidgetProps) {
  const resolved = data ?? (await loadNewsWidgetData(limit));

  return (
    <section className={styles.widget} aria-labelledby="news-widget-title">
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <p className={styles.eyebrow}>News & Curation</p>
          <h2 id="news-widget-title" className={styles.title}>
            지금 읽을 맥락
          </h2>
        </div>
        <span className={styles.sourceBadge} data-source={resolved.source}>
          {sourceBadgeLabel(resolved.source)}
        </span>
      </div>

      <div className={styles.metaBlock}>
        <p className={styles.caption}>{sourceCaption(resolved.source)}</p>
        <p className={styles.updatedAt}>
          마지막 갱신{" "}
          <time dateTime={resolved.lastUpdatedAt || undefined}>
            {formatUpdatedAt(resolved.lastUpdatedAt)}
          </time>
        </p>
      </div>

      <div className={styles.list}>
        {resolved.items.map((item) => {
          const content = (
            <>
              <div className={styles.itemMeta}>
                <span className={styles.itemSource}>{item.source}</span>
                <span className={styles.itemDate}>{formatPublishedAt(item.publishedAt)}</span>
              </div>
              <h3 className={styles.itemTitle}>{item.title}</h3>
              <p className={styles.itemSummary}>{item.summary}</p>
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
    </section>
  );
}
