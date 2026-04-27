import { NextResponse } from "next/server";

import { createGenericErrorResponse } from "@/lib/auth";
import { loadCuratedWalletEntries } from "@/lib/curated-wallets";
import {
  compactString,
  newestFirst,
  parseDateTimeSafe,
  parseFloatSafe,
  parseJsonSafe,
  sanitizeForRsc,
} from "@/lib/format";
import { API_RATE_LIMIT, clientKey, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type {
  CuratedWalletBalanceRow,
  CuratedWalletRow,
  SheetRowMap,
  SignalRow,
  TransactionRow,
} from "@/lib/schema";
import { readSheetRows } from "@/lib/sheets";
import type { CuratedWalletEntry } from "@/lib/types";

export const runtime = "nodejs";

const WALLET_DETAIL_RATE_LIMIT = {
  ...API_RATE_LIMIT,
  maxRequests: 120,
};

type ResolvedWalletMatch = {
  wallet: CuratedWalletEntry;
  matchedOn: "entity_id" | "wallet_id" | "address" | "alias" | "label";
};

function normalizeKey(value: string | undefined | null): string {
  return compactString(value).toLowerCase();
}

function slugify(value: string | undefined | null): string {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function shortAddress(value: string): string {
  const text = compactString(value);
  if (text.length <= 14) {
    return text || "-";
  }
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function safeLabel(label: string | undefined | null, address: string): string {
  return compactString(label) || shortAddress(address);
}

function parseNumberLoose(value: string | undefined | null): number | null {
  const text = compactString(value);
  if (!text) {
    return null;
  }

  const direct = parseFloatSafe(text.replaceAll(",", ""));
  if (direct != null) {
    return direct;
  }

  const matched = text.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return matched ? parseFloatSafe(matched[0]) : null;
}

function normalizeEvidenceHashes(value: string): string[] {
  return compactString(value)
    .split(/[,|\s]+/)
    .map((item) => compactString(item).toLowerCase())
    .filter(Boolean);
}

function resolveWalletMatch(
  entityOrAddress: string,
  wallets: readonly CuratedWalletEntry[],
): ResolvedWalletMatch | null {
  const normalized = normalizeKey(entityOrAddress);
  const slug = slugify(entityOrAddress);
  if (!normalized && !slug) {
    return null;
  }

  for (const wallet of wallets) {
    if (normalizeKey(wallet.entityId) === normalized || slugify(wallet.entityId) === slug) {
      return { wallet, matchedOn: "entity_id" };
    }
  }

  for (const wallet of wallets) {
    if (normalizeKey(wallet.id) === normalized || slugify(wallet.id) === slug) {
      return { wallet, matchedOn: "wallet_id" };
    }
  }

  for (const wallet of wallets) {
    if (normalizeKey(wallet.address) === normalized) {
      return { wallet, matchedOn: "address" };
    }
  }

  for (const wallet of wallets) {
    const aliases = wallet.aliases ?? [];
    if (aliases.some((alias) => normalizeKey(alias) === normalized || slugify(alias) === slug)) {
      return { wallet, matchedOn: "alias" };
    }
  }

  for (const wallet of wallets) {
    if (normalizeKey(wallet.label) === normalized || slugify(wallet.label) === slug) {
      return { wallet, matchedOn: "label" };
    }
  }

  return null;
}

async function readOptionalRows<T extends keyof SheetRowMap>(tab: T): Promise<SheetRowMap[T][]> {
  try {
    return await readSheetRows(tab);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[api/wallet] optional tab read failed: ${tab}`, error.message);
    } else {
      console.error(`[api/wallet] optional tab read failed: ${tab}`, String(error));
    }
    return [];
  }
}

function matchesEntityWallet(
  row: Pick<CuratedWalletRow, "id" | "address" | "entity_id">,
  walletIds: Set<string>,
  walletAddresses: Set<string>,
  entityId: string | undefined,
): boolean {
  return (
    walletIds.has(normalizeKey(row.id)) ||
    walletAddresses.has(normalizeKey(row.address)) ||
    (entityId ? normalizeKey(row.entity_id) === normalizeKey(entityId) : false)
  );
}

function normalizeSignalRow(
  row: SignalRow,
  walletAddresses: Set<string>,
  transactionHashes: Set<string>,
) {
  const extra = parseJsonSafe<Record<string, unknown>>(row.extra_json) ?? {};
  const rawRelatedWallets = Array.isArray(extra.related_wallets) ? extra.related_wallets : [];
  const rawRelatedAssets = Array.isArray(extra.related_assets) ? extra.related_assets : [];
  const evidenceTxHashes = normalizeEvidenceHashes(row.evidence_tx_hashes);
  const relatedWalletLabels = rawRelatedWallets
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const address = normalizeKey(String(record.address ?? ""));
      if (!address || !walletAddresses.has(address)) {
        return null;
      }
      return (
        compactString(String(record.label ?? "")) ||
        compactString(String(record.address ?? "")) ||
        null
      );
    })
    .filter((item): item is string => Boolean(item));
  const relatedAssets = rawRelatedAssets
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      return compactString(String((item as Record<string, unknown>).symbol ?? "")) || null;
    })
    .filter((item): item is string => Boolean(item));
  const matchedByWallet = rawRelatedWallets.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as Record<string, unknown>;
    return walletAddresses.has(normalizeKey(String(record.address ?? "")));
  });
  const matchedByTx = evidenceTxHashes.some((hash) => transactionHashes.has(hash));

  if (!matchedByWallet && !matchedByTx) {
    return null;
  }

  return {
    id: compactString(row.signal_id) || compactString(row.created_at) || "signal",
    createdAt: compactString(row.created_at),
    rule: compactString(row.rule) || "signal",
    severity: compactString(row.severity) || "unknown",
    score: parseNumberLoose(row.score),
    source: compactString(row.source) || "system",
    summary: compactString(row.summary) || "",
    evidenceTxHashes,
    relatedAssets,
    relatedWalletLabels,
  };
}

function transactionDirection(
  row: TransactionRow,
  walletAddresses: Set<string>,
): "inflow" | "outflow" | "internal" {
  const fromAddress = normalizeKey(row.from_address);
  const toAddress = normalizeKey(row.to_address);
  const fromMatched = walletAddresses.has(fromAddress);
  const toMatched = walletAddresses.has(toAddress);
  if (fromMatched && toMatched) {
    return "internal";
  }
  if (toMatched) {
    return "inflow";
  }
  return "outflow";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ entityOrAddress: string }> },
) {
  const rl = rateLimit(clientKey(request), WALLET_DETAIL_RATE_LIMIT);
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfter ?? 60);
  }

  const { entityOrAddress } = await context.params;
  const decoded = decodeURIComponent(entityOrAddress ?? "");

  try {
    const wallets = await loadCuratedWalletEntries();
    const resolved = resolveWalletMatch(decoded, wallets);

    if (!resolved) {
      return NextResponse.json(
        { error: "Wallet detail not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const representative = resolved.wallet;
    const entityWallets = representative.entityId
      ? wallets.filter((wallet) => normalizeKey(wallet.entityId) === normalizeKey(representative.entityId))
      : [representative];
    const orderedEntityWallets = [...entityWallets].sort((left, right) => {
      if (Boolean(left.isRepresentative) !== Boolean(right.isRepresentative)) {
        return left.isRepresentative ? -1 : 1;
      }
      const leftPriority = left.displayPriority ?? Number.NEGATIVE_INFINITY;
      const rightPriority = right.displayPriority ?? Number.NEGATIVE_INFINITY;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      return left.priority - right.priority;
    });
    const walletIds = new Set(orderedEntityWallets.map((wallet) => normalizeKey(wallet.id)));
    const walletAddresses = new Set(
      orderedEntityWallets.map((wallet) => normalizeKey(wallet.address)).filter(Boolean),
    );

    const [curatedRows, transactionRows, signalRows, balanceRows] = await Promise.all([
      readOptionalRows("curated_wallets"),
      readOptionalRows("transactions"),
      readOptionalRows("signals"),
      readOptionalRows("curated_wallet_balances"),
    ]);

    const matchingCuratedRows = curatedRows.filter((row) =>
      matchesEntityWallet(row, walletIds, walletAddresses, representative.entityId),
    );
    const matchingTransactions = newestFirst(transactionRows, (row) => {
      return parseDateTimeSafe(row.created_at) ?? parseDateTimeSafe(row.timestamp);
    }).filter((row) => {
      return (
        walletAddresses.has(normalizeKey(row.from_address)) ||
        walletAddresses.has(normalizeKey(row.to_address))
      );
    });
    const transactionHashes = new Set(
      matchingTransactions.map((row) => normalizeKey(row.hash)).filter(Boolean),
    );
    const matchingSignals = newestFirst(signalRows, (row) => parseDateTimeSafe(row.created_at))
      .map((row) => normalizeSignalRow(row, walletAddresses, transactionHashes))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const matchingBalances = newestFirst(balanceRows, (row) => parseDateTimeSafe(row.updated_at))
      .filter((row) => {
        return (
          walletIds.has(normalizeKey(row.wallet_id)) ||
          walletAddresses.has(normalizeKey(row.address))
        );
      })
      .reduce<CuratedWalletBalanceRow[]>((rows, row) => {
        const dedupeKey = `${normalizeKey(row.wallet_id)}:${normalizeKey(row.address)}`;
        if (rows.some((entry) => `${normalizeKey(entry.wallet_id)}:${normalizeKey(entry.address)}` === dedupeKey)) {
          return rows;
        }
        rows.push(row);
        return rows;
      }, []);

    const inflowUsd = matchingTransactions.reduce((total, row) => {
      if (transactionDirection(row, walletAddresses) !== "inflow") {
        return total;
      }
      return total + (parseNumberLoose(row.amount_usd) ?? 0);
    }, 0);
    const outflowUsd = matchingTransactions.reduce((total, row) => {
      if (transactionDirection(row, walletAddresses) !== "outflow") {
        return total;
      }
      return total + (parseNumberLoose(row.amount_usd) ?? 0);
    }, 0);
    const latestSeenAt = [
      matchingTransactions[0]?.created_at || matchingTransactions[0]?.timestamp,
      matchingSignals[0]?.createdAt,
      matchingBalances[0]?.updated_at,
    ]
      .map((value) => compactString(value))
      .find(Boolean);
    const representativeCuratedRow =
      matchingCuratedRows.find((row) => normalizeKey(row.address) === normalizeKey(representative.address)) ??
      matchingCuratedRows[0] ??
      null;
    const latestBalanceRow =
      matchingBalances.find((row) => normalizeKey(row.wallet_id) === normalizeKey(representative.id)) ??
      matchingBalances[0] ??
      null;

    const payload = sanitizeForRsc({
      wallet: {
        id: representative.id,
        entityId: representative.entityId,
        label: representative.label,
        address: representative.address,
        chain: representative.chain,
        category: representative.category,
        grade: representative.grade,
        enabled: representative.enabled,
        isRepresentative: representative.isRepresentative ?? false,
        note: representative.note,
        focusSymbols: representative.focusSymbols ?? [],
        aliases: representative.aliases ?? [],
        narrativeTags: representative.narrativeTags ?? [],
        sourceRef: compactString(
          latestBalanceRow?.source_ref ?? representativeCuratedRow?.source_ref ?? "",
        ) || undefined,
        sourceUrl: compactString(
          latestBalanceRow?.source_url ?? representativeCuratedRow?.source_url ?? "",
        ) || undefined,
        approxBalance:
          compactString(latestBalanceRow?.approx_balance ?? representativeCuratedRow?.approx_balance ?? "") ||
          undefined,
        updatedAt:
          compactString(latestBalanceRow?.updated_at ?? representativeCuratedRow?.updated_at ?? "") ||
          undefined,
      },
      entity: {
        id: representative.entityId,
        matchedOn: resolved.matchedOn,
        walletCount: orderedEntityWallets.length,
        representativeWalletId: representative.id,
        relatedWallets: orderedEntityWallets.map((wallet) => ({
          id: wallet.id,
          label: wallet.label,
          address: wallet.address,
          chain: wallet.chain,
          category: wallet.category,
          grade: wallet.grade,
          isRepresentative: wallet.isRepresentative ?? false,
        })),
      },
      stats: {
        lastSeenAt: latestSeenAt || undefined,
        relatedSignalCount: matchingSignals.length,
        recentTransactionCount: matchingTransactions.length,
        inflowUsd,
        outflowUsd,
        netflowUsd: inflowUsd - outflowUsd,
        latestBalance:
          compactString(latestBalanceRow?.approx_balance ?? representativeCuratedRow?.approx_balance ?? "") ||
          undefined,
        latestBalanceUpdatedAt:
          compactString(latestBalanceRow?.updated_at ?? representativeCuratedRow?.updated_at ?? "") ||
          undefined,
      },
      balances:
        matchingBalances.length > 0
          ? matchingBalances.slice(0, 8).map((row) => ({
              walletId: compactString(row.wallet_id),
              label:
                compactString(row.owner_label) ||
                orderedEntityWallets.find((wallet) => normalizeKey(wallet.id) === normalizeKey(row.wallet_id))
                  ?.label ||
                shortAddress(row.address),
              chain: compactString(row.chain) || "unknown",
              approxBalance: compactString(row.approx_balance) || "-",
              approxBalanceValue: parseNumberLoose(row.approx_balance),
              sourceRef: compactString(row.source_ref) || undefined,
              sourceUrl: compactString(row.source_url) || undefined,
              note: compactString(row.note) || undefined,
              isActive: normalizeKey(row.is_active) !== "false",
              updatedAt: compactString(row.updated_at) || undefined,
            }))
          : representativeCuratedRow
            ? [
                {
                  walletId: representative.id,
                  label: representative.label,
                  chain: representative.chain,
                  approxBalance: compactString(representativeCuratedRow.approx_balance) || "-",
                  approxBalanceValue: parseNumberLoose(representativeCuratedRow.approx_balance),
                  sourceRef: compactString(representativeCuratedRow.source_ref) || undefined,
                  sourceUrl: compactString(representativeCuratedRow.source_url) || undefined,
                  note: compactString(representativeCuratedRow.note) || undefined,
                  isActive: normalizeKey(representativeCuratedRow.is_active) !== "false",
                  updatedAt: compactString(representativeCuratedRow.updated_at) || undefined,
                },
              ]
            : [],
      transactions: matchingTransactions.slice(0, 12).map((row) => {
        const direction = transactionDirection(row, walletAddresses);
        const counterpartyAddress =
          direction === "inflow"
            ? compactString(row.from_address)
            : direction === "outflow"
              ? compactString(row.to_address)
              : compactString(row.to_address);
        const counterpartyLabel =
          direction === "inflow"
            ? safeLabel(row.from_owner, counterpartyAddress)
            : direction === "outflow"
              ? safeLabel(row.to_owner, counterpartyAddress)
              : "Internal transfer";

        return {
          hash: compactString(row.hash),
          timestamp: compactString(row.created_at) || compactString(row.timestamp),
          chain: compactString(row.blockchain) || "unknown",
          symbol: compactString(row.symbol) || "-",
          amount: compactString(row.amount) || "-",
          amountUsd: parseNumberLoose(row.amount_usd),
          direction,
          fromLabel: safeLabel(row.from_owner, row.from_address),
          toLabel: safeLabel(row.to_owner, row.to_address),
          fromAddress: compactString(row.from_address),
          toAddress: compactString(row.to_address),
          counterpartyLabel,
          counterpartyAddress,
        };
      }),
      signals: matchingSignals.slice(0, 8),
      meta: {
        resolvedBy: resolved.matchedOn,
        availableSources: {
          curatedWallets: true,
          transactions: matchingTransactions.length > 0,
          signals: matchingSignals.length > 0,
          balances: matchingBalances.length > 0,
        },
      },
    });

    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return createGenericErrorResponse(error, "Unable to load wallet detail.", "api/wallet");
  }
}
