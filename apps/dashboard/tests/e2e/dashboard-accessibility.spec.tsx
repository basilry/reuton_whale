import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "playwright";

import { CuratedWatchlistPanel } from "@/components/curated-watchlist-panel";
import { FearGreedGauge } from "@/components/fear-greed-gauge";
import { LanguageSelector } from "@/components/language-selector";
import { WhaleStoryPanel } from "@/components/whale-story-panel";

import {
  applyDashboardTestDocument,
  buildFearGreedBoundaryFixture,
  buildCuratedWatchlistItem,
  buildFearGreedCopy,
  buildFearGreedFixture,
  buildFearGreedUnavailableFixture,
  buildWalletDetailPayload,
  buildWhaleStory,
  TEST_SURFACE_STYLE,
} from "./dashboard-accessibility.harness";

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

  const component = await mount(
    <div style={TEST_SURFACE_STYLE}>
      <CuratedWatchlistPanel
        items={[buildCuratedWatchlistItem()]}
        initialLanguage="en"
      />
    </div>,
  );
  const trigger = component.getByRole("button", { name: /alpha treasury/i });

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
  const languageButton = component.getByRole("button", {
    name: /대시보드 언어 선택|select dashboard language/i,
  });

  await expect(component).toContainText("시장 공포탐욕지수");
  await expect(gauge).toHaveAttribute("aria-label", /현재 시장 공포탐욕지수 72, 탐욕 구간/);

  await languageButton.click();
  await page.getByRole("option", { name: "English" }).click();

  await expect(component).toContainText("Fear & Greed Index");
  await expect(gauge).toHaveAttribute(
    "aria-label",
    /Current market fear and greed index 72, Greed\./,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("fear and greed gauge renders source and freshness metadata when the feed is unavailable", async ({
  mount,
  page,
}) => {
  await page.evaluate(applyDashboardTestDocument, "ko");

  const component = await mount(
    <div style={{ ...TEST_SURFACE_STYLE, display: "grid", gap: "16px", maxWidth: "420px" }}>
      <FearGreedGauge
        copy={buildFearGreedCopy()}
        data={buildFearGreedUnavailableFixture()}
        fallback={<p>Fallback summary</p>}
        language="ko"
      />
    </div>,
  );

  await expect(component.getByText("Fallback summary")).toBeVisible();
  await expect(component.getByText("Alternative.me · 외부 시장 심리 지수")).toBeVisible();
  await expect(component.getByText("최근 지수 시각")).toBeVisible();
  await expect(component.getByText("업데이트 대기")).toBeVisible();
  await expect(component.getByText("마지막 확인")).toBeVisible();
  await expect(component.getByText(/고래 시그널 기반 시장 분위기 설명만 우선 보여주고 있습니다/)).toBeVisible();
  await expect(component.getByRole("img")).toHaveCount(0);
});

test("fear and greed gauge keeps boundary values readable at 0 and 100", async ({
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
        data={buildFearGreedBoundaryFixture(100, "extreme_greed")}
        fallback={<p>Fallback</p>}
        language="ko"
      />
    </div>,
  );

  const gauges = component.getByRole("img");

  await expect(gauges.nth(0)).toHaveAttribute(
    "aria-label",
    /현재 시장 공포탐욕지수 0, .*공포 구간/,
  );
  await expect(gauges.nth(1)).toHaveAttribute(
    "aria-label",
    /현재 시장 공포탐욕지수 100, .*탐욕 구간/,
  );
});
