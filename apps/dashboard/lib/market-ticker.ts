import {
  createLocalUsdKrwFxQuote,
  fetchUsdKrwFx,
  type UsdKrwFxQuote,
} from "./market-fx";
import { calcOptionalKimchiPremium } from "./market-premium";

export type MarketTickerSource = "live" | "rest" | "local";

export type MarketTickerSourceKey =
  | "binance"
  | "upbit"
  | "bitflyer"
  | "kraken"
  | "fx"
  | "snapshot";

export type MarketTickerSourcePhase = "loading" | "ready" | "fallback";

export type MarketTickerSourceStatus = "connecting" | "live" | "stale" | "down";

export type MarketTickerSourceHealth = {
  available: boolean;
  lastSeenAt: number | null;
  isConnecting: boolean;
  errorAt: number | null;
  closedAt: number | null;
};

export type MarketTickerSourceProfileKind = "live" | "polling";

export type MarketTickerSourceProfile = {
  kind: MarketTickerSourceProfileKind;
  liveWindowMs: number;
  downWindowMs: number;
  expectedIntervalMs: number;
};

const LIVE_SOURCE_LIVE_WINDOW_MS = 15_000;
const LIVE_SOURCE_DOWN_WINDOW_MS = 45_000;
const POLLING_SOURCE_LIVE_WINDOW_MS = 6 * 60_000;
const POLLING_SOURCE_DOWN_WINDOW_MS = 15 * 60_000;
const BITFLYER_POLL_INTERVAL_MS = 120_000;
const BITFLYER_SOURCE_LIVE_WINDOW_MS = 3 * 60_000;
const BITFLYER_SOURCE_DOWN_WINDOW_MS = 8 * 60_000;
const KRAKEN_POLL_INTERVAL_MS = 60_000;
const KRAKEN_SOURCE_LIVE_WINDOW_MS = 90_000;
const KRAKEN_SOURCE_DOWN_WINDOW_MS = 4 * 60_000;
const SNAPSHOT_POLL_INTERVAL_MS = 5 * 60_000;

export const MARKET_TICKER_SOURCE_PROFILES: Record<
  MarketTickerSourceKey,
  MarketTickerSourceProfile
> = {
  binance: {
    kind: "live",
    liveWindowMs: LIVE_SOURCE_LIVE_WINDOW_MS,
    downWindowMs: LIVE_SOURCE_DOWN_WINDOW_MS,
    expectedIntervalMs: LIVE_SOURCE_LIVE_WINDOW_MS,
  },
  upbit: {
    kind: "live",
    liveWindowMs: LIVE_SOURCE_LIVE_WINDOW_MS,
    downWindowMs: LIVE_SOURCE_DOWN_WINDOW_MS,
    expectedIntervalMs: LIVE_SOURCE_LIVE_WINDOW_MS,
  },
  bitflyer: {
    kind: "polling",
    liveWindowMs: BITFLYER_SOURCE_LIVE_WINDOW_MS,
    downWindowMs: BITFLYER_SOURCE_DOWN_WINDOW_MS,
    expectedIntervalMs: BITFLYER_POLL_INTERVAL_MS,
  },
  kraken: {
    kind: "polling",
    liveWindowMs: KRAKEN_SOURCE_LIVE_WINDOW_MS,
    downWindowMs: KRAKEN_SOURCE_DOWN_WINDOW_MS,
    expectedIntervalMs: KRAKEN_POLL_INTERVAL_MS,
  },
  fx: {
    kind: "polling",
    liveWindowMs: POLLING_SOURCE_LIVE_WINDOW_MS,
    downWindowMs: POLLING_SOURCE_DOWN_WINDOW_MS,
    expectedIntervalMs: SNAPSHOT_POLL_INTERVAL_MS,
  },
  snapshot: {
    kind: "polling",
    liveWindowMs: POLLING_SOURCE_LIVE_WINDOW_MS,
    downWindowMs: POLLING_SOURCE_DOWN_WINDOW_MS,
    expectedIntervalMs: SNAPSHOT_POLL_INTERVAL_MS,
  },
};

export function getMarketTickerSourceProfile(
  key: MarketTickerSourceKey,
): MarketTickerSourceProfile {
  return MARKET_TICKER_SOURCE_PROFILES[key];
}

export function isMarketTickerSourceHoldingLastSuccess(
  key: MarketTickerSourceKey,
  state: MarketTickerSourceHealth,
): boolean {
  const profile = getMarketTickerSourceProfile(key);
  const lastFailureAt = Math.max(state.errorAt ?? 0, state.closedAt ?? 0);

  return (
    profile.kind === "polling" &&
    state.lastSeenAt != null &&
    lastFailureAt > state.lastSeenAt
  );
}

export function getMarketTickerSourceStatus(
  key: MarketTickerSourceKey,
  state: MarketTickerSourceHealth,
  now: number,
  phase: MarketTickerSourcePhase,
): MarketTickerSourceStatus {
  const profile = getMarketTickerSourceProfile(key);
  const lastFailureAt = Math.max(state.errorAt ?? 0, state.closedAt ?? 0);

  if (
    profile.kind === "live" &&
    lastFailureAt > 0 &&
    (state.lastSeenAt == null || lastFailureAt >= state.lastSeenAt)
  ) {
    return "down";
  }

  if (state.lastSeenAt == null) {
    return phase === "loading" || state.isConnecting ? "connecting" : "down";
  }

  const age = now - state.lastSeenAt;
  if (age <= profile.liveWindowMs) {
    return "live";
  }
  if (age <= profile.downWindowMs) {
    return "stale";
  }
  return "down";
}

export type MarketTickerDefinition = {
  id: string;
  asset: string;
  label: string;
  binanceSymbol: string;
  upbitMarket: string;
  bitflyerProductCode?: string;
  krakenPair?: string;
  usdMarketLabel: string;
  krwMarketLabel: string;
  fallbackPriceUsd: number;
  fallbackPriceKrw: number;
  fallbackUsdChange24hPct: number;
  fallbackKrwChange24hPct: number;
};

export type MarketTickerItem = {
  id: string;
  asset: string;
  label: string;
  usdMarketLabel: string;
  krwMarketLabel: string;
  priceUsd: number | null;
  priceKrw: number | null;
  usdChange24hPct: number | null;
  krwChange24hPct: number | null;
  usdKrwFx: number | null;
  kimchiPremiumPct: number | null;
  impliedFairKrw: number | null;
  lastUpdatedAt: number | null;
  source: MarketTickerSource;
};

export type MarketTickerChartRange = "1m" | "5m" | "1h" | "1d";

export type MarketTickerChartMetric = "usd" | "krw";

export type MarketTickerChartPoint = {
  timestamp: number;
  value: number;
};

export type MarketTickerDetailSeries = {
  range: MarketTickerChartRange;
  usdPoints: MarketTickerChartPoint[];
  krwPoints: MarketTickerChartPoint[];
};

type Binance24HourTicker = {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  closeTime?: number;
};

type BinanceMiniTicker = {
  s?: string;
  c?: string;
  o?: string;
  E?: number;
};

type BinanceMiniTickerEnvelope =
  | BinanceMiniTicker
  | {
      data?: BinanceMiniTicker;
    };

type BinanceTickerQuote = {
  priceUsd: number | null;
  change24hPct: number | null;
  updatedAt: number | null;
};

type UpbitTickerSnapshot = {
  market?: string;
  trade_price?: number;
  signed_change_rate?: number;
  trade_timestamp?: number;
};

type UpbitTickerMessage = {
  code?: string;
  trade_price?: number;
  signed_change_rate?: number;
  timestamp?: number;
};

type UpbitTickerQuote = {
  priceKrw: number | null;
  change24hPct: number | null;
  updatedAt: number | null;
};

type BitflyerTickerResponse = {
  product_code?: string;
  ltp?: number;
  timestamp?: string;
};

type BitflyerTickerQuote = {
  priceJpy: number | null;
  updatedAt: number | null;
};

type KrakenTickerRow = {
  c?: [string, string] | string[];
  o?: string;
};

type KrakenTickerResponse = {
  error?: string[];
  result?: Record<string, KrakenTickerRow>;
};

type KrakenTickerQuote = {
  priceUsd: number | null;
  change24hPct: number | null;
  updatedAt: number | null;
};

type BinanceKlineRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

type UpbitCandle = {
  timestamp?: number;
  candle_date_time_utc?: string;
  trade_price?: number;
};

type MergeSnapshotOptions = {
  definitions?: MarketTickerDefinition[];
  binanceQuotes?: Map<string, BinanceTickerQuote>;
  krakenQuotes?: Map<string, KrakenTickerQuote>;
  upbitQuotes?: Map<string, UpbitTickerQuote>;
  fxQuote?: UsdKrwFxQuote | null;
  source: MarketTickerSource;
  useFallbackValues: boolean;
};

type MarketTickerChartRangeConfig = {
  binanceInterval: string;
  upbitEndpoint: "minutes" | "days";
  upbitUnit?: number;
  pointCount: number;
};

const MARKET_TICKER_CHART_RANGE_CONFIG: Record<
  MarketTickerChartRange,
  MarketTickerChartRangeConfig
> = {
  "1m": {
    binanceInterval: "1m",
    upbitEndpoint: "minutes",
    upbitUnit: 1,
    pointCount: 60,
  },
  "5m": {
    binanceInterval: "5m",
    upbitEndpoint: "minutes",
    upbitUnit: 5,
    pointCount: 72,
  },
  "1h": {
    binanceInterval: "1h",
    upbitEndpoint: "minutes",
    upbitUnit: 60,
    pointCount: 72,
  },
  "1d": {
    binanceInterval: "1d",
    upbitEndpoint: "days",
    pointCount: 30,
  },
};

const USD_CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const USD_CURRENCY_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const KRW_CURRENCY = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

export const DEFAULT_MARKET_TICKER_SYMBOLS: MarketTickerDefinition[] = [
  {
    id: "btc",
    asset: "BTC",
    label: "Bitcoin",
    binanceSymbol: "BTCUSDT",
    upbitMarket: "KRW-BTC",
    bitflyerProductCode: "BTC_JPY",
    krakenPair: "XBTUSD",
    usdMarketLabel: "BINANCE · USDT",
    krwMarketLabel: "UPBIT · KRW",
    fallbackPriceUsd: 84620,
    fallbackPriceKrw: 118900000,
    fallbackUsdChange24hPct: 2.8,
    fallbackKrwChange24hPct: 3.1,
  },
  {
    id: "eth",
    asset: "ETH",
    label: "Ethereum",
    binanceSymbol: "ETHUSDT",
    upbitMarket: "KRW-ETH",
    bitflyerProductCode: "ETH_JPY",
    krakenPair: "ETHUSD",
    usdMarketLabel: "BINANCE · USDT",
    krwMarketLabel: "UPBIT · KRW",
    fallbackPriceUsd: 1625,
    fallbackPriceKrw: 2292000,
    fallbackUsdChange24hPct: 1.9,
    fallbackKrwChange24hPct: 2.2,
  },
  {
    id: "sol",
    asset: "SOL",
    label: "Solana",
    binanceSymbol: "SOLUSDT",
    upbitMarket: "KRW-SOL",
    usdMarketLabel: "BINANCE · USDT",
    krwMarketLabel: "UPBIT · KRW",
    fallbackPriceUsd: 134.7,
    fallbackPriceKrw: 189500,
    fallbackUsdChange24hPct: 4.1,
    fallbackKrwChange24hPct: 4.4,
  },
  {
    id: "xrp",
    asset: "XRP",
    label: "Ripple",
    binanceSymbol: "XRPUSDT",
    upbitMarket: "KRW-XRP",
    usdMarketLabel: "BINANCE · USDT",
    krwMarketLabel: "UPBIT · KRW",
    fallbackPriceUsd: 0.61,
    fallbackPriceKrw: 861,
    fallbackUsdChange24hPct: -0.8,
    fallbackKrwChange24hPct: -0.3,
  },
  {
    id: "doge",
    asset: "DOGE",
    label: "Dogecoin",
    binanceSymbol: "DOGEUSDT",
    upbitMarket: "KRW-DOGE",
    usdMarketLabel: "BINANCE · USDT",
    krwMarketLabel: "UPBIT · KRW",
    fallbackPriceUsd: 0.17,
    fallbackPriceKrw: 240,
    fallbackUsdChange24hPct: 3.4,
    fallbackKrwChange24hPct: 3.8,
  },
  {
    id: "ada",
    asset: "ADA",
    label: "Cardano",
    binanceSymbol: "ADAUSDT",
    upbitMarket: "KRW-ADA",
    usdMarketLabel: "BINANCE · USDT",
    krwMarketLabel: "UPBIT · KRW",
    fallbackPriceUsd: 0.48,
    fallbackPriceKrw: 676,
    fallbackUsdChange24hPct: 0.7,
    fallbackKrwChange24hPct: 1.0,
  },
];

function parseNumber(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentFromOpenClose(open: number | null, close: number | null): number | null {
  if (open == null || close == null || open === 0) {
    return null;
  }
  return ((close - open) / open) * 100;
}

function definitionMapByBinanceSymbol(
  definitions: MarketTickerDefinition[],
): Map<string, MarketTickerDefinition> {
  return new Map(definitions.map((item) => [item.binanceSymbol, item]));
}

function definitionMapByUpbitMarket(
  definitions: MarketTickerDefinition[],
): Map<string, MarketTickerDefinition> {
  return new Map(definitions.map((item) => [item.upbitMarket, item]));
}

function maxTimestamp(...values: Array<number | null | undefined>): number | null {
  let next: number | null = null;

  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    if (next == null || value > next) {
      next = value;
    }
  }

  return next;
}

function normalizeTimestamp(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value > 10_000_000_000) {
    return Math.trunc(value);
  }

  return Math.trunc(value * 1000);
}

function parseUtcDateString(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(`${value}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return parseUtcDateString(value);
}

function normalizeKrakenPairKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^XXBT/, "XBT")
    .replace(/^XETH/, "ETH")
    .replace(/ZUSD$/, "USD")
    .replace(/ZEUR$/, "EUR")
    .replace(/ZJPY$/, "JPY");
}

function resolveKrakenTickerRow(
  rows: Record<string, KrakenTickerRow>,
  pair: string,
): KrakenTickerRow | null {
  const direct = rows[pair];
  if (direct) {
    return direct;
  }

  const normalizedPair = normalizeKrakenPairKey(pair);
  for (const [key, row] of Object.entries(rows)) {
    if (normalizeKrakenPairKey(key) === normalizedPair) {
      return row;
    }
  }

  return null;
}

function clampChartPoints(
  points: MarketTickerChartPoint[],
  pointCount: number,
): MarketTickerChartPoint[] {
  if (points.length <= pointCount) {
    return points;
  }

  return points.slice(points.length - pointCount);
}

function chartSecond(timestamp: number): number {
  return Math.trunc(timestamp / 1000);
}

function createChartAbortController(timeoutMs: number): {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return { controller, timeoutId };
}

function marketTickerRangeConfig(range: MarketTickerChartRange): MarketTickerChartRangeConfig {
  return MARKET_TICKER_CHART_RANGE_CONFIG[range];
}

function createEmptyMarketTickerItem(
  definition: MarketTickerDefinition,
  source: MarketTickerSource,
): MarketTickerItem {
  return {
    id: definition.id,
    asset: definition.asset,
    label: definition.label,
    usdMarketLabel: definition.usdMarketLabel,
    krwMarketLabel: definition.krwMarketLabel,
    priceUsd: null,
    priceKrw: null,
    usdChange24hPct: null,
    krwChange24hPct: null,
    usdKrwFx: null,
    kimchiPremiumPct: null,
    impliedFairKrw: null,
    lastUpdatedAt: null,
    source,
  };
}

function hydrateMarketTickerItem(
  definition: MarketTickerDefinition,
  values: {
    priceUsd: number | null;
    priceKrw: number | null;
    usdChange24hPct: number | null;
    krwChange24hPct: number | null;
    usdKrwFx: number | null;
    lastUpdatedAt: number | null;
    source: MarketTickerSource;
  },
): MarketTickerItem {
  const premium = calcOptionalKimchiPremium({
    usdPrice: values.priceUsd,
    krwPrice: values.priceKrw,
    usdKrwFx: values.usdKrwFx,
  });

  return {
    id: definition.id,
    asset: definition.asset,
    label: definition.label,
    usdMarketLabel: definition.usdMarketLabel,
    krwMarketLabel: definition.krwMarketLabel,
    priceUsd: values.priceUsd,
    priceKrw: values.priceKrw,
    usdChange24hPct: values.usdChange24hPct,
    krwChange24hPct: values.krwChange24hPct,
    usdKrwFx: values.usdKrwFx,
    kimchiPremiumPct: premium?.premiumPct ?? null,
    impliedFairKrw: premium?.impliedFairKrw ?? null,
    lastUpdatedAt: values.lastUpdatedAt,
    source: values.source,
  };
}

function buildMergedMarketTickerItems({
  definitions = DEFAULT_MARKET_TICKER_SYMBOLS,
  binanceQuotes = new Map<string, BinanceTickerQuote>(),
  krakenQuotes = new Map<string, KrakenTickerQuote>(),
  upbitQuotes = new Map<string, UpbitTickerQuote>(),
  fxQuote,
  source,
  useFallbackValues,
}: MergeSnapshotOptions): MarketTickerItem[] {
  return definitions.map((definition) => {
    const binanceQuote = binanceQuotes.get(definition.id);
    const krakenQuote = krakenQuotes.get(definition.id);
    const upbitQuote = upbitQuotes.get(definition.id);

    return hydrateMarketTickerItem(definition, {
      priceUsd:
        binanceQuote?.priceUsd ??
        krakenQuote?.priceUsd ??
        (useFallbackValues ? definition.fallbackPriceUsd : null),
      priceKrw:
        upbitQuote?.priceKrw ??
        (useFallbackValues ? definition.fallbackPriceKrw : null),
      usdChange24hPct:
        binanceQuote?.change24hPct ??
        krakenQuote?.change24hPct ??
        (useFallbackValues ? definition.fallbackUsdChange24hPct : null),
      krwChange24hPct:
        upbitQuote?.change24hPct ??
        (useFallbackValues ? definition.fallbackKrwChange24hPct : null),
      usdKrwFx:
        fxQuote?.usdKrw ??
        (useFallbackValues ? createLocalUsdKrwFxQuote().usdKrw : null),
      lastUpdatedAt: maxTimestamp(
        binanceQuote?.updatedAt,
        krakenQuote?.updatedAt,
        upbitQuote?.updatedAt,
        fxQuote?.updatedAt,
      ),
      source,
    });
  });
}

export function createLocalMarketTickerItems(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
): MarketTickerItem[] {
  return buildMergedMarketTickerItems({
    definitions,
    fxQuote: createLocalUsdKrwFxQuote(),
    source: "local",
    useFallbackValues: true,
  });
}

export function createPendingMarketTickerItems(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
): MarketTickerItem[] {
  return definitions.map((definition) =>
    createEmptyMarketTickerItem(definition, "rest"),
  );
}

async function fetchBinanceTickerSnapshot(
  definitions: MarketTickerDefinition[],
  timeoutMs: number,
): Promise<Map<string, BinanceTickerQuote>> {
  if (definitions.length === 0) {
    return new Map();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const query = encodeURIComponent(
      JSON.stringify(definitions.map((item) => item.binanceSymbol)),
    );
    const response = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as
      | Binance24HourTicker[]
      | Binance24HourTicker;
    const rows = Array.isArray(payload) ? payload : [payload];
    const bySymbol = definitionMapByBinanceSymbol(definitions);
    const quotes = new Map<string, BinanceTickerQuote>();

    for (const row of rows) {
      const definition = bySymbol.get(row.symbol ?? "");
      if (!definition) {
        continue;
      }

      quotes.set(definition.id, {
        priceUsd: parseNumber(row.lastPrice),
        change24hPct: parseNumber(row.priceChangePercent),
        updatedAt:
          typeof row.closeTime === "number" ? row.closeTime : Date.now(),
      });
    }

    return quotes;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchUpbitTickerSnapshot(
  definitions: MarketTickerDefinition[],
  timeoutMs: number,
): Promise<Map<string, UpbitTickerQuote>> {
  if (definitions.length === 0) {
    return new Map();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const markets = definitions.map((item) => item.upbitMarket).join(",");
    const response = await fetch(
      `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets)}`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as UpbitTickerSnapshot[];
    const rows = Array.isArray(payload) ? payload : [];
    const byMarket = definitionMapByUpbitMarket(definitions);
    const quotes = new Map<string, UpbitTickerQuote>();

    for (const row of rows) {
      const definition = byMarket.get(row.market ?? "");
      if (!definition) {
        continue;
      }

      quotes.set(definition.id, {
        priceKrw: parseNumber(row.trade_price),
        change24hPct:
          row.signed_change_rate == null
            ? null
            : row.signed_change_rate * 100,
        updatedAt:
          typeof row.trade_timestamp === "number"
            ? row.trade_timestamp
            : Date.now(),
      });
    }

    return quotes;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchBitflyerTickerSnapshot(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
  timeoutMs = 4500,
): Promise<Map<string, BitflyerTickerQuote>> {
  const supportedDefinitions = definitions.filter((item) => item.bitflyerProductCode);
  if (supportedDefinitions.length === 0) {
    return new Map();
  }

  const results = await Promise.allSettled(
    supportedDefinitions.map(async (definition) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(
          `https://api.bitflyer.com/v1/ticker?product_code=${definition.bitflyerProductCode}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP_${response.status}`);
        }

        const payload = (await response.json()) as BitflyerTickerResponse;
        return [
          definition.id,
          {
            priceJpy: parseNumber(payload.ltp),
            updatedAt: parseIsoTimestamp(payload.timestamp) ?? Date.now(),
          },
        ] as const;
      } finally {
        clearTimeout(timeoutId);
      }
    }),
  );

  const quotes = new Map<string, BitflyerTickerQuote>();
  for (const result of results) {
    if (result.status !== "fulfilled" || result.value == null) {
      continue;
    }
    quotes.set(result.value[0], result.value[1]);
  }

  return quotes;
}

export async function fetchKrakenTickerSnapshot(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
  timeoutMs = 4500,
): Promise<Map<string, KrakenTickerQuote>> {
  const supportedDefinitions = definitions.filter((item) => item.krakenPair);
  if (supportedDefinitions.length === 0) {
    return new Map();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const pairs = supportedDefinitions
      .map((item) => item.krakenPair)
      .filter((value): value is string => typeof value === "string")
      .join(",");

    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pairs)}`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as KrakenTickerResponse;
    if ((payload.error ?? []).length > 0) {
      throw new Error(payload.error?.join(",") || "KRAKEN_API_ERROR");
    }

    const rows = payload.result ?? {};
    const quotes = new Map<string, KrakenTickerQuote>();

    for (const definition of supportedDefinitions) {
      if (!definition.krakenPair) {
        continue;
      }

      const row = resolveKrakenTickerRow(rows, definition.krakenPair);
      if (!row) {
        continue;
      }

      const priceUsd = parseNumber(row.c?.[0]);
      const open = parseNumber(row.o);
      if (priceUsd == null) {
        continue;
      }

      quotes.set(definition.id, {
        priceUsd,
        change24hPct: percentFromOpenClose(open, priceUsd),
        updatedAt: Date.now(),
      });
    }

    return quotes;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchMarketTickerSnapshot(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
  timeoutMs = 4500,
): Promise<MarketTickerItem[]> {
  if (definitions.length === 0) {
    return [];
  }

  const [binanceResult, krakenResult, upbitResult, fxResult] = await Promise.allSettled([
    fetchBinanceTickerSnapshot(definitions, timeoutMs),
    fetchKrakenTickerSnapshot(definitions, timeoutMs),
    fetchUpbitTickerSnapshot(definitions, timeoutMs),
    fetchUsdKrwFx(timeoutMs),
  ]);

  const items = buildMergedMarketTickerItems({
    definitions,
    binanceQuotes:
      binanceResult.status === "fulfilled"
        ? binanceResult.value
        : new Map<string, BinanceTickerQuote>(),
    krakenQuotes:
      krakenResult.status === "fulfilled"
        ? krakenResult.value
        : new Map<string, KrakenTickerQuote>(),
    upbitQuotes:
      upbitResult.status === "fulfilled"
        ? upbitResult.value
        : new Map<string, UpbitTickerQuote>(),
    fxQuote: fxResult.status === "fulfilled" ? fxResult.value : null,
    source: "rest",
    useFallbackValues: false,
  });

  const hasAnyData = items.some(
    (item) => item.priceUsd != null || item.priceKrw != null,
  );

  return hasAnyData ? items : [];
}

async function fetchBinanceChartPoints(
  definition: MarketTickerDefinition,
  range: MarketTickerChartRange,
  timeoutMs: number,
): Promise<MarketTickerChartPoint[]> {
  const config = marketTickerRangeConfig(range);
  const { controller, timeoutId } = createChartAbortController(timeoutMs);

  try {
    const params = new URLSearchParams({
      symbol: definition.binanceSymbol,
      interval: config.binanceInterval,
      limit: String(config.pointCount),
    });
    const response = await fetch(
      `https://api.binance.com/api/v3/uiKlines?${params.toString()}`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as BinanceKlineRow[];
    const points = payload.flatMap((row) => {
      const timestamp = normalizeTimestamp(row[6] ?? row[0]);
      const value = parseNumber(row[4]);

      if (timestamp == null || value == null) {
        return [];
      }

      return [{ timestamp, value }];
    });

    return clampChartPoints(points, config.pointCount);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchUpbitChartPoints(
  definition: MarketTickerDefinition,
  range: MarketTickerChartRange,
  timeoutMs: number,
): Promise<MarketTickerChartPoint[]> {
  const config = marketTickerRangeConfig(range);
  const { controller, timeoutId } = createChartAbortController(timeoutMs);

  try {
    const params = new URLSearchParams({
      market: definition.upbitMarket,
      count: String(config.pointCount),
    });
    const baseUrl =
      config.upbitEndpoint === "days"
        ? "https://api.upbit.com/v1/candles/days"
        : `https://api.upbit.com/v1/candles/minutes/${config.upbitUnit}`;
    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as UpbitCandle[];
    const points = payload
      .flatMap((row) => {
        const timestamp =
          normalizeTimestamp(row.timestamp ?? Number.NaN) ??
          parseUtcDateString(row.candle_date_time_utc);
        const value = parseNumber(row.trade_price);

        if (timestamp == null || value == null) {
          return [];
        }

        return [{ timestamp, value }];
      })
      .reverse();

    return clampChartPoints(points, config.pointCount);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createLocalMarketTickerChartPoints(params: {
  id: string;
  value: number;
  changePct: number | null;
  pointCount?: number;
  endTimestamp?: number;
  stepMs?: number;
}): MarketTickerChartPoint[] {
  const pointCount = params.pointCount ?? 36;
  const stepMs = params.stepMs ?? 60_000;
  const endTimestamp = params.endTimestamp ?? Date.now();
  const referenceValue = Math.max(params.value, Number.EPSILON);
  const totalMove =
    params.changePct == null
      ? referenceValue * 0.02
      : referenceValue * (params.changePct / 100) * 0.32;
  const startValue = Math.max(referenceValue - totalMove, referenceValue * 0.4);
  const phaseSeed =
    params.id.split("").reduce((total, char) => total + char.charCodeAt(0), 0) % 11;
  const waveAmplitude = Math.max(referenceValue * 0.006, Math.abs(totalMove) * 0.28);

  return Array.from({ length: pointCount }, (_, index) => {
    const progress =
      pointCount === 1 ? 1 : index / Math.max(pointCount - 1, 1);
    const baseline = startValue + (referenceValue - startValue) * progress;
    const wave =
      Math.sin(progress * Math.PI * 2 + phaseSeed) * waveAmplitude * 0.62 +
      Math.cos(progress * Math.PI * 4 + phaseSeed * 0.5) * waveAmplitude * 0.18;
    const value =
      index === pointCount - 1
        ? referenceValue
        : Math.max(referenceValue * 0.3, baseline + wave);

    return {
      timestamp: endTimestamp - stepMs * (pointCount - index - 1),
      value,
    };
  });
}

export function appendMarketTickerChartPoint(
  points: MarketTickerChartPoint[],
  value: number | null,
  timestamp: number | null,
  pointCount = points.length > 0 ? points.length : 60,
): MarketTickerChartPoint[] {
  if (value == null) {
    return points;
  }

  const nextTimestamp = normalizeTimestamp(timestamp ?? Date.now());
  if (nextTimestamp == null) {
    return points;
  }

  const nextPoint = { timestamp: nextTimestamp, value };
  const previousPoint = points.at(-1);
  if (!previousPoint) {
    return [nextPoint];
  }

  const nextPoints = [...points];
  if (
    previousPoint.timestamp >= nextTimestamp ||
    chartSecond(previousPoint.timestamp) >= chartSecond(nextTimestamp)
  ) {
    nextPoints[nextPoints.length - 1] = nextPoint;
    return clampChartPoints(nextPoints, pointCount);
  }

  nextPoints.push(nextPoint);
  return clampChartPoints(nextPoints, pointCount);
}

export async function fetchMarketTickerMiniCharts(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
  timeoutMs = 4500,
): Promise<Record<string, MarketTickerChartPoint[]>> {
  const results = await Promise.allSettled(
    definitions.map(async (definition) => [
      definition.id,
      await fetchBinanceChartPoints(definition, "1m", timeoutMs),
    ] as const),
  );

  const entries = results.flatMap((result) => {
    if (result.status !== "fulfilled" || result.value[1].length === 0) {
      return [];
    }

    return [result.value];
  });

  return Object.fromEntries(entries);
}

export function createLocalMarketTickerDetailSeries(
  definition: MarketTickerDefinition,
  range: MarketTickerChartRange,
): MarketTickerDetailSeries {
  const config = marketTickerRangeConfig(range);
  const pointCount = config.pointCount;
  const stepMs =
    range === "1d"
      ? 86_400_000
      : range === "1h"
        ? 3_600_000
        : range === "5m"
          ? 300_000
          : 60_000;

  return {
    range,
    usdPoints: createLocalMarketTickerChartPoints({
      id: `${definition.id}-usd-${range}`,
      value: definition.fallbackPriceUsd,
      changePct: definition.fallbackUsdChange24hPct,
      pointCount,
      stepMs,
    }),
    krwPoints: createLocalMarketTickerChartPoints({
      id: `${definition.id}-krw-${range}`,
      value: definition.fallbackPriceKrw,
      changePct: definition.fallbackKrwChange24hPct,
      pointCount,
      stepMs,
    }),
  };
}

export async function fetchMarketTickerDetailSeries(
  definition: MarketTickerDefinition,
  range: MarketTickerChartRange,
  timeoutMs = 4500,
): Promise<MarketTickerDetailSeries> {
  const [usdResult, krwResult] = await Promise.allSettled([
    fetchBinanceChartPoints(definition, range, timeoutMs),
    fetchUpbitChartPoints(definition, range, timeoutMs),
  ]);

  const usdPoints =
    usdResult.status === "fulfilled" ? usdResult.value : [];
  const krwPoints =
    krwResult.status === "fulfilled" ? krwResult.value : [];

  if (usdPoints.length === 0 && krwPoints.length === 0) {
    throw new Error("chart_history_unavailable");
  }

  const fallback = createLocalMarketTickerDetailSeries(definition, range);

  return {
    range,
    usdPoints: usdPoints.length > 0 ? usdPoints : fallback.usdPoints,
    krwPoints: krwPoints.length > 0 ? krwPoints : fallback.krwPoints,
  };
}

export function buildMarketTickerStreamUrl(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
): string {
  const streams = definitions
    .map((item) => `${item.binanceSymbol.toLowerCase()}@miniTicker`)
    .join("/");

  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

export function buildUpbitTickerSubscriptionPayload(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
): string {
  const codes = Array.from(
    new Set(definitions.map((item) => item.upbitMarket.toUpperCase())),
  );

  return JSON.stringify([
    {
      ticket: `whalescope-${Date.now()}`,
    },
    {
      type: "ticker",
      codes,
    },
    {
      format: "DEFAULT",
    },
  ]);
}

export function mergeMarketTickerMessage(
  current: MarketTickerItem[],
  definitions: MarketTickerDefinition[],
  payload: string,
): MarketTickerItem[] {
  const parsed = parseMarketTickerMessage(payload);
  if (parsed.length === 0) {
    return current;
  }

  const bySymbol = definitionMapByBinanceSymbol(definitions);
  const currentById = new Map(current.map((item) => [item.id, item]));
  const updates = new Map<string, BinanceTickerQuote>();

  for (const event of parsed) {
    const definition = bySymbol.get(event.s ?? "");
    if (!definition) {
      continue;
    }

    const close = parseNumber(event.c);
    const open = parseNumber(event.o);
    updates.set(definition.id, {
      priceUsd: close,
      change24hPct: percentFromOpenClose(open, close),
      updatedAt: typeof event.E === "number" ? event.E : Date.now(),
    });
  }

  return definitions.map((definition) => {
    const currentItem =
      currentById.get(definition.id) ??
      createEmptyMarketTickerItem(definition, "live");
    const nextUsd = updates.get(definition.id);

    return hydrateMarketTickerItem(definition, {
      priceUsd: nextUsd?.priceUsd ?? currentItem.priceUsd,
      priceKrw: currentItem.priceKrw,
      usdChange24hPct:
        nextUsd?.change24hPct ?? currentItem.usdChange24hPct,
      krwChange24hPct: currentItem.krwChange24hPct,
      usdKrwFx: currentItem.usdKrwFx,
      lastUpdatedAt: maxTimestamp(
        currentItem.lastUpdatedAt,
        nextUsd?.updatedAt,
      ),
      source: "live",
    });
  });
}

export function mergeMarketTickerSnapshot(
  current: MarketTickerItem[],
  snapshot: MarketTickerItem[],
  options: {
    preserveLiveUsd: boolean;
    preserveLiveKrw: boolean;
    source: MarketTickerSource;
  },
): MarketTickerItem[] {
  const currentById = new Map(current.map((item) => [item.id, item]));

  return snapshot.map((incoming) => {
    const existing = currentById.get(incoming.id);
    if (!existing) {
      return {
        ...incoming,
        source: options.source,
      };
    }

    const priceUsd =
      options.preserveLiveUsd && existing.priceUsd != null
        ? existing.priceUsd
        : incoming.priceUsd;
    const priceKrw =
      options.preserveLiveKrw && existing.priceKrw != null
        ? existing.priceKrw
        : incoming.priceKrw;
    const usdChange24hPct =
      options.preserveLiveUsd && existing.usdChange24hPct != null
        ? existing.usdChange24hPct
        : incoming.usdChange24hPct;
    const krwChange24hPct =
      options.preserveLiveKrw && existing.krwChange24hPct != null
        ? existing.krwChange24hPct
        : incoming.krwChange24hPct;
    const usdKrwFx = incoming.usdKrwFx ?? existing.usdKrwFx;
    const premium = calcOptionalKimchiPremium({
      usdPrice: priceUsd,
      krwPrice: priceKrw,
      usdKrwFx,
    });

    return {
      ...incoming,
      priceUsd,
      priceKrw,
      usdChange24hPct,
      krwChange24hPct,
      usdKrwFx,
      kimchiPremiumPct: premium?.premiumPct ?? null,
      impliedFairKrw: premium?.impliedFairKrw ?? null,
      lastUpdatedAt: maxTimestamp(existing.lastUpdatedAt, incoming.lastUpdatedAt),
      source: options.source,
    };
  });
}

export function mergeUpbitMarketTickerMessage(
  current: MarketTickerItem[],
  definitions: MarketTickerDefinition[],
  payload: string,
): MarketTickerItem[] {
  const parsed = parseUpbitTickerMessage(payload);
  if (!parsed) {
    return current;
  }

  const byMarket = definitionMapByUpbitMarket(definitions);
  const definition = byMarket.get(parsed.code ?? "");
  if (!definition) {
    return current;
  }

  const currentById = new Map(current.map((item) => [item.id, item]));

  return definitions.map((item) => {
    const currentItem =
      currentById.get(item.id) ?? createEmptyMarketTickerItem(item, "live");

    if (item.id !== definition.id) {
      return currentItem;
    }

    return hydrateMarketTickerItem(item, {
      priceUsd: currentItem.priceUsd,
      priceKrw: parseNumber(parsed.trade_price) ?? currentItem.priceKrw,
      usdChange24hPct: currentItem.usdChange24hPct,
      krwChange24hPct:
        parsed.signed_change_rate == null
          ? currentItem.krwChange24hPct
          : parsed.signed_change_rate * 100,
      usdKrwFx: currentItem.usdKrwFx,
      lastUpdatedAt: maxTimestamp(
        currentItem.lastUpdatedAt,
        typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      ),
      source: "live",
    });
  });
}

export function parseMarketTickerMessage(payload: string): BinanceMiniTicker[] {
  try {
    const raw = JSON.parse(payload) as
      | BinanceMiniTickerEnvelope
      | BinanceMiniTickerEnvelope[];
    const records = Array.isArray(raw) ? raw : [raw];
    const items: BinanceMiniTicker[] = [];

    for (const entry of records) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      if ("data" in entry) {
        const nestedTicker = entry.data;
        if (nestedTicker && typeof nestedTicker.s === "string") {
          items.push(nestedTicker);
        }
        continue;
      }

      const directTicker = entry as BinanceMiniTicker;
      if (typeof directTicker.s === "string") {
        items.push(directTicker);
      }
    }

    return items;
  } catch {
    return [];
  }
}

export function parseUpbitTickerMessage(
  payload: string,
): UpbitTickerMessage | null {
  try {
    const parsed = JSON.parse(payload) as UpbitTickerMessage;
    return typeof parsed.code === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function formatMarketTickerPrice(value: number | null): string {
  if (value == null) {
    return "USD 대기";
  }

  if (value >= 1000) {
    return USD_CURRENCY_WHOLE.format(value);
  }
  if (value >= 1) {
    return USD_CURRENCY.format(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatMarketTickerKrwPrice(value: number | null): string {
  if (value == null) {
    return "KRW 대기";
  }

  return KRW_CURRENCY.format(value);
}

export function formatMarketTickerChange(value: number | null): string {
  if (value == null) {
    return "변동률 없음";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatKimchiPremium(value: number | null): string {
  if (value == null) {
    return "김프 대기";
  }

  const sign = value > 0 ? "+" : "";
  return `김프 ${sign}${value.toFixed(2)}%`;
}

export function formatMarketTickerUpdatedAt(value: number | null): string {
  if (value == null) {
    return "업데이트 대기";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "업데이트 대기";
  }

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${lookup.year}.${lookup.month}.${lookup.day} ${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

export function marketTickerTone(
  value: number | null,
): "positive" | "negative" | "neutral" {
  if (value == null) {
    return "neutral";
  }
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return "neutral";
}
