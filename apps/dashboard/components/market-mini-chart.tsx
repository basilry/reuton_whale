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

import { resolveTokenColor, toRgba } from "@/lib/chart-colors";
import type { MarketTickerChartPoint } from "@/lib/market-ticker";

import styles from "./market-mini-chart.module.css";

type MarketMiniChartTone = "positive" | "negative" | "neutral";

type MarketMiniChartProps = {
  label: string;
  points: MarketTickerChartPoint[];
  tone: MarketMiniChartTone;
};

function toLineData(points: MarketTickerChartPoint[]) {
  const ordered = [...points].sort((left, right) => left.timestamp - right.timestamp);
  const deduped = new Map<number, number>();

  for (const point of ordered) {
    deduped.set(Math.floor(point.timestamp / 1000), point.value);
  }

  return Array.from(deduped.entries()).map(([time, value]) => ({
    time: time as UTCTimestamp,
    value,
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

    const positive = resolveTokenColor(root, "--good", "rgb(20, 154, 82)");
    const negative = resolveTokenColor(root, "--bad", "rgb(209, 67, 67)");
    const neutral = resolveTokenColor(root, "--accent", "rgb(38, 118, 255)");
    const textColor = resolveTokenColor(root, "--muted", "rgb(107, 119, 140)");
    const lineColor =
      tone === "positive" ? positive : tone === "negative" ? negative : neutral;

    const chart = createChart(root, {
      autoSize: true,
      height: 84,
      layout: {
        background: { color: "transparent", type: ColorType.Solid },
        textColor,
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
      topColor: toRgba(lineColor, 0.2, "rgba(38, 118, 255, 0.2)"),
      bottomColor: toRgba(lineColor, 0.02, "rgba(38, 118, 255, 0.02)"),
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
