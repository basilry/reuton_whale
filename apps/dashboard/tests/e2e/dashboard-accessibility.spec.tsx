import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "playwright";

import { CuratedWatchlistPanel } from "@/components/curated-watchlist-panel";
import { FearGreedGauge } from "@/components/fear-greed-gauge";
import { LanguageSelector } from "@/components/language-selector";
import { WhaleStoryPanel } from "@/components/whale-story-panel";

import {
  applyDashboardTestDocument,
  buildCuratedWatchlistItem,
  buildFearGreedCopy,
  buildFearGreedFixture,
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
