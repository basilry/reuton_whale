import {
  cleanGeneratedBrief,
  compactString,
  newestFirst,
  parseDateTimeSafe,
} from "./format";
import { readSheetRows } from "./sheets";
import type { DailyBriefRow, NewsFeedRow, SignalRow } from "./schema";

export type NewsDataSource = "news_feed" | "derived" | "fallback";

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  language: string;
  tags: string[];
}

export interface NewsWidgetData {
  generatedAt: string;
  lastUpdatedAt: string;
  source: NewsDataSource;
  items: NewsItem[];
}

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,\|]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function newestTimestamp(values: string[]): string {
  let latestTime: number | null = null;

  for (const value of values) {
    const time = parseDateTimeSafe(compactString(value));
    if (time == null) {
      continue;
    }
    if (latestTime == null || time > latestTime) {
      latestTime = time;
    }
  }

  return latestTime == null ? "" : new Date(latestTime).toISOString();
}

function toNewsItem(row: NewsFeedRow): NewsItem | null {
  const title = compactString(stripHtml(row.title));
  if (!title) {
    return null;
  }

  const summary = compactString(stripHtml(row.summary));
  return {
    id: compactString(row.id) || compactString(row.hash) || title,
    source: compactString(row.source) || "RSS",
    title: truncate(title, 76),
    summary: truncate(summary || "요약이 아직 정리되지 않았습니다.", 140),
    url: compactString(row.url),
    publishedAt:
      compactString(row.published_at) || compactString(row.fetched_at) || "",
    language: compactString(row.language) || "ko",
    tags: parseTags(compactString(row.tags)),
  };
}

function pickNewsFeedItems(rows: NewsFeedRow[], limit: number): NewsItem[] {
  const deduped = new Set<string>();

  return newestFirst(rows, (row) => {
    return parseDateTimeSafe(row.published_at) ?? parseDateTimeSafe(row.fetched_at);
  })
    .map(toNewsItem)
    .filter((item): item is NewsItem => {
      if (!item) {
        return false;
      }
      const dedupKey = item.url || item.title;
      if (!dedupKey || deduped.has(dedupKey)) {
        return false;
      }
      deduped.add(dedupKey);
      return true;
    })
    .slice(0, limit);
}

function getNewsFeedLastUpdated(rows: NewsFeedRow[]): string {
  return newestTimestamp(
    rows.flatMap((row) => [compactString(row.fetched_at), compactString(row.published_at)])
  );
}

function latestDailyBrief(rows: DailyBriefRow[]): DailyBriefRow | null {
  return (
    newestFirst(rows, (row) => {
      return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.date);
    })[0] ?? null
  );
}

function newestSignals(rows: SignalRow[], limit: number): SignalRow[] {
  return newestFirst(rows, (row) => parseDateTimeSafe(row.created_at)).slice(0, limit);
}

function getDerivedLastUpdated(
  briefs: DailyBriefRow[],
  signals: SignalRow[]
): string {
  return newestTimestamp([
    ...briefs.flatMap((row) => [compactString(row.created_at), compactString(row.date)]),
    ...signals.map((row) => compactString(row.created_at)),
  ]);
}

function buildDerivedItems(
  briefs: DailyBriefRow[],
  signals: SignalRow[],
  limit: number
): NewsItem[] {
  const items: NewsItem[] = [];
  const latestBriefRow = latestDailyBrief(briefs);
  if (latestBriefRow) {
    const summary = compactString(cleanGeneratedBrief(latestBriefRow.summary));
    items.push({
      id: `brief-${latestBriefRow.created_at || latestBriefRow.date || "latest"}`,
      source: "오늘의 브리핑",
      title: "오늘 고래 브리핑 핵심",
      summary: truncate(summary || "브리핑 요약이 아직 정리되지 않았습니다.", 140),
      url: "",
      publishedAt:
        compactString(latestBriefRow.created_at) || compactString(latestBriefRow.date),
      language: "ko",
      tags: ["brief"],
    });
  }

  for (const signal of newestSignals(signals, Math.max(0, limit - items.length))) {
    const summary = compactString(signal.summary);
    if (!summary) {
      continue;
    }

    items.push({
      id: compactString(signal.signal_id) || `signal-${signal.created_at}`,
      source: "시그널 엔진",
      title: truncate(summary, 72),
      summary: truncate(
        `${compactString(signal.rule) || "룰 기반 감지"} · ${summary}`,
        140
      ),
      url: "",
      publishedAt: compactString(signal.created_at),
      language: "ko",
      tags: [compactString(signal.severity) || "signal"].filter(Boolean),
    });
  }

  return items.slice(0, limit);
}

function buildFallbackItems(): NewsItem[] {
  return [
    {
      id: "news-fallback-empty",
      source: "연결 준비 중",
      title: "아직 수집된 뉴스가 없습니다",
      summary:
        "news_feed 탭이 비어 있으면 최신 브리핑과 시그널 요약이 이 영역을 대신 채웁니다.",
      url: "",
      publishedAt: "",
      language: "ko",
      tags: ["fallback"],
    },
  ];
}

async function tryReadNewsFeed(): Promise<NewsFeedRow[]> {
  try {
    return await readSheetRows("news_feed");
  } catch (error) {
    console.error("[lib/news] Failed to read news_feed.", error);
    return [];
  }
}

async function tryReadDerivedInputs(): Promise<{
  briefs: DailyBriefRow[];
  signals: SignalRow[];
}> {
  try {
    const [briefs, signals] = await Promise.all([
      readSheetRows("daily_brief"),
      readSheetRows("signals"),
    ]);
    return { briefs, signals };
  } catch (error) {
    console.error("[lib/news] Failed to read derived news inputs.", error);
    return { briefs: [], signals: [] };
  }
}

export async function loadNewsWidgetData(
  limit = DEFAULT_LIMIT
): Promise<NewsWidgetData> {
  const cappedLimit = clampLimit(limit);
  const generatedAt = new Date().toISOString();

  const newsFeedRows = await tryReadNewsFeed();
  const newsFeedItems = pickNewsFeedItems(newsFeedRows, cappedLimit);
  if (newsFeedItems.length > 0) {
    return {
      generatedAt,
      lastUpdatedAt: getNewsFeedLastUpdated(newsFeedRows),
      source: "news_feed",
      items: newsFeedItems,
    };
  }

  const { briefs, signals } = await tryReadDerivedInputs();
  const derivedItems = buildDerivedItems(briefs, signals, cappedLimit);
  if (derivedItems.length > 0) {
    return {
      generatedAt,
      lastUpdatedAt: getDerivedLastUpdated(briefs, signals),
      source: "derived",
      items: derivedItems,
    };
  }

  return {
    generatedAt,
    lastUpdatedAt: "",
    source: "fallback",
    items: buildFallbackItems(),
  };
}
