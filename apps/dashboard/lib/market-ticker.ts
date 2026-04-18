export type MarketTickerSource = "live" | "rest" | "local";

export type MarketTickerDefinition = {
  id: string;
  asset: string;
  label: string;
  binanceSymbol: string;
  marketLabel: string;
  fallbackPriceUsd: number;
  fallbackChange24hPct: number;
};

export type MarketTickerItem = {
  id: string;
  asset: string;
  label: string;
  marketLabel: string;
  priceUsd: number | null;
  change24hPct: number | null;
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

export const DEFAULT_MARKET_TICKER_SYMBOLS: MarketTickerDefinition[] = [
  {
    id: "btc",
    asset: "BTC",
    label: "Bitcoin",
    binanceSymbol: "BTCUSDT",
    marketLabel: "BINANCE · USDT",
    fallbackPriceUsd: 84620,
    fallbackChange24hPct: 2.8,
  },
  {
    id: "eth",
    asset: "ETH",
    label: "Ethereum",
    binanceSymbol: "ETHUSDT",
    marketLabel: "BINANCE · USDT",
    fallbackPriceUsd: 1625,
    fallbackChange24hPct: 1.9,
  },
  {
    id: "sol",
    asset: "SOL",
    label: "Solana",
    binanceSymbol: "SOLUSDT",
    marketLabel: "BINANCE · USDT",
    fallbackPriceUsd: 134.7,
    fallbackChange24hPct: 4.1,
  },
  {
    id: "xrp",
    asset: "XRP",
    label: "Ripple",
    binanceSymbol: "XRPUSDT",
    marketLabel: "BINANCE · USDT",
    fallbackPriceUsd: 0.61,
    fallbackChange24hPct: -0.8,
  },
  {
    id: "doge",
    asset: "DOGE",
    label: "Dogecoin",
    binanceSymbol: "DOGEUSDT",
    marketLabel: "BINANCE · USDT",
    fallbackPriceUsd: 0.17,
    fallbackChange24hPct: 3.4,
  },
  {
    id: "ada",
    asset: "ADA",
    label: "Cardano",
    binanceSymbol: "ADAUSDT",
    marketLabel: "BINANCE · USDT",
    fallbackPriceUsd: 0.48,
    fallbackChange24hPct: 0.7,
  },
];

function parseNumber(value: string | undefined): number | null {
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

function definitionMap(definitions: MarketTickerDefinition[]): Map<string, MarketTickerDefinition> {
  return new Map(definitions.map((item) => [item.binanceSymbol, item]));
}

export function createLocalMarketTickerItems(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS
): MarketTickerItem[] {
  const now = Date.now();

  return definitions.map((item) => ({
    id: item.id,
    asset: item.asset,
    label: item.label,
    marketLabel: item.marketLabel,
    priceUsd: item.fallbackPriceUsd,
    change24hPct: item.fallbackChange24hPct,
    lastUpdatedAt: now,
    source: "local",
  }));
}

export async function fetchMarketTickerSnapshot(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS,
  timeoutMs = 4500
): Promise<MarketTickerItem[]> {
  if (definitions.length === 0) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const query = encodeURIComponent(JSON.stringify(definitions.map((item) => item.binanceSymbol)));
    const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as Binance24HourTicker[] | Binance24HourTicker;
    const rows = Array.isArray(payload) ? payload : [payload];
    const bySymbol = definitionMap(definitions);

    const items: MarketTickerItem[] = [];

    for (const row of rows) {
      const symbol = row.symbol ?? "";
      const definition = bySymbol.get(symbol);
      if (!definition) {
        continue;
      }

      items.push({
        id: definition.id,
        asset: definition.asset,
        label: definition.label,
        marketLabel: definition.marketLabel,
        priceUsd: parseNumber(row.lastPrice),
        change24hPct: parseNumber(row.priceChangePercent),
        lastUpdatedAt: typeof row.closeTime === "number" ? row.closeTime : Date.now(),
        source: "rest",
      });
    }

    return items;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function buildMarketTickerStreamUrl(
  definitions: MarketTickerDefinition[] = DEFAULT_MARKET_TICKER_SYMBOLS
): string {
  const streams = definitions
    .map((item) => `${item.binanceSymbol.toLowerCase()}@miniTicker`)
    .join("/");

  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

export function mergeMarketTickerMessage(
  current: MarketTickerItem[],
  definitions: MarketTickerDefinition[],
  payload: string
): MarketTickerItem[] {
  const parsed = parseMarketTickerMessage(payload);
  if (parsed.length === 0) {
    return current;
  }

  const bySymbol = definitionMap(definitions);
  const updates = new Map<string, MarketTickerItem>();

  for (const event of parsed) {
    const symbol = event.s ?? "";
    const definition = bySymbol.get(symbol);
    if (!definition) {
      continue;
    }

    const close = parseNumber(event.c);
    const open = parseNumber(event.o);
    updates.set(definition.id, {
      id: definition.id,
      asset: definition.asset,
      label: definition.label,
      marketLabel: definition.marketLabel,
      priceUsd: close,
      change24hPct: percentFromOpenClose(open, close),
      lastUpdatedAt: typeof event.E === "number" ? event.E : Date.now(),
      source: "live",
    });
  }

  if (updates.size === 0) {
    return current;
  }

  const currentById = new Map(current.map((item) => [item.id, item]));

  return definitions.map((definition) => {
    const liveItem = updates.get(definition.id);
    if (liveItem) {
      return liveItem;
    }
    return (
      currentById.get(definition.id) ?? {
        id: definition.id,
        asset: definition.asset,
        label: definition.label,
        marketLabel: definition.marketLabel,
        priceUsd: definition.fallbackPriceUsd,
        change24hPct: definition.fallbackChange24hPct,
        lastUpdatedAt: Date.now(),
        source: "local" as const,
      }
    );
  });
}

export function parseMarketTickerMessage(payload: string): BinanceMiniTicker[] {
  try {
    const raw = JSON.parse(payload) as BinanceMiniTickerEnvelope | BinanceMiniTickerEnvelope[];
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

export function formatMarketTickerPrice(value: number | null): string {
  if (value == null) {
    return "가격 확인 중";
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

export function formatMarketTickerChange(value: number | null): string {
  if (value == null) {
    return "변동률 없음";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
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

export function marketTickerTone(value: number | null): "positive" | "negative" | "neutral" {
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
