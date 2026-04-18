"use client";

import { useEffect, useRef, useState } from "react";
import {
  appendMarketTickerChartPoint,
  DEFAULT_MARKET_TICKER_SYMBOLS,
  buildMarketTickerStreamUrl,
  buildUpbitTickerSubscriptionPayload,
  createLocalMarketTickerChartPoints,
  createLocalMarketTickerItems,
  createPendingMarketTickerItems,
  fetchMarketTickerMiniCharts,
  fetchMarketTickerSnapshot,
  formatKimchiPremium,
  formatMarketTickerChange,
  formatMarketTickerKrwPrice,
  formatMarketTickerPrice,
  formatMarketTickerUpdatedAt,
  marketTickerTone,
  mergeMarketTickerMessage,
  mergeMarketTickerSnapshot,
  mergeUpbitMarketTickerMessage,
  type MarketTickerChartPoint,
  type MarketTickerDefinition,
  type MarketTickerItem,
  type MarketTickerSource,
} from "@/lib/market-ticker";
import { MarketDetailChart } from "./market-detail-chart";
import { MarketMiniChart } from "./market-mini-chart";
import styles from "./market-ticker-strip.module.css";

type MarketTickerStripProps = {
  symbols?: MarketTickerDefinition[];
  title?: string;
  eyebrow?: string;
  className?: string;
};

type Phase = "loading" | "ready" | "fallback" | "error";

function fallbackChartForDefinition(definition: MarketTickerDefinition): MarketTickerChartPoint[] {
  return createLocalMarketTickerChartPoints({
    id: `${definition.id}-mini`,
    value: definition.fallbackPriceUsd,
    changePct: definition.fallbackUsdChange24hPct,
    pointCount: 48,
  });
}

function fallbackChartForItem(item: MarketTickerItem): MarketTickerChartPoint[] {
  return createLocalMarketTickerChartPoints({
    id: `${item.id}-mini`,
    value: item.priceUsd ?? item.priceKrw ?? 1,
    changePct: item.usdChange24hPct ?? item.krwChange24hPct,
    pointCount: 48,
  });
}

function mergeMiniChartsFromItems(
  current: Record<string, MarketTickerChartPoint[]>,
  nextItems: MarketTickerItem[],
): Record<string, MarketTickerChartPoint[]> {
  const nextCharts = { ...current };

  for (const item of nextItems) {
    const existing = nextCharts[item.id];
    if (!existing || existing.length === 0) {
      nextCharts[item.id] = fallbackChartForItem(item);
      continue;
    }

    nextCharts[item.id] = appendMarketTickerChartPoint(
      existing,
      item.priceUsd,
      item.lastUpdatedAt,
      Math.max(existing.length, 48),
    );
  }

  return nextCharts;
}

function sourceLabel(source: MarketTickerSource | "idle"): string {
  if (source === "live") {
    return "Live";
  }
  if (source === "rest") {
    return "REST";
  }
  if (source === "local") {
    return "Local";
  }
  return "Idle";
}

function combineClassName(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function decodeSocketPayload(data: string | ArrayBuffer | Blob): Promise<string> {
  if (typeof data === "string") {
    return Promise.resolve(data);
  }
  if (data instanceof ArrayBuffer) {
    return Promise.resolve(new TextDecoder().decode(data));
  }
  return data.text();
}

function LoadingCard({ index }: { index: number }) {
  return (
    <article className={styles.card} aria-hidden="true" data-loading-index={index}>
      <div className={styles.loadingBlock} />
      <div className={styles.loadingPrice} />
      <div className={styles.loadingLine} />
      <div className={styles.loadingLine} />
    </article>
  );
}

export function MarketTickerStrip({
  symbols = DEFAULT_MARKET_TICKER_SYMBOLS,
  title = "시장 티커 스트립",
  eyebrow = "Market pulse",
  className,
}: MarketTickerStripProps) {
  const [items, setItems] = useState<MarketTickerItem[]>([]);
  const [miniCharts, setMiniCharts] = useState<Record<string, MarketTickerChartPoint[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(symbols.length === 0 ? "ready" : "loading");
  const [source, setSource] = useState<MarketTickerSource | "idle">("idle");
  const [notice, setNotice] = useState("Binance USD / Upbit KRW 시세 연결을 준비 중입니다.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const binanceSocketRef = useRef<WebSocket | null>(null);
  const upbitSocketRef = useRef<WebSocket | null>(null);
  const hasSnapshotRef = useRef(false);
  const hasBinanceLiveRef = useRef(false);
  const hasUpbitLiveRef = useRef(false);

  useEffect(() => {
    if (symbols.length === 0) {
      setItems([]);
      setPhase("ready");
      setSource("idle");
      setNotice("표시할 심볼이 아직 없습니다.");
      setErrorMessage(null);
      setMiniCharts({});
      setExpandedId(null);
      return;
    }

    let cancelled = false;

    const hasAnyLive = () => hasBinanceLiveRef.current || hasUpbitLiveRef.current;

    const applyLocalFallback = (message: string, detail?: string) => {
      if (cancelled) {
        return;
      }

      setItems(createLocalMarketTickerItems(symbols));
      setMiniCharts(
        Object.fromEntries(
          symbols.map((definition) => [definition.id, fallbackChartForDefinition(definition)]),
        ),
      );
      setPhase("fallback");
      setSource("local");
      setNotice(message);
      setErrorMessage(detail ?? null);
    };

    const refreshSnapshot = async (mode: "initial" | "background") => {
      try {
        const snapshot = await fetchMarketTickerSnapshot(symbols);
        if (cancelled || snapshot.length === 0) {
          return;
        }

        hasSnapshotRef.current = true;
        setItems((current) =>
          {
            const nextItems =
              current.length > 0 && hasAnyLive()
                ? mergeMarketTickerSnapshot(current, snapshot, {
                    preserveLiveUsd: hasBinanceLiveRef.current,
                    preserveLiveKrw: hasUpbitLiveRef.current,
                    source: "live",
                  })
                : snapshot;
            setMiniCharts((currentCharts) => mergeMiniChartsFromItems(currentCharts, nextItems));
            return nextItems;
          }
        );
        setPhase("ready");
        setSource(hasAnyLive() ? "live" : "rest");
        setErrorMessage(null);
        setNotice(
          mode === "initial"
            ? "Binance USD, Upbit KRW, 환율 스냅샷을 불러왔습니다."
            : "백그라운드에서 KRW 가격과 김프 기준 환율을 새로고침했습니다."
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (!hasSnapshotRef.current && !hasAnyLive()) {
          applyLocalFallback(
            "네트워크 접근이 제한되어 예시 USD/KRW 시세를 표시합니다.",
            error instanceof Error ? error.message : "snapshot_unavailable",
          );
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "snapshot_refresh_failed");
      }
    };

    const syncSourceAfterSocketClose = () => {
      if (cancelled) {
        return;
      }

      if (hasAnyLive()) {
        setSource("live");
        return;
      }

      if (hasSnapshotRef.current) {
        setSource("rest");
        setNotice("라이브 연결 없이 REST 스냅샷 기준으로 유지합니다.");
        return;
      }

      applyLocalFallback("네트워크 연결이 없어 예시 USD/KRW 시세를 표시합니다.", "stream_closed");
    };

    const connectBinanceStream = () => {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        return;
      }

      try {
        const socket = new window.WebSocket(buildMarketTickerStreamUrl(symbols));
        binanceSocketRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            return;
          }
          setNotice("Binance USD 실시간 스트림을 연결했습니다.");
        };

        socket.onmessage = (event) => {
          if (cancelled || typeof event.data !== "string") {
            return;
          }

          hasBinanceLiveRef.current = true;
          setItems((current) => {
            const nextItems = mergeMarketTickerMessage(
              current.length > 0 ? current : createPendingMarketTickerItems(symbols),
              symbols,
              event.data,
            );
            setMiniCharts((currentCharts) => mergeMiniChartsFromItems(currentCharts, nextItems));
            return nextItems;
          });
          setPhase("ready");
          setSource("live");
          setErrorMessage(null);
          setNotice("Binance USD와 Upbit KRW를 조합해 김프를 계산 중입니다.");
        };

        socket.onerror = () => {
          if (cancelled) {
            return;
          }

          if (!hasSnapshotRef.current && !hasAnyLive()) {
            applyLocalFallback("Binance 실시간 연결이 열리지 않아 예시 시세로 대체했습니다.", "binance_live_stream_unavailable");
            return;
          }

          setErrorMessage("binance_live_stream_unavailable");
        };

        socket.onclose = () => {
          hasBinanceLiveRef.current = false;
          syncSourceAfterSocketClose();
        };
      } catch (error) {
        applyLocalFallback(
          "Binance 실시간 스트림을 열 수 없어 예시 USD/KRW 시세를 표시합니다.",
          error instanceof Error ? error.message : "binance_stream_init_failed",
        );
      }
    };

    const connectUpbitStream = () => {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        return;
      }

      try {
        const socket = new window.WebSocket("wss://api.upbit.com/websocket/v1");
        socket.binaryType = "arraybuffer";
        upbitSocketRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            return;
          }
          socket.send(buildUpbitTickerSubscriptionPayload(symbols));
          setNotice("Upbit KRW 실시간 스트림을 연결했습니다.");
        };

        socket.onmessage = (event) => {
          void decodeSocketPayload(event.data).then((payload) => {
            if (cancelled) {
              return;
            }

            hasUpbitLiveRef.current = true;
            setItems((current) => {
              const nextItems = mergeUpbitMarketTickerMessage(
                current.length > 0 ? current : createPendingMarketTickerItems(symbols),
                symbols,
                payload,
              );
              setMiniCharts((currentCharts) => mergeMiniChartsFromItems(currentCharts, nextItems));
              return nextItems;
            });
            setPhase("ready");
            setSource("live");
            setErrorMessage(null);
            setNotice("Upbit KRW와 USD 환산가를 조합해 김프를 계산 중입니다.");
          }).catch(() => {
            if (!cancelled) {
              setErrorMessage("upbit_live_payload_decode_failed");
            }
          });
        };

        socket.onerror = () => {
          if (cancelled) {
            return;
          }

          if (!hasSnapshotRef.current && !hasAnyLive()) {
            applyLocalFallback("Upbit 실시간 연결이 열리지 않아 예시 시세로 대체했습니다.", "upbit_live_stream_unavailable");
            return;
          }

          setErrorMessage("upbit_live_stream_unavailable");
        };

        socket.onclose = () => {
          hasUpbitLiveRef.current = false;
          syncSourceAfterSocketClose();
        };
      } catch (error) {
        applyLocalFallback(
          "Upbit 실시간 스트림을 열 수 없어 예시 USD/KRW 시세를 표시합니다.",
          error instanceof Error ? error.message : "upbit_stream_init_failed",
        );
      }
    };

    setPhase("loading");
    setSource("idle");
    setItems([]);
    setMiniCharts({});
    setExpandedId(null);
    setNotice("Binance USD / Upbit KRW 시세 연결을 준비 중입니다.");
    setErrorMessage(null);
    hasSnapshotRef.current = false;
    hasBinanceLiveRef.current = false;
    hasUpbitLiveRef.current = false;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      applyLocalFallback("오프라인 상태라 예시 USD/KRW 시세를 먼저 표시합니다.", "offline");
      return;
    }

    void refreshSnapshot("initial");
    void fetchMarketTickerMiniCharts(symbols)
      .then((nextCharts) => {
        if (cancelled) {
          return;
        }

        setMiniCharts((currentCharts) => {
          const fallbackEntries = Object.fromEntries(
            symbols.map((definition) => [
              definition.id,
              fallbackChartForDefinition(definition),
            ]),
          );

          return {
            ...fallbackEntries,
            ...currentCharts,
            ...nextCharts,
          };
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setMiniCharts(
          Object.fromEntries(
            symbols.map((definition) => [definition.id, fallbackChartForDefinition(definition)]),
          ),
        );
      });
    connectBinanceStream();
    connectUpbitStream();

    const refreshTimer = window.setInterval(() => {
      void refreshSnapshot("background");
    }, 300_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);

      if (binanceSocketRef.current) {
        binanceSocketRef.current.close();
        binanceSocketRef.current = null;
      }

      if (upbitSocketRef.current) {
        upbitSocketRef.current.close();
        upbitSocketRef.current = null;
      }
    };
  }, [symbols]);

  const rootClassName = combineClassName(styles.panel, className);
  const lastUpdatedAt = items.reduce<number | null>((latest, item) => {
    if (item.lastUpdatedAt == null) {
      return latest;
    }
    if (latest == null || item.lastUpdatedAt > latest) {
      return item.lastUpdatedAt;
    }
    return latest;
  }, null);

  if (symbols.length === 0) {
    return (
      <section className={rootClassName}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 className={styles.title}>{title}</h2>
          </div>
        </div>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>티커 심볼이 비어 있습니다.</p>
          <p className={styles.emptyBody}>
            마운트 시 `symbols`를 전달하면 고정된 심볼 스트립으로 사용할 수 있습니다.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={rootClassName} aria-busy={phase === "loading"}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 className={styles.title}>{title}</h2>
        </div>

        <div className={styles.headerMeta}>
          <span className={styles.sourcePill} data-source={source}>
            <span className={styles.sourceDot} />
            {sourceLabel(source)}
          </span>
          <span className={styles.updatedAt}>
            {formatMarketTickerUpdatedAt(lastUpdatedAt)}
          </span>
        </div>
      </div>

      <p
        className={styles.notice}
        data-tone={
          phase === "fallback" || errorMessage
            ? "warn"
            : phase === "error"
              ? "bad"
              : "neutral"
        }
      >
        {phase === "loading"
          ? "Binance USD / Upbit KRW 시세 연결을 준비 중입니다."
          : notice}
      </p>

      {phase === "loading" ? (
        <div className={styles.strip}>
          {symbols.map((item, index) => (
            <LoadingCard index={index} key={item.id} />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className={styles.strip}>
          {items.map((item) => {
            const changeValue = item.usdChange24hPct ?? item.krwChange24hPct;
            const premiumTone = marketTickerTone(item.kimchiPremiumPct);
            const isExpanded = expandedId === item.id;
            const definition =
              symbols.find((entry) => entry.id === item.id) ??
              DEFAULT_MARKET_TICKER_SYMBOLS.find((entry) => entry.id === item.id);
            const chartPoints = miniCharts[item.id] ?? fallbackChartForItem(item);

            return (
              <article key={item.id} className={styles.card} data-source={item.source}>
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.asset}>{item.asset}</p>
                    <p className={styles.label}>{item.label}</p>
                  </div>
                  <span className={styles.change} data-tone={marketTickerTone(changeValue)}>
                    {formatMarketTickerChange(changeValue)}
                  </span>
                </div>

                <div className={styles.priceBlock}>
                  <strong className={styles.price}>
                    {formatMarketTickerPrice(item.priceUsd)}
                  </strong>
                  <span className={styles.secondaryPrice}>
                    {formatMarketTickerKrwPrice(item.priceKrw)}
                  </span>
                </div>

                <div className={styles.chartBlock}>
                  <MarketMiniChart
                    label={`${item.asset} 최근 가격 흐름`}
                    points={chartPoints}
                    tone={marketTickerTone(changeValue)}
                  />
                </div>

                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>{item.usdMarketLabel}</span>
                  <span className={styles.metricValue}>
                    {item.usdChange24hPct == null
                      ? "USD 24h 대기"
                      : `USD 24h ${formatMarketTickerChange(item.usdChange24hPct)}`}
                  </span>
                </div>

                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>{item.krwMarketLabel}</span>
                  <span className={styles.metricValue}>
                    {item.krwChange24hPct == null
                      ? "KRW 24h 대기"
                      : `KRW 24h ${formatMarketTickerChange(item.krwChange24hPct)}`}
                  </span>
                </div>

                <div className={styles.cardFooter}>
                  <span className={styles.premiumPill} data-tone={premiumTone}>
                    {formatKimchiPremium(item.kimchiPremiumPct)}
                  </span>
                  <div className={styles.cardFooterActions}>
                    <span>
                      {item.source === "local"
                        ? "예시 시세"
                        : item.source === "live"
                          ? "실시간"
                          : "스냅샷"}
                    </span>
                    {definition ? (
                      <button
                        type="button"
                        className={styles.detailButton}
                        onClick={() =>
                          setExpandedId((current) => (current === item.id ? null : item.id))
                        }
                      >
                        {isExpanded ? "차트 접기" : "차트 보기"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isExpanded && definition ? (
                  <MarketDetailChart definition={definition} item={item} />
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>표시할 시세가 없습니다.</p>
          <p className={styles.emptyBody}>
            공개 API 응답이 비어 있거나 아직 초기 USD/KRW 데이터가 준비되지 않았습니다.
          </p>
        </div>
      )}
    </section>
  );
}
