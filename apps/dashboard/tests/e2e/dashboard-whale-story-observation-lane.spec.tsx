import { expect, test } from "@playwright/experimental-ct-react";

import { WhaleStoryPanel } from "@/components/whale-story-panel";
import { buildWhaleStories } from "@/lib/whale-stories";

import {
  applyDashboardTestDocument,
  TEST_SURFACE_STYLE,
} from "./dashboard-accessibility.harness";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await page.evaluate(applyDashboardTestDocument, "ko");
});

test("stale signal stories do not override fresh transaction stories", () => {
  const stories = buildWhaleStories({
    recentTransactions: [
      {
        hash: "fresh-tx-1",
        symbol: "ETH",
        amount: "0.02",
        amount_usd: "49",
        timestamp: "2026-04-27T05:18:47.000Z",
        created_at: "2026-04-27T05:18:59.000Z",
        from_address: "0x1346a1",
        from_owner: "Unknown",
        to_address: "0xc02aaa",
        to_owner: "WETH Contract",
        blockchain: "ETH",
      },
    ],
    recentSignals: [
      {
        signal_id: "stale-signal-1",
        created_at: "2026-04-22T04:03:04.000Z",
        rule: "cex_outflow_spike",
        severity: "high",
        score: "95",
        evidence_tx_hashes: "[]",
        summary: "오래된 거래소 유출 급증",
        extra_json: "{}",
      },
    ],
    generatedAt: "2026-04-27T05:45:37.000Z",
    maxItems: 1,
    curatedWallets: [],
  });

  expect(stories).toHaveLength(1);
  expect(stories[0]?.kind).toBe("transaction");
  expect(stories[0]?.title).toContain("ETH 이동");
  expect(stories[0]?.supportingSignalIds).toEqual([]);
});

test("external-only DOGE story surfaces TG mirror lane, confidence, and partial-view badge", async ({
  mount,
  page,
}) => {
  const stories = buildWhaleStories({
    recentSignals: [
      {
        signal_id: "sig-ext-doge",
        created_at: "2026-04-20T00:00:00.000Z",
        rule: "external_only_observation",
        severity: "medium",
        score: "7.2",
        evidence_tx_hashes: "[]",
        summary: "",
        extra_json: JSON.stringify({
          chain: "DOGE",
          asset: "DOGE",
          amount_usd: "1250000",
          observation_source: "tg_mirror",
          external_channel: "Whale Alert",
          external_confidence: "high",
        }),
      },
    ],
    generatedAt: "2026-04-20T00:05:00.000Z",
    maxItems: 1,
    curatedWallets: [],
  });

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <WhaleStoryPanel stories={stories} />
    </div>,
  );

  await expect(component.getByText("외부 관측 · Whale Alert")).toBeVisible();
  await expect(component.getByText("부분 관측 · cluster 미적용")).toBeVisible();
  await expect(component.getByText("Dogecoin은 주소 cluster를 아직 합치지 않아 개별 주소 기준 흐름만 보입니다.")).toBeVisible();

  await component.getByRole("button", { name: /whale alert 외부 관측/i }).click();

  const dialog = page.getByRole("dialog", { name: /whale alert 외부 관측/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("외부 관측 · Whale Alert", { exact: true }).first()).toBeVisible();
  await expect(
    dialog.getByText("부분 관측 · cluster 미적용", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByText("채널 신뢰도 높음", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Dogecoin 스토리는 주소 cluster를 아직 적용하지 않아/)).toBeVisible();
});

test("transaction story surfaces TG mirror lane aggregated from related signal metadata", async ({
  mount,
  page,
}) => {
  const stories = buildWhaleStories({
    recentTransactions: [
      {
        hash: "doge-tx-1",
        symbol: "DOGE",
        amount: "1500000",
        amount_usd: "315000",
        timestamp: "2026-04-20T01:00:00.000Z",
        created_at: "2026-04-20T01:01:00.000Z",
        from_address: "DFromWallet1111111111111111111111111",
        from_owner: "Robinhood DOGE Cold",
        to_address: "DToWallet111111111111111111111111111",
        to_owner: "Unknown",
        blockchain: "DOGE",
      },
    ],
    recentSignals: [
      {
        signal_id: "sig-tx-doge",
        created_at: "2026-04-20T01:02:00.000Z",
        rule: "cex_outflow_spike",
        severity: "high",
        score: "8.4",
        evidence_tx_hashes: JSON.stringify(["doge-tx-1"]),
        summary: "거래소 유출 급증",
        extra_json: JSON.stringify({
          chain: "DOGE",
          amount_usd: "315000",
          observation_source: "tg_mirror",
          external_channel: "Whale Alert",
          external_confidence: "medium",
          cluster_applied: false,
        }),
      },
    ],
    generatedAt: "2026-04-20T01:05:00.000Z",
    maxItems: 1,
    curatedWallets: [],
  });

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <WhaleStoryPanel stories={stories} />
    </div>,
  );

  await expect(component.getByText("외부 관측 · Whale Alert")).toBeVisible();
  await expect(component.getByText("부분 관측 · cluster 미적용")).toBeVisible();
  await expect(component.getByRole("heading", { name: /robinhood doge cold doge 이동/i })).toBeVisible();

  await component.getByRole("button", { name: /robinhood doge cold doge 이동/i }).click();

  const dialog = page.getByRole("dialog", { name: /robinhood doge cold doge 이동/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("관측 레인", { exact: true })).toBeVisible();
  await expect(dialog.getByText("외부 관측 · Whale Alert", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("채널 신뢰도 중간", { exact: true })).toBeVisible();
});
