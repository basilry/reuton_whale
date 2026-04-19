import "../../app/globals.css";

import type { CuratedWalletDetailPayload } from "@/components/curated-wallet-detail-modal";
import type { FearGreedData } from "@/lib/fear-greed";
import { FEAR_GREED_SOURCE_URL } from "@/lib/fear-greed";
import { koDictionary } from "@/lib/i18n/dictionaries/ko";
import type { CuratedWatchlistItem, WhaleStory } from "@/lib/types";

export const TEST_SURFACE_STYLE = {
  minHeight: "100vh",
  padding: "24px",
  background: "var(--surface)",
  color: "var(--on-surface)",
} as const;

export async function applyDashboardTestDocument(language = "ko") {
  document.documentElement.lang = language;
  document.documentElement.setAttribute("data-dashboard-lang", language);
  document.documentElement.setAttribute("data-theme", "light");
  document.cookie = `dashboard_lang=${language}; path=/`;
}

export function buildFearGreedFixture(): FearGreedData {
  return {
    current: {
      value: 72,
      classification: "greed",
      timestamp: "2026-04-19T00:00:00.000Z",
      rawClassification: "Greed",
    },
    yesterday: {
      value: 65,
      classification: "greed",
      timestamp: "2026-04-18T00:00:00.000Z",
      rawClassification: "Greed",
    },
    weekAgo: {
      value: 54,
      classification: "greed",
      timestamp: "2026-04-12T00:00:00.000Z",
      rawClassification: "Greed",
    },
    monthAgo: {
      value: 48,
      classification: "neutral",
      timestamp: "2026-03-20T00:00:00.000Z",
      rawClassification: "Neutral",
    },
    nextUpdateInSeconds: 3_600,
    fetchedAt: "2026-04-19T00:05:00.000Z",
    isStale: false,
    sourceUrl: FEAR_GREED_SOURCE_URL,
  };
}

export function buildCuratedWatchlistItem(id = "wallet-e2e"): CuratedWatchlistItem {
  return {
    id,
    symbol: "BTC",
    title: "Alpha Treasury",
    note: "Recent exchange-linked inflow needs a closer read.",
    badge: "A등급 거래소",
    address: "0x1111111111111111111111111111111111111111",
    chain: "ethereum",
    enabled: true,
    category: "exchange",
    grade: "A",
    priority: 1,
    displayPriority: 1,
    entityId: "alpha-treasury-entity",
    isRepresentative: true,
    narrativeTags: ["exchange", "custody"],
    tone: "watch",
    lastSeenAt: "2026.04.19 09:00:00",
    relatedSignalCount: 2,
  };
}

export function buildWalletDetailPayload(
  walletId = "wallet-e2e",
): CuratedWalletDetailPayload {
  return {
    wallet: {
      id: walletId,
      entityId: "alpha-treasury-entity",
      label: "Alpha Treasury",
      address: "0x1111111111111111111111111111111111111111",
      chain: "ethereum",
      category: "exchange",
      grade: "A",
      enabled: true,
      isRepresentative: true,
      note: "Representative exchange wallet used for accessibility regression tests.",
      focusSymbols: ["BTC"],
      aliases: ["alpha treasury"],
      narrativeTags: ["exchange", "custody"],
      sourceRef: "fixture",
      sourceUrl: "https://example.com/source/alpha-treasury",
      approxBalance: "$12.4M",
      updatedAt: "2026-04-19T00:00:00.000Z",
    },
    entity: {
      id: "alpha-treasury-entity",
      matchedOn: "entity_id",
      walletCount: 1,
      representativeWalletId: walletId,
      relatedWallets: [
        {
          id: walletId,
          label: "Alpha Treasury",
          address: "0x1111111111111111111111111111111111111111",
          chain: "ethereum",
          category: "exchange",
          grade: "A",
          isRepresentative: true,
        },
      ],
    },
    stats: {
      lastSeenAt: "2026-04-19T00:00:00.000Z",
      relatedSignalCount: 2,
      recentTransactionCount: 3,
      inflowUsd: 2_400_000,
      outflowUsd: 800_000,
      netflowUsd: 1_600_000,
      latestBalance: "$12.4M",
      latestBalanceUpdatedAt: "2026-04-19T00:00:00.000Z",
    },
    balances: [],
    transactions: [],
    signals: [],
    meta: {
      resolvedBy: "entity_id",
      availableSources: {
        curatedWallets: true,
        transactions: true,
        signals: true,
        balances: true,
      },
    },
  };
}

export function buildWhaleStory(id = "story-e2e"): WhaleStory {
  return {
    id,
    kind: "transaction",
    title: "ETH whale moves into external vault",
    body: "A large Ethereum transfer left an exchange-linked wallet and moved into a less active destination.",
    meta: "Ethereum · 15 minutes ago",
    tone: "watch",
    hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    symbol: "ETH",
    chain: "ethereum",
    amountToken: 2_450,
    amountUsd: 8_200_000,
    explorerUrl: "https://example.com/tx/0xaaaaaaaa",
    counterpartyNote: "Destination wallet has lower recent activity.",
    occurredAt: "2026-04-19T00:00:00.000Z",
    generatedAt: "2026-04-19T00:05:00.000Z",
    priority: 1,
    supportingSignalIds: ["signal-001"],
    participants: [
      {
        role: "from",
        label: "Alpha Exchange",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        role: "to",
        label: "External Vault",
        address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ],
  };
}

export function buildFearGreedCopy() {
  const { home } = koDictionary;

  return {
    title: home.fearGreedTitle,
    subtitle: home.fearGreedSubtitle,
    classificationLabels: {
      extreme_fear: home.fearGreedClassificationExtremeFear,
      fear: home.fearGreedClassificationFear,
      neutral: home.fearGreedClassificationNeutral,
      greed: home.fearGreedClassificationGreed,
      extreme_greed: home.fearGreedClassificationExtremeGreed,
    },
    compareLabels: {
      yesterday: home.fearGreedCompareYesterday,
      week: home.fearGreedCompareWeek,
      month: home.fearGreedCompareMonth,
    },
    nextUpdateLabel: home.fearGreedNextUpdateLabel,
    nextUpdateValue: home.fearGreedNextUpdateValue,
    nextUpdateUnavailable: home.fearGreedNextUpdateUnavailable,
    sourceLabel: home.fearGreedSourceLabel,
    staleWarning: home.fearGreedStaleWarning,
    ariaLabel: home.fearGreedAriaLabel,
    disclaimer: home.fearGreedDisclaimer,
  };
}
