"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
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
} from "@/lib/market-ticker";

import { MarketDetailChartModal } from "./market-detail-chart-modal";
import { MarketMiniChart } from "./market-mini-chart";
import {
  MarketTickerSourceChips,
  type MarketTickerChipStatus,
  type MarketTickerSourceChip,
} from "./market-ticker-source-chips";
import styles from "./market-ticker-strip.module.css";

type MarketTickerStripProps = {
  symbols?: MarketTickerDefinition[];
  title?: string;
  eyebrow?: string;
  className?: string;
  initialLanguage: DashboardLanguage;
};

type Phase = "loading" | "ready" | "fallback";
type TickerSourceKey = "binance" | "upbit" | "fx" | "snapshot";

type SourceHealth = {
  available: boolean;
  lastSeenAt: number | null;
  isConnecting: boolean;
  errorAt: number | null;
  closedAt: number | null;
};

type SourceHealthState = Record<TickerSourceKey, SourceHealth>;

const LIVE_WINDOW_MS = 15_000;
const DOWN_WINDOW_MS = 45_000;

function fallbackChartForDefinition(
  definition: MarketTickerDefinition,
): MarketTickerChartPoint[] {
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

function createInitialSourceHealth(): SourceHealthState {
  return {
    binance: {
      available: false,
      lastSeenAt: null,
      isConnecting: true,
      errorAt: null,
      closedAt: null,
    },
    upbit: {
      available: false,
      lastSeenAt: null,
      isConnecting: true,
      errorAt: null,
      closedAt: null,
    },
    fx: {
      available: false,
      lastSeenAt: null,
      isConnecting: true,
      errorAt: null,
      closedAt: null,
    },
    snapshot: {
      available: false,
      lastSeenAt: null,
      isConnecting: true,
      errorAt: null,
      closedAt: null,
    },
  };
}

function createUnavailableSourceHealth(at: number): SourceHealthState {
  return {
    binance: {
      available: false,
      lastSeenAt: null,
      isConnecting: false,
      errorAt: at,
      closedAt: null,
    },
    upbit: {
      available: false,
      lastSeenAt: null,
      isConnecting: false,
      errorAt: at,
      closedAt: null,
    },
    fx: {
      available: false,
      lastSeenAt: null,
      isConnecting: false,
      errorAt: at,
      closedAt: null,
    },
    snapshot: {
      available: false,
      lastSeenAt: null,
      isConnecting: false,
      errorAt: at,
      closedAt: null,
    },
  };
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

function sourceStatus(
  state: SourceHealth,
  now: number,
  phase: Phase,
): MarketTickerChipStatus {
  const lastFailureAt = Math.max(state.errorAt ?? 0, state.closedAt ?? 0);

  if (lastFailureAt > 0 && (state.lastSeenAt == null || lastFailureAt >= state.lastSeenAt)) {
    return "down";
  }

  if (state.lastSeenAt == null) {
    return phase === "loading" || state.isConnecting ? "connecting" : "down";
  }

  const age = now - state.lastSeenAt;
  if (age <= LIVE_WINDOW_MS) {
    return "live";
  }
  if (age <= DOWN_WINDOW_MS) {
    return "stale";
  }
  return "down";
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
  initialLanguage,
}: MarketTickerStripProps) {
  const { language } = useDashboardI18n(initialLanguage);
  const stripId = useId();
  const [items, setItems] = useState<MarketTickerItem[]>([]);
  const [miniCharts, setMiniCharts] = useState<Record<string, MarketTickerChartPoint[]>>({});
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [phase, setPhase] = useState<Phase>(symbols.length === 0 ? "ready" : "loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthState>(() =>
    createInitialSourceHealth(),
  );
  const [clock, setClock] = useState(() => Date.now());
  const copy = useMemo(
    () =>
      language === "ko"
        ? {
            liveDisconnectedSnapshot: "실시간 연결이 끊겨 최신 스냅샷 기준으로 유지합니다.",
            allUnavailableLocal: "실시간/스냅샷 연결이 모두 없어 예시 USD/KRW 시세를 표시합니다.",
            snapshotHolding: "최신 스냅샷 기준으로 시세를 유지합니다.",
            snapshotRefreshFailed: "스냅샷 새로고침에 실패해 이전 데이터 기준으로 유지합니다.",
            networkLimitedLocal: "네트워크 접근이 제한되어 예시 USD/KRW 시세를 표시합니다.",
            binanceUnavailable: "Binance 실시간 연결이 열리지 않아 예시 시세로 대체했습니다.",
            binanceInitFailed: "Binance 실시간 스트림을 열 수 없어 예시 USD/KRW 시세를 표시합니다.",
            upbitUnavailable: "Upbit 실시간 연결이 열리지 않아 예시 시세로 대체했습니다.",
            upbitInitFailed: "Upbit 실시간 스트림을 열 수 없어 예시 USD/KRW 시세를 표시합니다.",
            offlineLocal: "오프라인 상태라 예시 USD/KRW 시세를 먼저 표시합니다.",
            mobileCollapse: "접기",
            mobileExpand: "펼치기",
            mobileCollapseAria: "시장 티커 접기",
            mobileExpandAria: (count: number) => `시장 티커 ${count}개 더 펼치기`,
            emptySymbolsTitle: "티커 심볼이 비어 있습니다.",
            emptySymbolsBody: "마운트 시 `symbols`를 전달하면 고정된 심볼 스트립으로 사용할 수 있습니다.",
            sourceAria: "시장 데이터 소스 상태",
            statusConnecting: "연결 중",
            statusLive: "실시간",
            statusStale: "지연",
            statusDown: "중단",
            updatedAtLabel: "마지막 갱신",
            updatedAtPending: "업데이트 대기",
            usdWaiting: "USD 24h 대기",
            krwWaiting: "KRW 24h 대기",
            currentUsdWaiting: "USD 대기",
            currentKrwWaiting: "KRW 대기",
            premiumWaiting: "김프 대기",
            sourceLocal: "예시 시세",
            sourceLive: "실시간",
            sourceSnapshot: "스냅샷",
            detailChart: "상세 차트",
            emptyTitle: "표시할 시세가 없습니다.",
            emptyBody: "공개 API 응답이 비어 있거나 아직 초기 USD/KRW 데이터가 준비되지 않았습니다.",
          }
        : {
            liveDisconnectedSnapshot: "Live streams disconnected. Holding the latest snapshot.",
            allUnavailableLocal: "Live and snapshot feeds are unavailable, so preview USD/KRW prices are shown.",
            snapshotHolding: "Holding prices from the latest snapshot.",
            snapshotRefreshFailed: "Snapshot refresh failed. Keeping the previous data.",
            networkLimitedLocal: "Network access is limited, so preview USD/KRW prices are shown.",
            binanceUnavailable: "Binance live stream is unavailable, so preview prices are shown.",
            binanceInitFailed: "Could not open the Binance live stream, so preview USD/KRW prices are shown.",
            upbitUnavailable: "Upbit live stream is unavailable, so preview prices are shown.",
            upbitInitFailed: "Could not open the Upbit live stream, so preview USD/KRW prices are shown.",
            offlineLocal: "You are offline, so preview USD/KRW prices are shown first.",
            mobileCollapse: "Collapse",
            mobileExpand: "Show more",
            mobileCollapseAria: "Collapse market ticker cards",
            mobileExpandAria: (count: number) => `Show ${count} more market ticker cards`,
            emptySymbolsTitle: "No ticker symbols are configured.",
            emptySymbolsBody: "Pass `symbols` when mounting this component to render a fixed market ticker strip.",
            sourceAria: "Market data source status",
            statusConnecting: "Connecting",
            statusLive: "Live",
            statusStale: "Stale",
            statusDown: "Down",
            updatedAtLabel: "Last update",
            updatedAtPending: "Waiting for update",
            usdWaiting: "Waiting for USD 24h",
            krwWaiting: "Waiting for KRW 24h",
            currentUsdWaiting: "Waiting for USD",
            currentKrwWaiting: "Waiting for KRW",
            premiumWaiting: "Waiting for premium",
            sourceLocal: "Preview",
            sourceLive: "Live",
            sourceSnapshot: "Snapshot",
            detailChart: "Detail chart",
            emptyTitle: "No market prices are available.",
            emptyBody: "The public APIs returned no rows, or the initial USD/KRW data has not been prepared yet.",
          },
    [language],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (symbols.length === 0) {
      setItems([]);
      setPhase("ready");
      setNotice(null);
      setErrorMessage(null);
      setMiniCharts({});
      setSelectedItemId(null);
      setSourceHealth(createInitialSourceHealth());
      return;
    }

    let cancelled = false;
    let hasSnapshot = false;
    let hasBinanceLive = false;
    let hasUpbitLive = false;
    let hasEverReceivedLive = false;
    let binanceSocket: WebSocket | null = null;
    let upbitSocket: WebSocket | null = null;

    const hasAnyLive = () => hasBinanceLive || hasUpbitLive;

    const updateSource = (key: TickerSourceKey, patch: Partial<SourceHealth>) => {
      if (cancelled) {
        return;
      }

      setSourceHealth((current) => ({
        ...current,
        [key]: {
          ...current[key],
          ...patch,
        },
      }));
    };

    const applyLocalFallback = (message: string, detail?: string) => {
      if (cancelled) {
        return;
      }

      const occurredAt = Date.now();
      setItems(createLocalMarketTickerItems(symbols));
      setMiniCharts(
        Object.fromEntries(
          symbols.map((definition) => [definition.id, fallbackChartForDefinition(definition)]),
        ),
      );
      setPhase("fallback");
      setNotice(message);
      setErrorMessage(detail ?? null);
      setSourceHealth(createUnavailableSourceHealth(occurredAt));
    };

    const syncFallbackState = () => {
      if (cancelled) {
        return;
      }

      if (hasAnyLive()) {
        setPhase("ready");
        setNotice(null);
        setErrorMessage(null);
        return;
      }

      if (hasSnapshot) {
        setPhase(hasEverReceivedLive ? "fallback" : "ready");
        setNotice(
          hasEverReceivedLive ? copy.liveDisconnectedSnapshot : null,
        );
        setErrorMessage(hasEverReceivedLive ? "stream_closed" : null);
        return;
      }

      applyLocalFallback(copy.allUnavailableLocal, "stream_closed");
    };

    const refreshSnapshot = async (mode: "initial" | "background") => {
      try {
        const snapshot = await fetchMarketTickerSnapshot(symbols);
        if (cancelled || snapshot.length === 0) {
          return;
        }

        const seenAt = Date.now();
        const hasFxData = snapshot.some((item) => item.usdKrwFx != null);
        hasSnapshot = true;

        setItems((current) => {
          const nextItems =
            current.length > 0 && hasAnyLive()
              ? mergeMarketTickerSnapshot(current, snapshot, {
                  preserveLiveUsd: hasBinanceLive,
                  preserveLiveKrw: hasUpbitLive,
                  source: "live",
                })
              : snapshot;

          setMiniCharts((currentCharts) => mergeMiniChartsFromItems(currentCharts, nextItems));
          return nextItems;
        });

        updateSource("snapshot", {
          available: true,
          lastSeenAt: seenAt,
          isConnecting: false,
          errorAt: null,
          closedAt: null,
        });
        updateSource("fx", {
          available: hasFxData,
          lastSeenAt: hasFxData ? seenAt : null,
          isConnecting: false,
          errorAt: hasFxData ? null : seenAt,
          closedAt: null,
        });

        if (hasAnyLive()) {
          setPhase("ready");
          setNotice(null);
          setErrorMessage(null);
          return;
        }

        setPhase(mode === "initial" && !hasEverReceivedLive ? "ready" : "fallback");
        setNotice(mode === "initial" && !hasEverReceivedLive ? null : copy.snapshotHolding);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const failureAt = Date.now();
        updateSource("snapshot", {
          isConnecting: false,
          errorAt: failureAt,
        });
        updateSource("fx", {
          isConnecting: false,
          errorAt: failureAt,
        });

        if (!hasSnapshot && !hasAnyLive()) {
          applyLocalFallback(
            copy.networkLimitedLocal,
            error instanceof Error ? error.message : "snapshot_unavailable",
          );
          return;
        }

        if (!hasAnyLive()) {
          setPhase("fallback");
          setNotice(copy.snapshotRefreshFailed);
        }
        setErrorMessage(error instanceof Error ? error.message : "snapshot_refresh_failed");
      }
    };

    const connectBinanceStream = () => {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        updateSource("binance", {
          isConnecting: false,
          errorAt: Date.now(),
        });
        return;
      }

      try {
        const socket = new window.WebSocket(buildMarketTickerStreamUrl(symbols));
        binanceSocket = socket;

        socket.onopen = () => {
          if (cancelled) {
            return;
          }

          updateSource("binance", {
            isConnecting: true,
            errorAt: null,
            closedAt: null,
          });
        };

        socket.onmessage = (event) => {
          if (cancelled || typeof event.data !== "string") {
            return;
          }

          hasBinanceLive = true;
          hasEverReceivedLive = true;
          setItems((current) => {
            const nextItems = mergeMarketTickerMessage(
              current.length > 0 ? current : createPendingMarketTickerItems(symbols),
              symbols,
              event.data,
            );
            setMiniCharts((currentCharts) => mergeMiniChartsFromItems(currentCharts, nextItems));
            return nextItems;
          });
          updateSource("binance", {
            available: true,
            lastSeenAt: Date.now(),
            isConnecting: false,
            errorAt: null,
            closedAt: null,
          });
          setPhase("ready");
          setNotice(null);
          setErrorMessage(null);
        };

        socket.onerror = () => {
          if (cancelled) {
            return;
          }

          hasBinanceLive = false;
          updateSource("binance", {
            isConnecting: false,
            errorAt: Date.now(),
          });

          if (!hasSnapshot && !hasAnyLive()) {
            applyLocalFallback(
              copy.binanceUnavailable,
              "binance_live_stream_unavailable",
            );
            return;
          }

          syncFallbackState();
        };

        socket.onclose = () => {
          hasBinanceLive = false;
          updateSource("binance", {
            isConnecting: false,
            closedAt: Date.now(),
          });
          syncFallbackState();
        };
      } catch (error) {
        applyLocalFallback(
          copy.binanceInitFailed,
          error instanceof Error ? error.message : "binance_stream_init_failed",
        );
      }
    };

    const connectUpbitStream = () => {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        updateSource("upbit", {
          isConnecting: false,
          errorAt: Date.now(),
        });
        return;
      }

      try {
        const socket = new window.WebSocket("wss://api.upbit.com/websocket/v1");
        socket.binaryType = "arraybuffer";
        upbitSocket = socket;

        socket.onopen = () => {
          if (cancelled) {
            return;
          }

          socket.send(buildUpbitTickerSubscriptionPayload(symbols));
          updateSource("upbit", {
            isConnecting: true,
            errorAt: null,
            closedAt: null,
          });
        };

        socket.onmessage = (event) => {
          void decodeSocketPayload(event.data)
            .then((payload) => {
              if (cancelled) {
                return;
              }

              hasUpbitLive = true;
              hasEverReceivedLive = true;
              setItems((current) => {
                const nextItems = mergeUpbitMarketTickerMessage(
                  current.length > 0 ? current : createPendingMarketTickerItems(symbols),
                  symbols,
                  payload,
                );
                setMiniCharts((currentCharts) => mergeMiniChartsFromItems(currentCharts, nextItems));
                return nextItems;
              });
              updateSource("upbit", {
                available: true,
                lastSeenAt: Date.now(),
                isConnecting: false,
                errorAt: null,
                closedAt: null,
              });
              setPhase("ready");
              setNotice(null);
              setErrorMessage(null);
            })
            .catch(() => {
              if (!cancelled) {
                updateSource("upbit", {
                  isConnecting: false,
                  errorAt: Date.now(),
                });
                syncFallbackState();
              }
            });
        };

        socket.onerror = () => {
          if (cancelled) {
            return;
          }

          hasUpbitLive = false;
          updateSource("upbit", {
            isConnecting: false,
            errorAt: Date.now(),
          });

          if (!hasSnapshot && !hasAnyLive()) {
            applyLocalFallback(
              copy.upbitUnavailable,
              "upbit_live_stream_unavailable",
            );
            return;
          }

          syncFallbackState();
        };

        socket.onclose = () => {
          hasUpbitLive = false;
          updateSource("upbit", {
            isConnecting: false,
            closedAt: Date.now(),
          });
          syncFallbackState();
        };
      } catch (error) {
        applyLocalFallback(
          copy.upbitInitFailed,
          error instanceof Error ? error.message : "upbit_stream_init_failed",
        );
      }
    };

    setPhase("loading");
    setItems([]);
    setMiniCharts({});
    setSelectedItemId(null);
    setNotice(null);
    setErrorMessage(null);
    setSourceHealth(createInitialSourceHealth());
    hasSnapshot = false;
    hasBinanceLive = false;
    hasUpbitLive = false;
    hasEverReceivedLive = false;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      applyLocalFallback(copy.offlineLocal, "offline");
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
            symbols.map((definition) => [definition.id, fallbackChartForDefinition(definition)]),
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

      if (binanceSocket) {
        binanceSocket.close();
        binanceSocket = null;
      }

      if (upbitSocket) {
        upbitSocket.close();
        upbitSocket = null;
      }
    };
  }, [copy, symbols]);

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
  const visibleUpdatedAt =
    lastUpdatedAt == null ? null : Math.trunc(lastUpdatedAt / 1000) * 1000;
  const sourceChips = useMemo<MarketTickerSourceChip[]>(
    () => [
      {
        id: "binance",
        label: "Binance",
        status: sourceStatus(sourceHealth.binance, clock, phase),
      },
      {
        id: "upbit",
        label: "Upbit",
        status: sourceStatus(sourceHealth.upbit, clock, phase),
      },
      {
        id: "fx",
        label: "FX",
        status: sourceStatus(sourceHealth.fx, clock, phase),
      },
      {
        id: "snapshot",
        label: "Snapshot",
        status: sourceStatus(sourceHealth.snapshot, clock, phase),
      },
    ],
    [clock, phase, sourceHealth],
  );
  const sourceStatusLabels = {
    connecting: copy.statusConnecting,
    live: copy.statusLive,
    stale: copy.statusStale,
    down: copy.statusDown,
  } as const;
  const selectedItem = selectedItemId
    ? items.find((item) => item.id === selectedItemId) ?? null
    : null;
  const selectedDefinition = selectedItem
    ? symbols.find((entry) => entry.id === selectedItem.id) ??
      DEFAULT_MARKET_TICKER_SYMBOLS.find((entry) => entry.id === selectedItem.id) ??
      null
    : null;
  const cardCount = phase === "loading" ? symbols.length : items.length;
  const shouldShowMobileToggle = cardCount > 2;
  const hiddenCardCount = Math.max(cardCount - 2, 0);
  const mobileToggleLabel = isExpanded ? copy.mobileCollapse : copy.mobileExpand;
  const mobileToggleAriaLabel = isExpanded
    ? copy.mobileCollapseAria
    : copy.mobileExpandAria(hiddenCardCount);

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
          <p className={styles.emptyTitle}>{copy.emptySymbolsTitle}</p>
          <p className={styles.emptyBody}>{copy.emptySymbolsBody}</p>
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
          <MarketTickerSourceChips
            sources={sourceChips}
            ariaLabel={copy.sourceAria}
            statusLabels={sourceStatusLabels}
          />
          <span className={styles.updatedAt}>
            {copy.updatedAtLabel}{" "}
            {visibleUpdatedAt == null
              ? copy.updatedAtPending
              : formatMarketTickerUpdatedAt(visibleUpdatedAt)}{" "}
            KST
          </span>
        </div>
      </div>

      {notice ? (
        <p className={styles.notice} data-tone={errorMessage ? "warn" : "neutral"}>
          {notice}
        </p>
      ) : null}

      {shouldShowMobileToggle ? (
        <div className={styles.mobileToggleRow}>
          <button
            type="button"
            className={styles.mobileToggleButton}
            aria-expanded={isExpanded}
            aria-controls={stripId}
            aria-label={mobileToggleAriaLabel}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {mobileToggleLabel}
          </button>
        </div>
      ) : null}

      {phase === "loading" ? (
        <div
          id={stripId}
          className={styles.strip}
          data-collapsible={shouldShowMobileToggle ? "true" : undefined}
          data-expanded={isExpanded ? "true" : "false"}
        >
          {symbols.map((item, index) => (
            <LoadingCard index={index} key={item.id} />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div
          id={stripId}
          className={styles.strip}
          data-collapsible={shouldShowMobileToggle ? "true" : undefined}
          data-expanded={isExpanded ? "true" : "false"}
        >
          {items.map((item) => {
            const changeValue = item.usdChange24hPct ?? item.krwChange24hPct;
            const premiumTone = marketTickerTone(item.kimchiPremiumPct);
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
                    {item.priceUsd == null
                      ? copy.currentUsdWaiting
                      : formatMarketTickerPrice(item.priceUsd)}
                  </strong>
                  <span className={styles.secondaryPrice}>
                    {item.priceKrw == null
                      ? copy.currentKrwWaiting
                      : formatMarketTickerKrwPrice(item.priceKrw)}
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
                      ? copy.usdWaiting
                      : `USD 24h ${formatMarketTickerChange(item.usdChange24hPct)}`}
                  </span>
                </div>

                <div className={styles.metricRow}>
                  <span className={styles.metricLabel}>{item.krwMarketLabel}</span>
                  <span className={styles.metricValue}>
                    {item.krwChange24hPct == null
                      ? copy.krwWaiting
                      : `KRW 24h ${formatMarketTickerChange(item.krwChange24hPct)}`}
                  </span>
                </div>

                <div className={styles.cardFooter}>
                  <span className={styles.premiumPill} data-tone={premiumTone}>
                    {item.kimchiPremiumPct == null
                      ? copy.premiumWaiting
                      : formatKimchiPremium(item.kimchiPremiumPct)}
                  </span>
                  <div className={styles.cardFooterActions}>
                    <span>
                      {item.source === "local"
                        ? copy.sourceLocal
                        : item.source === "live"
                          ? copy.sourceLive
                          : copy.sourceSnapshot}
                    </span>
                    {definition ? (
                      <button
                        type="button"
                        className={styles.detailButton}
                        aria-haspopup="dialog"
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        {copy.detailChart}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{copy.emptyTitle}</p>
          <p className={styles.emptyBody}>{copy.emptyBody}</p>
        </div>
      )}

      <MarketDetailChartModal
        definition={selectedDefinition}
        item={selectedItem}
        isOpen={selectedItem != null && selectedDefinition != null}
        onClose={() => setSelectedItemId(null)}
        initialLanguage={initialLanguage}
      />
    </section>
  );
}
