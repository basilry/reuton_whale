import { expect, test } from "@playwright/experimental-ct-react";

import {
  buildCuratedWatchlistItems,
  listEnabledCuratedWalletEntries,
  listCuratedNoteVariants,
} from "@/lib/curated-wallets";

const FIXED_DATE_SEED = "2026-04-19";

function buildSyntheticTransactions(
  role: "from" | "to",
  amountUsd: number,
  dateSeed: string,
) {
  return listEnabledCuratedWalletEntries().map((wallet, index) => {
    const syntheticAddress = `0x${(index + 101).toString(16).padStart(40, "0")}`;
    const timestamp = `${dateSeed}T00:00:00.000Z`;

    return {
      hash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      symbol: wallet.focusSymbols?.[0] ?? wallet.chain.toUpperCase(),
      amount_usd: String(amountUsd),
      timestamp,
      created_at: timestamp,
      from_address: role === "from" ? wallet.address : syntheticAddress,
      from_owner: role === "from" ? wallet.label : "Synthetic counterparty",
      to_address: role === "to" ? wallet.address : syntheticAddress,
      to_owner: role === "to" ? wallet.label : "Synthetic counterparty",
      blockchain: wallet.chain,
    };
  });
}

function buildDateSeed(offset: number): string {
  return new Date(Date.UTC(2026, 0, offset + 1)).toISOString().slice(0, 10);
}

test("curated watchlist seed covers 20 entries with anchor representatives", async () => {
  const items = buildCuratedWatchlistItems({
    wallets: listEnabledCuratedWalletEntries(),
    maxItems: 20,
    dateSeed: FIXED_DATE_SEED,
  });

  expect(items).toHaveLength(20);
  expect(items.every((item) => typeof item.noteVariantId === "string")).toBeTruthy();

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
    dateSeed: FIXED_DATE_SEED,
  });
  const secondPass = buildCuratedWatchlistItems({
    wallets: listEnabledCuratedWalletEntries(),
    maxItems: 20,
    dateSeed: FIXED_DATE_SEED,
  });

  expect(
    firstPass.map((item) => ({
      id: item.id,
      note: item.note,
      noteVariantId: item.noteVariantId,
    })),
  ).toEqual(
    secondPass.map((item) => ({
      id: item.id,
      note: item.note,
      noteVariantId: item.noteVariantId,
    })),
  );

  expect(firstPass.some((item) => item.note.includes(item.noteVariantId ?? ""))).toBeFalsy();

  const anchorNoteVariantIds = firstPass
    .filter((item) =>
      ["donald-trump", "world-liberty-financial", "vitalik-buterin", "justin-sun"].includes(
        item.entityId ?? "",
      ),
    )
    .map((item) => item.noteVariantId);

  expect(new Set(anchorNoteVariantIds).size).toBeGreaterThanOrEqual(4);
});

test("all 21 curated note variants are reachable through deterministic note selection", async () => {
  const wallets = listEnabledCuratedWalletEntries();
  const expectedVariantIds = listCuratedNoteVariants()
    .map((variant) => variant.id)
    .sort();
  const observedVariantIds = new Set<string>();

  expect(expectedVariantIds).toHaveLength(21);

  for (let offset = 0; offset < 120 && observedVariantIds.size < expectedVariantIds.length; offset += 1) {
    const dateSeed = buildDateSeed(offset);
    const scenarios = [
      {
        dateSeed,
        recentTransactions: [],
      },
      {
        dateSeed,
        recentTransactions: buildSyntheticTransactions("from", 150_000, dateSeed),
      },
      {
        dateSeed,
        recentTransactions: buildSyntheticTransactions("to", 150_000, dateSeed),
      },
      {
        dateSeed,
        recentTransactions: buildSyntheticTransactions("from", 2_000_000, dateSeed),
      },
      {
        dateSeed,
        recentTransactions: buildSyntheticTransactions("to", 2_000_000, dateSeed),
      },
    ];

    for (const scenario of scenarios) {
      const items = buildCuratedWatchlistItems({
        wallets,
        maxItems: wallets.length,
        ...scenario,
      });

      for (const item of items) {
        if (item.noteVariantId) {
          observedVariantIds.add(item.noteVariantId);
        }
      }
    }
  }

  expect([...observedVariantIds].sort()).toEqual(expectedVariantIds);
});
