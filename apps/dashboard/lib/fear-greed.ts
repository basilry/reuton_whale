const FEAR_GREED_ENDPOINT = "https://api.alternative.me/fng/?limit=31&format=json";
export const FEAR_GREED_SOURCE_URL = "https://alternative.me/crypto/fear-and-greed-index/";
const FEAR_GREED_REVALIDATE_SECONDS = 600;
const FEAR_GREED_STALE_MS = 36 * 60 * 60 * 1000;

type FearGreedApiRow = {
  value?: string;
  value_classification?: string;
  timestamp?: string;
  time_until_update?: string;
};

type FearGreedApiResponse = {
  data?: FearGreedApiRow[];
  metadata?: {
    error?: string | null;
  };
};

export type FearGreedClassification =
  | "extreme_fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme_greed";

export type FearGreedSnapshot = {
  value: number;
  classification: FearGreedClassification;
  timestamp: string;
  rawClassification: string;
};

export type FearGreedData = {
  current: FearGreedSnapshot;
  yesterday?: FearGreedSnapshot;
  weekAgo?: FearGreedSnapshot;
  monthAgo?: FearGreedSnapshot;
  nextUpdateInSeconds: number | null;
  fetchedAt: string;
  isStale: boolean;
  sourceUrl: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toClassification(value: string | undefined): FearGreedClassification {
  switch ((value ?? "").trim().toLowerCase()) {
    case "extreme fear":
      return "extreme_fear";
    case "fear":
      return "fear";
    case "greed":
      return "greed";
    case "extreme greed":
      return "extreme_greed";
    default:
      return "neutral";
  }
}

function toSnapshot(row: FearGreedApiRow | undefined): FearGreedSnapshot | null {
  if (!row) {
    return null;
  }

  const value = Number(row.value);
  const timestampSeconds = Number(row.timestamp);

  if (!Number.isFinite(value) || !Number.isFinite(timestampSeconds)) {
    return null;
  }

  return {
    value: clamp(Math.round(value), 0, 100),
    classification: toClassification(row.value_classification),
    timestamp: new Date(timestampSeconds * 1000).toISOString(),
    rawClassification: (row.value_classification ?? "").trim(),
  };
}

function parseNextUpdateInSeconds(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function isFearGreedStale(snapshot: FearGreedSnapshot, now = Date.now()): boolean {
  const timestamp = Date.parse(snapshot.timestamp);
  if (Number.isNaN(timestamp)) {
    return true;
  }
  return now - timestamp > FEAR_GREED_STALE_MS;
}

export async function getFearGreedData(): Promise<FearGreedData | null> {
  try {
    const response = await fetch(FEAR_GREED_ENDPOINT, {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: FEAR_GREED_REVALIDATE_SECONDS,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as FearGreedApiResponse;
    if (payload.metadata?.error) {
      return null;
    }

    const rows = payload.data ?? [];
    const current = toSnapshot(rows[0]);
    if (!current) {
      return null;
    }

    return {
      current,
      yesterday: toSnapshot(rows[1]) ?? undefined,
      weekAgo: toSnapshot(rows[7]) ?? undefined,
      monthAgo: toSnapshot(rows[30]) ?? undefined,
      nextUpdateInSeconds: parseNextUpdateInSeconds(rows[0]?.time_until_update),
      fetchedAt: new Date().toISOString(),
      isStale: isFearGreedStale(current),
      sourceUrl: FEAR_GREED_SOURCE_URL,
    };
  } catch {
    return null;
  }
}
