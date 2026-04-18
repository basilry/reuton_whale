import {
  cleanGeneratedBrief,
  compactString,
  newestFirst,
  parseDateTimeSafe,
} from "./format";
import { readSheetRows } from "./sheets";
import type {
  DailyBriefRow,
  NewsFeedRow,
  SignalRow,
  SystemLogRow,
} from "./schema";

export type NewsDataSource = "news_feed" | "derived" | "fallback";

export type NewsStalenessLevel = "warn" | "info";

export type NewsStalenessReason =
  | "pipeline_stale"
  | "article_quiet"
  | "derived_stale"
  | "fallback";

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

export interface NewsStaleness {
  level: NewsStalenessLevel;
  reason: NewsStalenessReason;
  /**
   * Minutes elapsed since the relevant timestamp. Null when the source
   * timestamp itself is missing (e.g. fallback / first-ever run).
   */
  minutes: number | null;
}

export interface NewsWidgetData {
  generatedAt: string;
  /**
   * Back-compat: the more recent of `lastPollAt` and `lastArticleAt`.
   * UI code that needs to distinguish poll vs. article should use the
   * dedicated fields below.
   */
  lastUpdatedAt: string;
  /**
   * When the RSS pipeline most recently observed *any* article (new or
   * dedup hit). Reflects "is the pipeline polling?". Null-ish empty
   * string means we have no evidence the pipeline ran recently.
   */
  lastPollAt: string;
  /**
   * When the most recent *new* article was published. Reflects "are
   * upstream sources producing news?". Can lag hours behind lastPollAt
   * during a quiet news cycle even when the pipeline is healthy.
   */
  lastArticleAt: string;
  source: NewsDataSource;
  /** Structured staleness decision. Undefined when nothing is stale. */
  staleness?: NewsStaleness;
  items: NewsItem[];
}

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;
/**
 * If the pipeline hasn't polled in this long, something is wrong with
 * the cron / RSS fetcher. Escalate as WARN (error-tone in UI).
 */
const POLL_STALE_MINUTES = 35;
/**
 * If the pipeline is polling fine but no new article has arrived in this
 * long, it's usually just a quiet news cycle. Surface as INFO only.
 */
const ARTICLE_QUIET_MINUTES = 120;

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

function ageMinutes(iso: string): number | null {
  const ms = parseDateTimeSafe(compactString(iso));
  if (ms == null) {
    return null;
  }
  return Math.max(0, (Date.now() - ms) / 60000);
}

function mostRecent(a: string, b: string): string {
  const aMs = parseDateTimeSafe(compactString(a));
  const bMs = parseDateTimeSafe(compactString(b));
  if (aMs == null && bMs == null) {
    return "";
  }
  if (aMs == null) {
    return b;
  }
  if (bMs == null) {
    return a;
  }
  return aMs >= bMs ? a : b;
}

function decideStaleness(
  source: NewsDataSource,
  lastPollAt: string,
  lastArticleAt: string,
): NewsStaleness | undefined {
  if (source === "fallback") {
    return { level: "warn", reason: "fallback", minutes: null };
  }

  if (source === "derived") {
    // Derived has no independent poll concept — there is no news pipeline
    // to check. Treat the combined "last updated" as the signal.
    const combined = mostRecent(lastPollAt, lastArticleAt);
    const age = ageMinutes(combined);
    if (age == null || age <= POLL_STALE_MINUTES) {
      return undefined;
    }
    return {
      level: "warn",
      reason: "derived_stale",
      minutes: Math.floor(age),
    };
  }

  // source === "news_feed"
  const pollAge = ageMinutes(lastPollAt);
  if (pollAge == null || pollAge > POLL_STALE_MINUTES) {
    return {
      level: "warn",
      reason: "pipeline_stale",
      minutes: pollAge == null ? null : Math.floor(pollAge),
    };
  }

  const articleAge = ageMinutes(lastArticleAt);
  if (articleAge != null && articleAge > ARTICLE_QUIET_MINUTES) {
    return {
      level: "info",
      reason: "article_quiet",
      minutes: Math.floor(articleAge),
    };
  }

  return undefined;
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

/**
 * The "last poll" is the most recent moment the RSS pipeline *saw* any
 * article — including dedup hits. Prefer `last_seen_at` (added in v7.5);
 * fall back to `fetched_at` for rows written before the schema migration,
 * and ultimately to the latest `news_rss` run in system_log if the sheet
 * is still on the old schema.
 */
function getNewsFeedLastPollAt(
  rows: NewsFeedRow[],
  systemLogRows: SystemLogRow[],
): string {
  const sheetPoll = newestTimestamp(
    rows.flatMap((row) => [
      compactString(row.last_seen_at),
      compactString(row.fetched_at),
    ]),
  );
  if (sheetPoll) {
    return sheetPoll;
  }

  // Fall back to system_log if the sheet has no usable timestamps yet.
  return newestTimestamp(
    systemLogRows
      .filter((row) => row.run_type === "news_rss")
      .flatMap((row) => [
        compactString(row.finished_at),
        compactString(row.started_at),
      ]),
  );
}

/**
 * The "last article" is the most recent publication timestamp among
 * collected rows. Only `published_at` counts — fetched_at and last_seen_at
 * measure pipeline behavior, not news arrival.
 */
function getNewsFeedLastArticleAt(rows: NewsFeedRow[]): string {
  return newestTimestamp(
    rows.map((row) => compactString(row.published_at)),
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

async function tryReadSystemLog(): Promise<SystemLogRow[]> {
  try {
    return await readSheetRows("system_log");
  } catch (error) {
    console.error("[lib/news] Failed to read system_log.", error);
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

  // Read news_feed + system_log in parallel so the staleness check has
  // both signals even if the sheet hasn't been migrated to last_seen_at.
  const [newsFeedRows, systemLogRows] = await Promise.all([
    tryReadNewsFeed(),
    tryReadSystemLog(),
  ]);
  const newsFeedItems = pickNewsFeedItems(newsFeedRows, cappedLimit);

  if (newsFeedItems.length > 0) {
    const lastPollAt = getNewsFeedLastPollAt(newsFeedRows, systemLogRows);
    const lastArticleAt = getNewsFeedLastArticleAt(newsFeedRows);
    const lastUpdatedAt = mostRecent(lastPollAt, lastArticleAt);
    const staleness = decideStaleness("news_feed", lastPollAt, lastArticleAt);
    return {
      generatedAt,
      lastUpdatedAt,
      lastPollAt,
      lastArticleAt,
      source: "news_feed",
      staleness,
      items: newsFeedItems,
    };
  }

  const { briefs, signals } = await tryReadDerivedInputs();
  const derivedItems = buildDerivedItems(briefs, signals, cappedLimit);
  if (derivedItems.length > 0) {
    const lastUpdatedAt = getDerivedLastUpdated(briefs, signals);
    const staleness = decideStaleness("derived", lastUpdatedAt, lastUpdatedAt);
    return {
      generatedAt,
      lastUpdatedAt,
      lastPollAt: lastUpdatedAt,
      lastArticleAt: lastUpdatedAt,
      source: "derived",
      staleness,
      items: derivedItems,
    };
  }

  return {
    generatedAt,
    lastUpdatedAt: "",
    lastPollAt: "",
    lastArticleAt: "",
    source: "fallback",
    staleness: decideStaleness("fallback", "", ""),
    items: buildFallbackItems(),
  };
}
