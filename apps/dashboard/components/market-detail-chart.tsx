"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

import { resolveTokenColor, toRgba } from "@/lib/chart-colors";
import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import {
  createLocalMarketTickerDetailSeries,
  fetchMarketTickerDetailSeries,
  formatKimchiPremium,
  formatMarketTickerKrwPrice,
  formatMarketTickerPrice,
  type MarketTickerChartMetric,
  type MarketTickerChartRange,
  type MarketTickerDefinition,
  type MarketTickerDetailSeries,
  type MarketTickerItem,
} from "@/lib/market-ticker";

import styles from "./market-detail-chart.module.css";

type DetailPhase = "loading" | "ready" | "fallback";

type MarketDetailChartProps = {
  definition: MarketTickerDefinition;
  item: MarketTickerItem;
  initialLanguage: DashboardLanguage;
};

const RANGES: MarketTickerChartRange[] = ["1m", "5m", "1h", "1d"];

function toLineData(
  points: MarketTickerDetailSeries["usdPoints"],
  metric: MarketTickerChartMetric,
) {
  const ordered = [...points].sort((left, right) => left.timestamp - right.timestamp);
  const deduped = new Map<number, number>();

  for (const point of ordered) {
    deduped.set(Math.floor(point.timestamp / 1000), point.value);
  }

  return Array.from(deduped.entries()).map(([time, value]) => ({
    time: time as UTCTimestamp,
    value,
    customValues: { metric },
  }));
}

function rangeLabel(range: MarketTickerChartRange): string {
  return range.toUpperCase();
}

export function MarketDetailChart({
  definition,
  item,
  initialLanguage,
}: MarketDetailChartProps) {
  const { language } = useDashboardI18n(initialLanguage);
  const [range, setRange] = useState<MarketTickerChartRange>("1h");
  const [metric, setMetric] = useState<MarketTickerChartMetric>(
    item.priceKrw != null ? "krw" : "usd",
  );
  const [phase, setPhase] = useState<DetailPhase>("loading");
  const [series, setSeries] = useState<MarketTickerDetailSeries>(() =>
    createLocalMarketTickerDetailSeries(definition, "1h"),
  );
  const chartRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const activePoints = useMemo(
    () => (metric === "krw" ? series.krwPoints : series.usdPoints),
    [metric, series],
  );

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");

    void fetchMarketTickerDetailSeries(definition, range)
      .then((nextSeries) => {
        if (cancelled) {
          return;
        }
        setSeries(nextSeries);
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSeries(createLocalMarketTickerDetailSeries(definition, range));
        setPhase("fallback");
      });

    return () => {
      cancelled = true;
    };
  }, [definition, range]);

  useEffect(() => {
    const root = chartRootRef.current;
    if (!root) {
      return undefined;
    }

    const accent = resolveTokenColor(root, "--accent", "rgb(38, 118, 255)");
    const textColor = resolveTokenColor(root, "--muted", "rgb(107, 119, 140)");

    const chart = createChart(root, {
      autoSize: true,
      height: 220,
      layout: {
        background: { color: "transparent", type: ColorType.Solid },
        textColor,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: toRgba(accent, 0.07, "rgba(38, 118, 255, 0.07)") },
        horzLines: { color: toRgba(accent, 0.07, "rgba(38, 118, 255, 0.07)") },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: range !== "1d",
      },
    });

    const chartSeries = chart.addSeries(AreaSeries, {
      lineColor: accent,
      topColor: toRgba(accent, 0.2, "rgba(38, 118, 255, 0.2)"),
      bottomColor: toRgba(accent, 0.03, "rgba(38, 118, 255, 0.03)"),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = chartSeries;

    return () => {
      seriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [metric, range]);

  useEffect(() => {
    if (!seriesRef.current) {
      return;
    }
    seriesRef.current.setData(toLineData(activePoints, metric));
    chartRef.current?.timeScale().fitContent();
  }, [activePoints, metric]);

  const copy =
    language === "ko"
      ? {
          metricUsd: "USD 기준",
          metricKrw: "KRW 기준",
          statusLoading: "차트 로딩 중",
          statusFallback: "예시 차트",
          statusReady: "실데이터 차트",
          currentUsd: "현재 USD",
          currentKrw: "현재 KRW",
          kimchiPremium: "김치 프리미엄",
          usdWaiting: "USD 대기",
          krwWaiting: "KRW 대기",
          premiumWaiting: "김프 대기",
        }
      : {
          metricUsd: "USD view",
          metricKrw: "KRW view",
          statusLoading: "Loading chart",
          statusFallback: "Preview chart",
          statusReady: "Live chart",
          currentUsd: "Current USD",
          currentKrw: "Current KRW",
          kimchiPremium: "Kimchi premium",
          usdWaiting: "Waiting for USD",
          krwWaiting: "Waiting for KRW",
          premiumWaiting: "Waiting for premium",
        };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          {RANGES.map((entry) => (
            <button
              key={entry}
              type="button"
              className={styles.chip}
              data-active={range === entry ? "true" : undefined}
              onClick={() => setRange(entry)}
            >
              {rangeLabel(entry)}
            </button>
          ))}
        </div>

        <div className={styles.group}>
          {(["usd", "krw"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              className={styles.chip}
              data-active={metric === entry ? "true" : undefined}
              onClick={() => setMetric(entry)}
            >
              {entry === "krw" ? copy.metricKrw : copy.metricUsd}
            </button>
          ))}
        </div>

        <span className={styles.status}>
          {phase === "loading"
            ? copy.statusLoading
            : phase === "fallback"
              ? copy.statusFallback
              : copy.statusReady}
        </span>
      </div>

      <div className={styles.chartShell}>
        <div ref={chartRootRef} className={styles.chart} />
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{copy.currentUsd}</span>
          <span className={styles.summaryValue}>
            {item.priceUsd == null ? copy.usdWaiting : formatMarketTickerPrice(item.priceUsd)}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{copy.currentKrw}</span>
          <span className={styles.summaryValue}>
            {item.priceKrw == null ? copy.krwWaiting : formatMarketTickerKrwPrice(item.priceKrw)}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{copy.kimchiPremium}</span>
          <span className={styles.summaryValue}>
            {item.kimchiPremiumPct == null
              ? copy.premiumWaiting
              : formatKimchiPremium(item.kimchiPremiumPct)}
          </span>
        </div>
      </div>
    </div>
  );
}
