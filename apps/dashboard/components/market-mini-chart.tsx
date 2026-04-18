"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

import type { MarketTickerChartPoint } from "@/lib/market-ticker";

import styles from "./market-mini-chart.module.css";

type MarketMiniChartTone = "positive" | "negative" | "neutral";

type MarketMiniChartProps = {
  label: string;
  points: MarketTickerChartPoint[];
  tone: MarketMiniChartTone;
};

function cssVar(node: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(node).getPropertyValue(name).trim();
  return value || fallback;
}

function toLineData(points: MarketTickerChartPoint[]) {
  return points.map((point) => ({
    time: Math.floor(point.timestamp / 1000) as UTCTimestamp,
    value: point.value,
  }));
}

export function MarketMiniChart({
  label,
  points,
  tone,
}: MarketMiniChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const positive = cssVar(root, "--good", "#149a52");
    const negative = cssVar(root, "--bad", "#d14343");
    const neutral = cssVar(root, "--accent", "#2676ff");
    const lineColor =
      tone === "positive" ? positive : tone === "negative" ? negative : neutral;

    const chart = createChart(root, {
      autoSize: true,
      height: 84,
      layout: {
        background: { color: "transparent", type: ColorType.Solid },
        textColor: cssVar(root, "--muted", "#6b778c"),
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      handleScroll: false,
      handleScale: false,
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      leftPriceScale: {
        visible: false,
      },
      rightPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: `${lineColor}33`,
      bottomColor: `${lineColor}03`,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      seriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [tone]);

  useEffect(() => {
    if (!seriesRef.current) {
      return;
    }

    seriesRef.current.setData(toLineData(points));
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return (
    <div className={styles.root} aria-hidden="true">
      <div ref={rootRef} className={styles.canvas} />
      <span className={styles.srOnly}>{label}</span>
    </div>
  );
}
