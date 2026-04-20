export type UsdKrwFxSource = "rest" | "upbit" | "local";

export type UsdKrwFxQuote = {
  usdKrw: number;
  updatedAt: number;
  source: UsdKrwFxSource;
};

type ExchangeRateHostResponse = {
  rates?: {
    KRW?: number;
  };
  date?: string;
};

type OpenErApiResponse = {
  result?: string;
  rates?: {
    KRW?: number;
  };
  time_last_update_unix?: number;
};

type UpbitUsdtTickerResponse = Array<{
  trade_price?: number;
  trade_timestamp?: number;
}>;

export const DEFAULT_USD_KRW_FX = 1378;

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function buildTimeoutSignal(timeoutMs: number): {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return { controller, timeoutId };
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const { controller, timeoutId } = buildTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchUsdKrwFromExchangeRateHost(timeoutMs: number): Promise<UsdKrwFxQuote | null> {
  const payload = await fetchJsonWithTimeout<ExchangeRateHostResponse>(
    "https://api.exchangerate.host/latest?base=USD&symbols=KRW",
    timeoutMs,
  );
  const usdKrw = payload.rates?.KRW;

  if (!isFinitePositive(usdKrw)) {
    return null;
  }

  return {
    usdKrw,
    updatedAt: payload.date ? Date.parse(`${payload.date}T00:00:00Z`) || Date.now() : Date.now(),
    source: "rest",
  };
}

async function fetchUsdKrwFromOpenErApi(timeoutMs: number): Promise<UsdKrwFxQuote | null> {
  const payload = await fetchJsonWithTimeout<OpenErApiResponse>(
    "https://open.er-api.com/v6/latest/USD",
    timeoutMs,
  );
  const usdKrw = payload.rates?.KRW;

  if (payload.result !== "success" || !isFinitePositive(usdKrw)) {
    return null;
  }

  return {
    usdKrw,
    updatedAt:
      typeof payload.time_last_update_unix === "number"
        ? payload.time_last_update_unix * 1000
        : Date.now(),
    source: "rest",
  };
}

async function fetchUsdKrwFromUpbitUsdt(timeoutMs: number): Promise<UsdKrwFxQuote | null> {
  const payload = await fetchJsonWithTimeout<UpbitUsdtTickerResponse>(
    "/api/proxy/upbit/ticker?markets=KRW-USDT",
    timeoutMs,
  );
  const row = Array.isArray(payload) ? payload[0] : null;
  const usdKrw = row?.trade_price;

  if (!isFinitePositive(usdKrw)) {
    return null;
  }

  return {
    usdKrw,
    updatedAt: typeof row?.trade_timestamp === "number" ? row.trade_timestamp : Date.now(),
    source: "upbit",
  };
}

export function createLocalUsdKrwFxQuote(usdKrw = DEFAULT_USD_KRW_FX): UsdKrwFxQuote {
  return {
    usdKrw,
    updatedAt: Date.now(),
    source: "local",
  };
}

export async function fetchUsdKrwFx(timeoutMs = 4500): Promise<UsdKrwFxQuote | null> {
  const primary = await fetchUsdKrwFromExchangeRateHost(timeoutMs).catch(() => null);
  if (primary) {
    return primary;
  }

  const secondary = await fetchUsdKrwFromOpenErApi(timeoutMs).catch(() => null);
  if (secondary) {
    return secondary;
  }

  return fetchUsdKrwFromUpbitUsdt(timeoutMs).catch(() => null);
}
