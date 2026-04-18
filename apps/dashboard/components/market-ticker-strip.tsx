"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MARKET_TICKER_SYMBOLS,
  buildMarketTickerStreamUrl,
  createLocalMarketTickerItems,
  fetchMarketTickerSnapshot,
  formatMarketTickerChange,
  formatMarketTickerPrice,
  formatMarketTickerUpdatedAt,
  marketTickerTone,
  mergeMarketTickerMessage,
  type MarketTickerDefinition,
  type MarketTickerItem,
  type MarketTickerSource,
} from "@/lib/market-ticker";
import styles from "./market-ticker-strip.module.css";

type MarketTickerStripProps = {
  symbols?: MarketTickerDefinition[];
  title?: string;
  eyebrow?: string;
  className?: string;
};

type Phase = "loading" | "ready" | "fallback" | "error";

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

function LoadingCard({ index }: { index: number }) {
  return (
    <article className={styles.card} aria-hidden="true" data-loading-index={index}>
      <div className={styles.loadingBlock} />
      <div className={styles.loadingPrice} />
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
  const [phase, setPhase] = useState<Phase>(symbols.length === 0 ? "ready" : "loading");
  const [source, setSource] = useState<MarketTickerSource | "idle">("idle");
  const [notice, setNotice] = useState("브라우저 공개 시세 연결을 준비 중입니다.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const hasLiveRef = useRef(false);
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    if (symbols.length === 0) {
      setItems([]);
      setPhase("ready");
      setSource("idle");
      setNotice("표시할 심볼이 아직 없습니다.");
      setErrorMessage(null);
      return;
    }

    let cancelled = false;
    const applyLocalFallback = (message: string, detail?: string) => {
      if (cancelled) {
        return;
      }
      setItems(createLocalMarketTickerItems(symbols));
      setPhase("fallback");
      setSource("local");
      setNotice(message);
      setErrorMessage(detail ?? null);
    };

    const refreshSnapshot = async (mode: "initial" | "refresh") => {
      try {
        const snapshot = await fetchMarketTickerSnapshot(symbols);
        if (cancelled || snapshot.length === 0) {
          return;
        }

        hasSnapshotRef.current = true;
        setItems(snapshot);
        setPhase("ready");
        setSource((current) => (current === "live" ? "live" : "rest"));
        setErrorMessage(null);
        setNotice(
          mode === "initial"
            ? "공개 REST 스냅샷을 불러왔습니다."
            : "라이브 스트림이 없어 최근 REST 스냅샷으로 새로고침했습니다."
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (!hasSnapshotRef.current && !hasLiveRef.current) {
          applyLocalFallback(
            "네트워크 접근이 제한되어 예시 시세를 표시합니다.",
            error instanceof Error ? error.message : "snapshot_unavailable"
          );
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "snapshot_refresh_failed");
      }
    };

    const connectLiveStream = () => {
      if (typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        return;
      }

      try {
        const socket = new window.WebSocket(buildMarketTickerStreamUrl(symbols));
        socketRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            return;
          }
          setNotice("브라우저 공개 스트림 연결을 시도 중입니다.");
        };

        socket.onmessage = (event) => {
          if (cancelled || typeof event.data !== "string") {
            return;
          }

          hasLiveRef.current = true;
          setItems((current) =>
            mergeMarketTickerMessage(
              current.length > 0 ? current : createLocalMarketTickerItems(symbols),
              symbols,
              event.data
            )
          );
          setPhase("ready");
          setSource("live");
          setErrorMessage(null);
          setNotice("브라우저 공개 스트림으로 시장 변화를 반영 중입니다.");
        };

        socket.onerror = () => {
          if (cancelled) {
            return;
          }

          if (!hasLiveRef.current && !hasSnapshotRef.current) {
            applyLocalFallback("라이브 연결이 열리지 않아 예시 시세로 대체했습니다.", "live_stream_unavailable");
            return;
          }

          setErrorMessage("live_stream_unavailable");
        };

        socket.onclose = () => {
          if (cancelled) {
            return;
          }

          if (hasLiveRef.current) {
            hasLiveRef.current = false;
            setSource("rest");
            setNotice("라이브 연결이 닫혀 마지막 스냅샷을 유지합니다.");
            return;
          }

          if (hasSnapshotRef.current) {
            setSource("rest");
            setNotice("라이브 연결 없이 REST 스냅샷 모드로 유지합니다.");
            return;
          }

          applyLocalFallback("네트워크 연결이 없어 예시 시세를 표시합니다.", "stream_closed");
        };
      } catch (error) {
        applyLocalFallback(
          "브라우저에서 실시간 스트림을 열 수 없어 예시 시세를 표시합니다.",
          error instanceof Error ? error.message : "stream_init_failed"
        );
      }
    };

    setPhase("loading");
    setSource("idle");
    setItems([]);
    setNotice("브라우저 공개 시세 연결을 준비 중입니다.");
    setErrorMessage(null);
    hasLiveRef.current = false;
    hasSnapshotRef.current = false;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      applyLocalFallback("오프라인 상태라 예시 시세를 먼저 표시합니다.", "offline");
      return;
    }

    void refreshSnapshot("initial");
    connectLiveStream();
    const refreshTimer = window.setInterval(() => {
      if (!hasLiveRef.current) {
        void refreshSnapshot("refresh");
      }
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
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
          <p className={styles.emptyBody}>마운트 시 `symbols`를 전달하면 고정된 심볼 스트립으로 사용할 수 있습니다.</p>
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
          <span className={styles.updatedAt}>{formatMarketTickerUpdatedAt(lastUpdatedAt)}</span>
        </div>
      </div>

      <p
        className={styles.notice}
        data-tone={phase === "fallback" || errorMessage ? "warn" : phase === "error" ? "bad" : "neutral"}
      >
        {phase === "loading" ? "브라우저 공개 시세 연결을 준비 중입니다." : notice}
      </p>

      {phase === "loading" ? (
        <div className={styles.strip}>
          {symbols.map((item, index) => (
            <LoadingCard index={index} key={item.id} />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className={styles.strip}>
          {items.map((item) => (
            <article key={item.id} className={styles.card} data-source={item.source}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.asset}>{item.asset}</p>
                  <p className={styles.label}>{item.label}</p>
                </div>
                <span className={styles.change} data-tone={marketTickerTone(item.change24hPct)}>
                  {formatMarketTickerChange(item.change24hPct)}
                </span>
              </div>

              <strong className={styles.price}>{formatMarketTickerPrice(item.priceUsd)}</strong>

              <div className={styles.cardFooter}>
                <span>{item.marketLabel}</span>
                <span>{item.source === "local" ? "예시 시세" : item.source === "live" ? "실시간" : "스냅샷"}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>표시할 시세가 없습니다.</p>
          <p className={styles.emptyBody}>공개 API 응답이 비어 있거나 아직 초기 데이터가 준비되지 않았습니다.</p>
        </div>
      )}
    </section>
  );
}
