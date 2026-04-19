import { expect, test } from "@playwright/experimental-ct-react";

import { MarketTickerSourceChips } from "@/components/market-ticker-source-chips";
import {
  getMarketTickerSourceProfile,
  getMarketTickerSourceStatus,
  isMarketTickerSourceHoldingLastSuccess,
  type MarketTickerSourceHealth,
  type MarketTickerSourceKey,
  type MarketTickerSourcePhase,
  type MarketTickerSourceStatus,
} from "@/lib/market-ticker";

import {
  applyDashboardTestDocument,
  TEST_SURFACE_STYLE,
} from "./dashboard-accessibility.harness";

function buildHealth(
  overrides: Partial<MarketTickerSourceHealth> = {},
): MarketTickerSourceHealth {
  return {
    available: true,
    lastSeenAt: null,
    isConnecting: false,
    errorAt: null,
    closedAt: null,
    ...overrides,
  };
}

test("market ticker source freshness windows stay deterministic across source types", async () => {
  const now = Date.UTC(2026, 3, 19, 0, 0, 0);
  const cases: Array<{
    key: MarketTickerSourceKey;
    phase?: MarketTickerSourcePhase;
    health: MarketTickerSourceHealth;
    expected: MarketTickerSourceStatus;
  }> = [
    {
      key: "binance",
      phase: "loading",
      health: buildHealth({ isConnecting: true }),
      expected: "connecting",
    },
    {
      key: "upbit",
      health: buildHealth({ lastSeenAt: now - 10_000 }),
      expected: "live",
    },
    {
      key: "binance",
      health: buildHealth({ lastSeenAt: now - 25_000 }),
      expected: "stale",
    },
    {
      key: "upbit",
      health: buildHealth({ lastSeenAt: now - 46_000 }),
      expected: "down",
    },
    {
      key: "binance",
      health: buildHealth({
        lastSeenAt: now - 5_000,
        errorAt: now - 1_000,
      }),
      expected: "down",
    },
    {
      key: "bitflyer",
      health: buildHealth({ lastSeenAt: now - 2 * 60_000 }),
      expected: "live",
    },
    {
      key: "bitflyer",
      health: buildHealth({ lastSeenAt: now - 5 * 60_000 }),
      expected: "stale",
    },
    {
      key: "bitflyer",
      health: buildHealth({ lastSeenAt: now - 9 * 60_000 }),
      expected: "down",
    },
    {
      key: "kraken",
      health: buildHealth({ lastSeenAt: now - 60_000 }),
      expected: "live",
    },
    {
      key: "kraken",
      health: buildHealth({ lastSeenAt: now - 2 * 60_000 }),
      expected: "stale",
    },
    {
      key: "kraken",
      health: buildHealth({ lastSeenAt: now - 5 * 60_000 }),
      expected: "down",
    },
    {
      key: "fx",
      health: buildHealth({ lastSeenAt: now - 5 * 60_000 }),
      expected: "live",
    },
    {
      key: "fx",
      health: buildHealth({ lastSeenAt: now - 10 * 60_000 }),
      expected: "stale",
    },
    {
      key: "fx",
      health: buildHealth({ lastSeenAt: now - 16 * 60_000 }),
      expected: "down",
    },
    {
      key: "snapshot",
      health: buildHealth({ lastSeenAt: now - 5 * 60_000 }),
      expected: "live",
    },
    {
      key: "snapshot",
      health: buildHealth({ lastSeenAt: now - 11 * 60_000 }),
      expected: "stale",
    },
    {
      key: "snapshot",
      health: buildHealth({ lastSeenAt: now - 16 * 60_000 }),
      expected: "down",
    },
  ];

  for (const testCase of cases) {
    expect(
      getMarketTickerSourceStatus(
        testCase.key,
        testCase.health,
        now,
        testCase.phase ?? "ready",
      ),
      `${testCase.key} should resolve ${testCase.expected}`,
    ).toBe(testCase.expected);
  }
});

test("polling sources preserve last success diagnostics after a failed refresh", async () => {
  const now = Date.UTC(2026, 3, 19, 0, 0, 0);
  const holdingHealth = buildHealth({
    lastSeenAt: now - 4 * 60_000,
    errorAt: now - 60_000,
  });

  expect(isMarketTickerSourceHoldingLastSuccess("snapshot", holdingHealth)).toBe(true);
  expect(isMarketTickerSourceHoldingLastSuccess("fx", holdingHealth)).toBe(true);
  expect(getMarketTickerSourceStatus("snapshot", holdingHealth, now, "ready")).toBe("live");
  expect(getMarketTickerSourceStatus("fx", holdingHealth, now, "ready")).toBe("live");

  const liveFailureHealth = buildHealth({
    lastSeenAt: now - 4_000,
    errorAt: now - 1_000,
  });

  expect(isMarketTickerSourceHoldingLastSuccess("binance", liveFailureHealth)).toBe(false);
  expect(getMarketTickerSourceStatus("binance", liveFailureHealth, now, "ready")).toBe("down");
});

test("source profiles expose expected freshness thresholds for every market source", async () => {
  expect(getMarketTickerSourceProfile("binance")).toEqual({
    kind: "live",
    liveWindowMs: 15_000,
    downWindowMs: 45_000,
    expectedIntervalMs: 15_000,
  });
  expect(getMarketTickerSourceProfile("upbit")).toEqual({
    kind: "live",
    liveWindowMs: 15_000,
    downWindowMs: 45_000,
    expectedIntervalMs: 15_000,
  });
  expect(getMarketTickerSourceProfile("bitflyer")).toEqual({
    kind: "polling",
    liveWindowMs: 180_000,
    downWindowMs: 480_000,
    expectedIntervalMs: 120_000,
  });
  expect(getMarketTickerSourceProfile("kraken")).toEqual({
    kind: "polling",
    liveWindowMs: 90_000,
    downWindowMs: 240_000,
    expectedIntervalMs: 60_000,
  });
  expect(getMarketTickerSourceProfile("fx")).toEqual({
    kind: "polling",
    liveWindowMs: 360_000,
    downWindowMs: 900_000,
    expectedIntervalMs: 300_000,
  });
  expect(getMarketTickerSourceProfile("snapshot")).toEqual({
    kind: "polling",
    liveWindowMs: 360_000,
    downWindowMs: 900_000,
    expectedIntervalMs: 300_000,
  });
});

test("source chips open diagnostics on hover and close on escape or outside tap", async ({
  mount,
  page,
}) => {
  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <MarketTickerSourceChips
        ariaLabel="시장 데이터 소스 상태"
        statusLabels={{
          connecting: "연결 중",
          live: "실시간",
          stale: "지연",
          down: "중단",
        }}
        sources={[
          {
            id: "binance",
            label: "Binance",
            status: "live",
            lastSeenAt: Date.UTC(2026, 3, 19, 0, 0, 10),
            expectedIntervalMs: 15_000,
            originSummary: "USD/USDT 기준 실시간 체결 스트림",
            statusSummary: "최근 수신이 정상 범위 안에 있어 실시간 스트림이 살아 있습니다.",
            metaLines: [
              "원천: Binance WebSocket",
              "최근 수신: 2026.04.19 09:00:10",
              "판정 기준: 15초 live / 45초 stale",
            ],
          },
          {
            id: "upbit",
            label: "Upbit",
            status: "stale",
            lastSeenAt: Date.UTC(2026, 3, 19, 0, 0, 5),
            expectedIntervalMs: 15_000,
            originSummary: "KRW 기준 실시간 체결 스트림",
            statusSummary: "연결은 있었지만 최근 메시지가 늦어지고 있어 지연 상태로 봅니다.",
            metaLines: [
              "원천: Upbit WebSocket",
              "최근 수신: 2026.04.19 09:00:05",
              "판정 기준: 15초 live / 45초 stale",
            ],
          },
          {
            id: "bitflyer",
            label: "Bitflyer",
            status: "live",
            lastSeenAt: Date.UTC(2026, 3, 19, 0, 0, 0),
            expectedIntervalMs: 120_000,
            originSummary: "일본 엔화 기준 REST 스냅샷",
            statusSummary: "가장 최근 스냅샷이 polling 기대 주기 안에 있어 정상 범위입니다.",
            metaLines: [
              "원천: Bitflyer REST (BTC/ETH · JPY)",
              "최근 수신: 2026.04.19 09:00:00",
              "판정 기준: 3분 live / 8분 stale",
            ],
          },
          {
            id: "kraken",
            label: "Kraken",
            status: "stale",
            lastSeenAt: Date.UTC(2026, 3, 19, 0, 0, 0),
            expectedIntervalMs: 60_000,
            originSummary: "미국 달러 기준 REST 스냅샷",
            statusSummary: "이전 성공 데이터는 있지만 최근 갱신이 polling 기대치보다 늦습니다.",
            metaLines: [
              "원천: Kraken REST (BTC/ETH · USD)",
              "최근 수신: 2026.04.19 09:00:00",
              "판정 기준: 90초 live / 4분 stale",
            ],
          },
          {
            id: "fx",
            label: "FX",
            status: "live",
            lastSeenAt: Date.UTC(2026, 3, 19, 0, 0, 0),
            expectedIntervalMs: 300_000,
            originSummary: "USD/KRW 환율 보조 입력",
            statusSummary: "가장 최근 스냅샷이 polling 기대 주기 안에 있어 정상 범위입니다.",
            metaLines: [
              "원천: exchangerate.host → open.er-api → Upbit KRW-USDT",
              "최근 수신: 2026.04.19 09:00:00",
              "판정 기준: 6분 live / 15분 stale",
            ],
          },
          {
            id: "snapshot",
            label: "Snapshot",
            status: "down",
            lastSeenAt: Date.UTC(2026, 3, 18, 23, 40, 0),
            expectedIntervalMs: 300_000,
            originSummary: "Binance REST + Upbit REST + FX를 합친 5분 스냅샷",
            statusSummary: "최근 성공 데이터가 오래됐거나 첫 polling이 아직 성공하지 못했습니다.",
            metaLines: [
              "원천: Binance REST + Upbit REST + FX 합성",
              "최근 수신: 2026.04.19 08:40:00",
              "판정 기준: 6분 live / 15분 stale",
            ],
          },
        ]}
      />
    </div>,
  );

  const chipButtons = component.getByRole("button");
  await expect(chipButtons).toHaveCount(6);

  const binanceButton = component.getByRole("button", { name: /Binance.*실시간/i });
  const snapshotButton = component.getByRole("button", { name: /Snapshot.*중단/i });

  await binanceButton.hover();
  await expect(page.getByRole("tooltip")).toContainText("원천: Binance WebSocket");
  await expect(binanceButton).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(binanceButton).toHaveAttribute("aria-expanded", "false");

  const upbitButton = component.getByRole("button", { name: /Upbit.*지연/i });
  await upbitButton.focus();
  await expect(page.getByRole("tooltip")).toContainText("원천: Upbit WebSocket");
  await expect(upbitButton).toHaveAttribute("aria-expanded", "true");

  await snapshotButton.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "원천: Binance REST + Upbit REST + FX 합성",
  );
  await expect(snapshotButton).toHaveAttribute("aria-expanded", "true");

  await page.locator("body").click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(snapshotButton).toHaveAttribute("aria-expanded", "false");
});
