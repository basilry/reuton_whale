import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "playwright";

import { CuratedWatchlistPanel } from "@/components/curated-watchlist-panel";
import { FearGreedGauge } from "@/components/fear-greed-gauge";
import { LanguageSelector } from "@/components/language-selector";
import { WhaleStoryPanel } from "@/components/whale-story-panel";
import {
  FEAR_GREED_ENDPOINT,
  FEAR_GREED_REVALIDATE_SECONDS,
  getFearGreedData,
} from "@/lib/fear-greed";

import {
  applyDashboardTestDocument,
  buildFearGreedBoundaryFixture,
  buildCuratedWatchlistItem,
  buildFearGreedCopy,
  buildFearGreedFixture,
  buildWalletDetailPayload,
  buildWhaleStory,
  TEST_SURFACE_STYLE,
} from "./dashboard-accessibility.harness";

function getExpectedGaugeProgress(value: number): number {
  return Math.max(Math.min(Math.max(value, 0), 100), 0.0001);
}

function getExpectedNeedleRotation(value: number): number {
  return Math.min(Math.max(value, 0), 100) * 1.8 - 90;
}

async function mockWalletDetailResponse(
  page: Page,
  payload = buildWalletDetailPayload(),
) {
  await page.evaluate((mockPayload) => {
    window.fetch = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);

      if (url.includes("/api/wallet/")) {
        return new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected fetch during component test: ${url}`);
    };
  }, payload);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
});

test("curated wallet modal passes axe and preserves focus semantics", async ({
  mount,
  page,
}) => {
  await mockWalletDetailResponse(page);
  await page.evaluate(applyDashboardTestDocument, "en");
  const item = buildCuratedWatchlistItem("wallet-e2e", {
    noteVariantId: "critical-07",
  });

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <CuratedWatchlistPanel
        items={[item]}
        initialLanguage="en"
      />
    </div>,
  );
  const trigger = component.getByRole("button", {
    name: /alpha treasury.*recent exchange-linked inflow needs a closer read\..*last seen 2026\.04\.19 09:00:00.*open detail/i,
  });

  await expect(trigger).toHaveAccessibleName(
    /alpha treasury.*recent exchange-linked inflow needs a closer read\..*last seen 2026\.04\.19 09:00:00.*open detail/i,
  );
  await expect(trigger).not.toHaveAccessibleName(/critical-07/i);

  await trigger.click();

  const dialog = page.getByRole("dialog", { name: /alpha treasury/i });
  const closeButton = page.getByRole("button", { name: /close wallet detail/i });
  const sourceLink = page.getByRole("link", { name: /open source/i });

  await expect(dialog).toBeVisible();
  await expect(closeButton).toBeFocused();

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press("Shift+Tab");
  await expect(sourceLink).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("whale story modal passes axe and restores focus on close", async ({
  mount,
  page,
}) => {
  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <WhaleStoryPanel stories={[buildWhaleStory()]} />
    </div>,
  );
  const trigger = component.getByRole("button", { name: /eth whale moves into external vault/i });

  await trigger.click();

  const dialog = page.getByRole("dialog", { name: /eth whale moves into external vault/i });
  const closeButton = page.getByRole("button", { name: /고래 스토리 상세 닫기/ });
  const explorerLink = page.getByRole("link", { name: /익스플로러에서 열기/ });

  await expect(dialog).toBeVisible();
  await expect(closeButton).toBeFocused();

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press("Shift+Tab");
  await expect(explorerLink).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("reduced motion disables whale story trigger transitions and motion offsets", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <WhaleStoryPanel stories={[buildWhaleStory("story-reduced-motion")]} />
    </div>,
  );
  const trigger = component.getByRole("button", { name: /eth whale moves into external vault/i });
  const storyCard = trigger.locator(":scope > div").first();

  await trigger.hover();

  await expect(storyCard).toHaveCSS("transition-duration", "0s");
  await expect(storyCard).toHaveCSS("transform", "none");
});

test("fear and greed gauge exposes aria labels and updates copy after ko/en switch", async ({
  mount,
  page,
}) => {
  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={{ ...TEST_SURFACE_STYLE, display: "grid", gap: "16px", maxWidth: "420px" }}>
      <LanguageSelector currentLang="ko" />
      <FearGreedGauge
        copy={buildFearGreedCopy()}
        data={buildFearGreedFixture()}
        fallback={<p>Fallback</p>}
        language="ko"
      />
    </div>,
  );
  const gauge = component.getByRole("img");
  const languageButton = component.getByRole("button", { name: "대시보드 언어 선택" });

  await expect(component).toContainText("시장 공포탐욕지수");
  await expect(gauge).toHaveAttribute("aria-label", /현재 시장 공포탐욕지수 72, 탐욕 구간/);
  await expect(languageButton).toHaveAccessibleName("대시보드 언어 선택");

  await languageButton.click();
  await expect(page.getByRole("listbox", { name: "대시보드 언어" })).toBeVisible();
  await expect(page.getByRole("option", { name: "한국어" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("option", { name: "English" }).click();

  const englishLanguageButton = component.getByRole("button", {
    name: "Select dashboard language",
  });
  await expect(component).toContainText("Fear & Greed Index");
  await expect(gauge).toHaveAttribute(
    "aria-label",
    /Current market fear and greed index 72, Greed\./,
  );
  await expect(englishLanguageButton).toHaveAccessibleName("Select dashboard language");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-dashboard-lang", "en");

  await englishLanguageButton.click();
  await expect(page.getByRole("listbox", { name: "Dashboard language" })).toBeVisible();
  await expect(page.getByRole("option", { name: "English" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("option", { name: "Korean" }).click();

  await expect(component).toContainText("시장 공포탐욕지수");
  await expect(gauge).toHaveAttribute("aria-label", /현재 시장 공포탐욕지수 72, 탐욕 구간/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("html")).toHaveAttribute("data-dashboard-lang", "ko");
});

test("fear and greed gauge fallback preserves accessible metadata and supports forced failures", async ({
  mount,
  page,
}) => {
  const unavailable = await getFearGreedData({
    forcedUnavailableReason: "payload_error",
    fetchedAt: "2026-04-19T00:07:00.000Z",
  });

  expect(unavailable.status).toBe("unavailable");
  expect(unavailable.unavailableReason).toBe("payload_error");
  expect(unavailable.fetchedAt).toBe("2026-04-19T00:07:00.000Z");

  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={{ ...TEST_SURFACE_STYLE, display: "grid", gap: "16px", maxWidth: "420px" }}>
      <LanguageSelector currentLang="ko" />
      <FearGreedGauge
        copy={buildFearGreedCopy()}
        data={unavailable}
        fallback={<p>Fallback summary</p>}
        language="ko"
      />
    </div>,
  );
  const languageButton = component.getByRole("button", { name: "대시보드 언어 선택" });

  await expect(component.getByText("Fallback summary")).toBeVisible();
  await expect(
    component.getByRole("link", { name: "Alternative.me · 외부 시장 심리 지수" }),
  ).toBeVisible();
  await expect(component.getByText("최근 지수 시각")).toBeVisible();
  await expect(component.getByText("업데이트 대기")).toBeVisible();
  await expect(component.getByText("마지막 확인")).toBeVisible();
  await expect(component.getByText(/고래 시그널 기반 시장 분위기 설명만 우선 보여주고 있습니다/)).toBeVisible();
  await expect(component.getByRole("img")).toHaveCount(0);

  await languageButton.click();
  await page.getByRole("option", { name: "English" }).click();

  await expect(
    component.getByRole("link", { name: "Alternative.me · External market sentiment index" }),
  ).toBeVisible();
  await expect(component.getByText("Latest index reading")).toBeVisible();
  await expect(component.getByText("Awaiting update")).toBeVisible();
  await expect(component.getByText("Last checked")).toBeVisible();
  await expect(
    component.getByText(
      /Alternative\.me is currently unavailable, so WhaleScope is showing the market mood summary without the index gauge\./,
    ),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("fear and greed gauge keeps boundary values and needle positions deterministic at 0, 50, and 100", async ({
  mount,
  page,
}) => {
  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={{ ...TEST_SURFACE_STYLE, display: "grid", gap: "16px", maxWidth: "420px" }}>
      <FearGreedGauge
        copy={buildFearGreedCopy()}
        data={buildFearGreedBoundaryFixture(0, "extreme_fear")}
        fallback={<p>Fallback</p>}
        language="ko"
      />
      <FearGreedGauge
        copy={buildFearGreedCopy()}
        data={buildFearGreedBoundaryFixture(50, "neutral")}
        fallback={<p>Fallback</p>}
        language="ko"
      />
      <FearGreedGauge
        copy={buildFearGreedCopy()}
        data={buildFearGreedBoundaryFixture(100, "extreme_greed")}
        fallback={<p>Fallback</p>}
        language="ko"
      />
    </div>,
  );

  const gauges = component.getByRole("img");
  const boundaryCopy = buildFearGreedCopy();

  await expect(gauges.nth(0)).toHaveAttribute(
    "aria-label",
    /현재 시장 공포탐욕지수 0, .*공포 구간/,
  );
  await expect(gauges.nth(1)).toHaveAttribute(
    "aria-label",
    /현재 시장 공포탐욕지수 50, 중립 구간/,
  );
  await expect(gauges.nth(2)).toHaveAttribute(
    "aria-label",
    /현재 시장 공포탐욕지수 100, .*탐욕 구간/,
  );

  const expectedBoundaries = [
    {
      value: 0,
      rotation: getExpectedNeedleRotation(0),
      progress: getExpectedGaugeProgress(0),
      label: boundaryCopy.classificationLabels.extreme_fear,
    },
    {
      value: 50,
      rotation: getExpectedNeedleRotation(50),
      progress: getExpectedGaugeProgress(50),
      label: boundaryCopy.classificationLabels.neutral,
    },
    {
      value: 100,
      rotation: getExpectedNeedleRotation(100),
      progress: getExpectedGaugeProgress(100),
      label: boundaryCopy.classificationLabels.extreme_greed,
    },
  ];

  for (const [index, expected] of expectedBoundaries.entries()) {
    const gauge = gauges.nth(index);

    await expect(gauge).toHaveAttribute("data-current-value", String(expected.value));
    await expect(
      gauge.locator('[data-testid="fear-greed-progress"]'),
    ).toHaveAttribute("data-progress", String(expected.progress));
    await expect(
      gauge.locator('[data-testid="fear-greed-needle"]'),
    ).toHaveAttribute("data-needle-rotation", String(expected.rotation));
    await expect(gauge.locator('[data-testid="fear-greed-value"]')).toHaveText(String(expected.value));
    await expect(gauge.locator('[data-testid="fear-greed-classification"]')).toHaveText(expected.label);
  }
});

test("getFearGreedData uses Alternative.me fetch options and supports local fallback verification", async () => {
  const calls: Array<{
    input: RequestInfo | URL;
    init: RequestInit | undefined;
  }> = [];

  const ready = await getFearGreedData({
    fetchedAt: "2026-04-19T00:07:00.000Z",
    fetchImpl: async (input, init) => {
      calls.push({ input, init });

      const rows = Array.from({ length: 31 }, (_, index) => ({
        value: String(100 - index),
        value_classification: index === 0 ? "Extreme Greed" : "Greed",
        timestamp: String(1_776_528_000 - index * 86_400),
        time_until_update: index === 0 ? "900" : undefined,
      }));

      return new Response(JSON.stringify({ data: rows }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  });

  expect(calls).toHaveLength(1);
  expect(String(calls[0]?.input)).toBe(FEAR_GREED_ENDPOINT);
  expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.Accept).toBe(
    "application/json",
  );
  expect(
    ((calls[0]?.init as RequestInit & { next?: { revalidate?: number } } | undefined)?.next
      ?.revalidate),
  ).toBe(FEAR_GREED_REVALIDATE_SECONDS);
  expect(ready.status).toBe("ready");
  expect(ready.current?.value).toBe(100);
  expect(ready.current?.classification).toBe("extreme_greed");
  expect(ready.nextUpdateInSeconds).toBe(900);
  expect(ready.fetchedAt).toBe("2026-04-19T00:07:00.000Z");

  const payloadError = await getFearGreedData({
    fetchedAt: "2026-04-19T00:08:00.000Z",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          metadata: {
            error: "upstream unavailable",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
  });

  expect(payloadError.status).toBe("unavailable");
  expect(payloadError.unavailableReason).toBe("payload_error");
  expect(payloadError.fetchedAt).toBe("2026-04-19T00:08:00.000Z");
});
