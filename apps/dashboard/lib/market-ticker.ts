import {
  createLocalUsdKrwFxQuote,
  fetchUsdKrwFx,
  type UsdKrwFxQuote,
} from "./market-fx";
import { calcOptionalKimchiPremium } from "./market-premium";

export type MarketTickerSource = "live" | "rest" | "local";

export type MarketTickerDefinition = {
  id: string;
  asset: string;
  label: string;
  binanceSymbol: string;
  upbitMarket: string;
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

type MergeSnapshotOptions = {
  definitions?: MarketTickerDefinition[];
  binanceQuotes?: Map<string, BinanceTickerQuote>;
  upbitQuotes?: Map<string, UpbitTickerQuote>;
  fxQuote?: UsdKrwFxQuote | null;
  source: MarketTickerSource;
  useFallbackValues: boolean;
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
  upbitQuotes = new Map<string, UpbitTickerQuote>(),
  fxQuote,
  source,
  useFallbackValues,
}: MergeSnapshotOptions): MarketTickerItem[] {
  return definitions.map((definition) => {
    const binanceQuote = binanceQuotes.get(definition.id);
    const upbitQuote = upbitQuotes.get(definition.id);

    return hydrateMarketTickerItem(definition, {
      priceUsd:
        binanceQuote?.priceUsd ??
        (useFallbackValues ? definition.fallbackPriceUsd : null),
      priceKrw:
        upbitQuote?.priceKrw ??
        (useFallbackValues ? definition.fallbackPriceKrw : null),
      usdChange24hPct:
        binanceQuote?.change24hPct ??
        (useFallbackValues ? definition.fallbackUsdChange24hPct : null),
      krwChange24hPct:
        upbitQuote?.change24hPct ??
        (useFallbackValues ? definition.fallbackKrwChange24hPct : null),
      usdKrwFx:
        fxQuote?.usdKrw ??
        (useFallbackValues ? createLocalUsdKrwFxQuote().usdKrw : null),
      lastUpdatedAt: maxTimestamp(
        binanceQuote?.updatedAt,
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

export async function fetchMarketTickerSnapshot(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
  timeoutMs = 4500,
): Promise<MarketTickerItem[]> {
  if (definitions.length === 0) {
    return [];
  }

  const [binanceResult, upbitResult, fxResult] = await Promise.allSettled([
    fetchBinanceTickerSnapshot(definitions, timeoutMs),
    fetchUpbitTickerSnapshot(definitions, timeoutMs),
    fetchUsdKrwFx(timeoutMs),
  ]);

  const items = buildMergedMarketTickerItems({
    definitions,
    binanceQuotes:
      binanceResult.status === "fulfilled"
        ? binanceResult.value
        : new Map<string, BinanceTickerQuote>(),
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

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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
