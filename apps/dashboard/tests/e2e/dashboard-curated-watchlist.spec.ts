import { expect, test } from "@playwright/experimental-ct-react";

import {
  buildCuratedWatchlistItems,
  listEnabledCuratedWalletEntries,
} from "@/lib/curated-wallets";

test("curated watchlist seed covers 20 entries with anchor representatives", async () => {
  const items = buildCuratedWatchlistItems({
    wallets: listEnabledCuratedWalletEntries(),
    maxItems: 20,
  });

  expect(items).toHaveLength(20);

  const representativeEntityIds = new Set(
    items.filter((item) => item.isRepresentative !== false).map((item) => item.entityId),
  );

  expect(representativeEntityIds.has("donald-trump")).toBeTruthy();
  expect(representativeEntityIds.has("world-liberty-financial")).toBeTruthy();
  expect(representativeEntityIds.has("vitalik-buterin")).toBeTruthy();
  expect(representativeEntityIds.has("justin-sun")).toBeTruthy();
});

test("curated watchlist notes stay deterministic within the same day while anchor entities differ", async () => {
  const firstPass = buildCuratedWatchlistItems({
    wallets: listEnabledCuratedWalletEntries(),
    maxItems: 20,
  });
  const secondPass = buildCuratedWatchlistItems({
    wallets: listEnabledCuratedWalletEntries(),
    maxItems: 20,
  });

  expect(
    firstPass.map((item) => ({
      id: item.id,
      note: item.note,
    })),
  ).toEqual(
    secondPass.map((item) => ({
      id: item.id,
      note: item.note,
    })),
  );

  const anchorNotes = firstPass
    .filter((item) =>
      ["donald-trump", "world-liberty-financial", "vitalik-buterin", "justin-sun"].includes(
        item.entityId ?? "",
      ),
    )
    .map((item) => item.note);

  expect(new Set(anchorNotes).size).toBeGreaterThanOrEqual(4);
});
