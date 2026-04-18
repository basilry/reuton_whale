import {
  compactString,
  newestFirst,
  parseDateTimeSafe,
  parseFloatSafe,
  parseJsonSafe,
  parseIntSafe,
} from "./format";
import { readSheetRows, upsertWatchlistOverride } from "./sheets";
import type {
  CuratedWalletRow,
  SignalRow,
  SheetRowMap,
  TransactionRow,
  WalletAliasRow,
  WatchlistOverrideRow,
} from "./schema";
import type {
  CuratedWalletCategory,
  CuratedWalletEntry,
  CuratedWalletMatch,
  CuratedWatchlistItem,
  WhaleStoryTone,
} from "./types";

type TransactionLike = Pick<
  TransactionRow,
  | "hash"
  | "symbol"
  | "amount_usd"
  | "timestamp"
  | "created_at"
  | "from_address"
  | "from_owner"
  | "to_address"
  | "to_owner"
  | "blockchain"
>;

type SignalLike = Pick<
  SignalRow,
  "signal_id" | "rule" | "severity" | "score" | "evidence_tx_hashes" | "summary"
>;

type WalletActivity = {
  wallet: CuratedWalletEntry;
  symbol: string;
  note: string;
  badge: string;
  tone: WhaleStoryTone;
  lastSeenAt?: string;
  relatedSignalCount: number;
  activityScore: number;
};

const curatedWalletSeed: CuratedWalletEntry[] = [
  {
    id: "binance-14-eth",
    address: "0x28C6c06298d514Db089934071355E5743bf21d60",
    chain: "ethereum",
    label: "Binance 14",
    category: "exchange",
    grade: "A",
    priority: 1,
    enabled: true,
    aliases: ["binance", "binance 14", "binance hot wallet"],
    note: "대형 거래소 유동성 이동을 빠르게 보여주는 주소입니다.",
    focusSymbols: ["ETH", "BTC", "USDT"],
  },
  {
    id: "binance-16-eth",
    address: "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d",
    chain: "ethereum",
    label: "Binance 16",
    category: "exchange",
    grade: "A",
    priority: 2,
    enabled: true,
    aliases: ["binance 16", "binance deposit"],
    note: "거래소 유입 급증 신호와 함께 보기 좋은 보조 거래소 주소입니다.",
    focusSymbols: ["ETH", "USDC"],
  },
  {
    id: "binance-15-eth",
    address: "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549",
    chain: "ethereum",
    label: "Binance 15",
    category: "exchange",
    grade: "B",
    priority: 3,
    enabled: false,
    aliases: ["binance 15"],
    note: "활성 상태로 전환하면 거래소 자금 회전의 비교군으로 쓸 수 있습니다.",
    focusSymbols: ["ETH", "BTC"],
  },
  {
    id: "bitfinex-cold-btc",
    address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    chain: "bitcoin",
    label: "Bitfinex cold wallet",
    category: "custody",
    grade: "A",
    priority: 2,
    enabled: true,
    aliases: ["bitfinex", "bitfinex cold wallet", "cold wallet"],
    note: "장기 보관 성격이 강해 대규모 출금이나 재배치 신호를 보기 좋습니다.",
    focusSymbols: ["BTC"],
  },
];

const watchlistOverrides = new Map<string, boolean>();

let curatedWalletBaseRegistry: CuratedWalletEntry[] = curatedWalletSeed.map((entry) =>
  cloneWalletEntry(entry),
);
let curatedWalletRegistry: CuratedWalletEntry[] = sortWallets(
  curatedWalletBaseRegistry.map((entry) => applyOverride(entry)),
);
let curatedWalletLoadPromise: Promise<CuratedWalletEntry[]> | null = null;

function normalizeAddress(value: string): string {
  return compactString(value).toLowerCase();
}

function normalizeText(value?: string): string {
  return compactString(value).toLowerCase();
}

function normalizeWalletKey(value: string): string {
  return normalizeAddress(value);
}

function cloneWalletEntry(entry: CuratedWalletEntry): CuratedWalletEntry {
  return {
    ...entry,
    aliases: entry.aliases ? [...entry.aliases] : undefined,
    focusSymbols: entry.focusSymbols ? [...entry.focusSymbols] : undefined,
  };
}

function dedupeStrings(values: Array<string | undefined | null>): string[] | undefined {
  const result = values
    .map((value) => compactString(value))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);

  return result.length > 0 ? result : undefined;
}

function parseLooseBoolean(value: string, fallback: boolean): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return fallback;
  }
  if (["true", "1", "yes", "y", "on", "enabled", "active"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off", "disabled", "inactive"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function ownerCategoryFromSheet(value: string, fallback: CuratedWalletCategory): CuratedWalletCategory {
  switch (normalizeText(value)) {
    case "exchange":
      return "exchange";
    case "market_maker":
      return "market_maker";
    case "fund":
    case "institution":
      return "fund";
    case "custody":
      return "custody";
    case "bridge":
      return "bridge";
    case "protocol":
    case "stablecoin":
      return "protocol";
    case "foundation":
    case "founder":
      return "foundation";
    case "unknown":
    case "celebrity":
      return "unknown";
    default:
      return fallback;
  }
}

function gradeFromTier(value: string, fallback: CuratedWalletEntry["grade"]): CuratedWalletEntry["grade"] {
  const tier = parseIntSafe(compactString(value));
  if (tier == null) {
    return fallback;
  }
  if (tier <= 1) {
    return "A";
  }
  if (tier === 2) {
    return "B";
  }
  if (tier === 3) {
    return "C";
  }
  return "D";
}

function applyOverride(entry: CuratedWalletEntry): CuratedWalletEntry {
  const normalizedId = normalizeWalletKey(entry.id);
  const normalizedAddress = normalizeWalletKey(entry.address);
  const override =
    watchlistOverrides.get(normalizedId) ?? watchlistOverrides.get(normalizedAddress);
  return override === undefined ? cloneWalletEntry(entry) : { ...cloneWalletEntry(entry), enabled: override };
}

function refreshCuratedWalletRegistry(baseEntries: CuratedWalletEntry[]): CuratedWalletEntry[] {
  curatedWalletBaseRegistry = baseEntries.map((entry) => cloneWalletEntry(entry));
  curatedWalletRegistry = sortWallets(curatedWalletBaseRegistry.map((entry) => applyOverride(entry)));
  return curatedWalletRegistry;
}

function recordOverrideInMemory(entry: CuratedWalletEntry, enabled: boolean): void {
  watchlistOverrides.set(normalizeWalletKey(entry.id), enabled);
  watchlistOverrides.set(normalizeWalletKey(entry.address), enabled);
  curatedWalletRegistry = sortWallets(curatedWalletBaseRegistry.map((wallet) => applyOverride(wallet)));
}

function resolveRegistryEntry(addressOrId: string): CuratedWalletEntry | null {
  const normalized = normalizeWalletKey(addressOrId);
  if (!normalized) {
    return null;
  }

  return (
    curatedWalletRegistry.find(
      (entry) =>
        normalizeWalletKey(entry.id) === normalized || normalizeWalletKey(entry.address) === normalized,
    ) ?? null
  );
}

function walletFromSheetRow(
  row: CuratedWalletRow,
  index: number,
  fallback?: CuratedWalletEntry,
): CuratedWalletEntry {
  const fallbackCategory = fallback?.category ?? "unknown";
  const fallbackGrade = fallback?.grade ?? "C";
  const fallbackPriority = fallback?.priority ?? index + 1;
  const id = compactString(row.id) || fallback?.id || `wallet-${index + 1}`;
  const address = compactString(row.address) || fallback?.address || id;
  const label = compactString(row.owner_label) || fallback?.label || id;
  const category = ownerCategoryFromSheet(row.owner_category, fallbackCategory);
  const grade = gradeFromTier(row.tier, fallbackGrade);
  const priority = index + 1;
  const enabled = parseLooseBoolean(row.is_active, fallback?.enabled ?? true);
  const aliases = dedupeStrings([...(fallback?.aliases ?? []), compactString(row.owner_label)]);
  const note = compactString(row.note) || fallback?.note;
  const focusSymbols = fallback?.focusSymbols ? [...fallback.focusSymbols] : undefined;

  return {
    id,
    address,
    chain: compactString(row.chain) || fallback?.chain || "unknown",
    label,
    category,
    grade,
    priority: Number.isFinite(priority) ? priority : fallbackPriority,
    enabled,
    aliases,
    note,
    focusSymbols,
  };
}

function mergeAliasesForEntry(
  entry: CuratedWalletEntry,
  aliasRows: readonly WalletAliasRow[],
): CuratedWalletEntry {
  const entryKey = normalizeWalletKey(entry.id);
  const aliasValues = aliasRows
    .filter((row) => normalizeWalletKey(row.canonical_id) === entryKey)
    .flatMap((row) => [row.alias_id, row.label])
    .map((value) => compactString(value))
    .filter(Boolean);

  if (aliasValues.length === 0) {
    return entry;
  }

  return {
    ...entry,
    aliases: dedupeStrings([...(entry.aliases ?? []), ...aliasValues]),
  };
}

function loadWatchlistOverrides(
  rows: readonly WatchlistOverrideRow[],
  baseEntries: CuratedWalletEntry[],
): void {
  const byId = new Map<string, CuratedWalletEntry>();
  const byAddress = new Map<string, CuratedWalletEntry>();

  for (const entry of baseEntries) {
    byId.set(normalizeWalletKey(entry.id), entry);
    byAddress.set(normalizeWalletKey(entry.address), entry);
  }

  for (const row of rows) {
    const walletKey = normalizeWalletKey(row.wallet_id);
    if (!walletKey) {
      continue;
    }
    const enabled = parseLooseBoolean(row.enabled, true);
    watchlistOverrides.set(walletKey, enabled);

    const entry = byId.get(walletKey) ?? byAddress.get(walletKey);
    if (entry) {
      watchlistOverrides.set(normalizeWalletKey(entry.id), enabled);
      watchlistOverrides.set(normalizeWalletKey(entry.address), enabled);
    }
  }
}

async function readOptionalSheetRows<T extends keyof SheetRowMap>(
  tab: T,
): Promise<Array<SheetRowMap[T]>> {
  try {
    return await readSheetRows(tab);
  } catch {
    return [];
  }
}

async function loadSheetBackedRegistry(): Promise<CuratedWalletEntry[]> {
  const [walletRows, aliasRows, overrideRows] = await Promise.all([
    readOptionalSheetRows("curated_wallets"),
    readOptionalSheetRows("wallet_aliases"),
    readOptionalSheetRows("watchlist_overrides"),
  ]);

  const entriesById = new Map<string, CuratedWalletEntry>();
  const orderedEntries: CuratedWalletEntry[] = [];

  for (const seedEntry of curatedWalletSeed) {
    const cloned = cloneWalletEntry(seedEntry);
    entriesById.set(normalizeWalletKey(cloned.id), cloned);
    orderedEntries.push(cloned);
  }

  for (let index = 0; index < walletRows.length; index += 1) {
    const row = walletRows[index];
    const normalizedId = normalizeWalletKey(row.id);
    const fallback =
      entriesById.get(normalizedId) ??
      orderedEntries.find((entry) => normalizeWalletKey(entry.address) === normalizeWalletKey(row.address));

    const nextEntry = walletFromSheetRow(row, index, fallback);
    const current = entriesById.get(normalizeWalletKey(nextEntry.id));
    if (current) {
      const merged = {
        ...current,
        ...nextEntry,
        aliases: dedupeStrings([...(current.aliases ?? []), ...(nextEntry.aliases ?? [])]),
        focusSymbols: dedupeStrings([...(current.focusSymbols ?? []), ...(nextEntry.focusSymbols ?? [])]),
      };
      entriesById.set(normalizeWalletKey(merged.id), merged);
      continue;
    }

    entriesById.set(normalizeWalletKey(nextEntry.id), nextEntry);
    orderedEntries.push(nextEntry);
  }

  const aliasRowsByCanonicalId = new Map<string, WalletAliasRow[]>();
  for (const row of aliasRows) {
    const canonicalId = normalizeWalletKey(row.canonical_id);
    if (!canonicalId) {
      continue;
    }
    const bucket = aliasRowsByCanonicalId.get(canonicalId) ?? [];
    bucket.push(row);
    aliasRowsByCanonicalId.set(canonicalId, bucket);
  }

  const mergedEntries = orderedEntries.map((entry) => {
    const mapped = entriesById.get(normalizeWalletKey(entry.id)) ?? entry;
    const aliasRowsForEntry = aliasRowsByCanonicalId.get(normalizeWalletKey(mapped.id)) ?? [];
    return mergeAliasesForEntry(mapped, aliasRowsForEntry);
  });

  loadWatchlistOverrides(overrideRows, mergedEntries);
  return refreshCuratedWalletRegistry(mergedEntries);
}

function categoryLabel(category: CuratedWalletCategory): string {
  switch (category) {
    case "exchange":
      return "거래소";
    case "market_maker":
      return "마켓메이커";
    case "fund":
      return "펀드";
    case "custody":
      return "커스터디";
    case "bridge":
      return "브리지";
    case "protocol":
      return "프로토콜";
    case "foundation":
      return "재단";
    default:
      return "미분류";
  }
}

function signalEvidenceHashes(value: string): string[] {
  const parsed = parseJsonSafe<unknown>(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => compactString(String(item)).toLowerCase())
      .filter(Boolean);
  }

  return value
    .split(/[,|\s]+/)
    .map((item) => compactString(item).toLowerCase())
    .filter(Boolean);
}

function toneForActivity(amountUsd: number, relatedSignalCount: number): WhaleStoryTone {
  if (relatedSignalCount >= 2 || amountUsd >= 1_000_000) {
    return "critical";
  }
  if (relatedSignalCount >= 1 || amountUsd >= 100_000) {
    return "watch";
  }
  if (amountUsd > 0) {
    return "positive";
  }
  return "neutral";
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "규모 미상";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value);
}

function roleFromTransaction(
  wallet: CuratedWalletEntry,
  transaction: TransactionLike,
): "from" | "to" | null {
  const address = normalizeAddress(wallet.address);
  if (address && address === normalizeAddress(transaction.from_address)) {
    return "from";
  }
  if (address && address === normalizeAddress(transaction.to_address)) {
    return "to";
  }
  return null;
}

function sortWallets(entries: CuratedWalletEntry[]): CuratedWalletEntry[] {
  return [...entries].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.label.localeCompare(right.label);
  });
}

export function listCuratedWalletEntries(): CuratedWalletEntry[] {
  return curatedWalletRegistry.map((entry) => cloneWalletEntry(entry));
}

export async function loadCuratedWalletEntries(forceRefresh = false): Promise<CuratedWalletEntry[]> {
  if (!forceRefresh && curatedWalletLoadPromise) {
    return curatedWalletLoadPromise;
  }

  const loadPromise = loadSheetBackedRegistry().catch(() => refreshCuratedWalletRegistry(curatedWalletSeed));
  curatedWalletLoadPromise = loadPromise;

  try {
    return await loadPromise;
  } finally {
    if (curatedWalletLoadPromise === loadPromise) {
      curatedWalletLoadPromise = null;
    }
  }
}

export function listEnabledCuratedWalletEntries(): CuratedWalletEntry[] {
  return listCuratedWalletEntries().filter((entry) => entry.enabled);
}

export function setCuratedWalletEnabled(
  address: string,
  enabled: boolean,
): CuratedWalletEntry | null {
  const entry = resolveRegistryEntry(address);

  if (!entry) {
    return null;
  }

  recordOverrideInMemory(entry, enabled);
  return { ...entry, enabled };
}

export async function persistCuratedWalletEnabled(
  address: string,
  enabled: boolean,
  options?: { actor?: string; reason?: string },
): Promise<CuratedWalletEntry | null> {
  await loadCuratedWalletEntries();
  const entry = resolveRegistryEntry(address);
  if (!entry) {
    return null;
  }

  recordOverrideInMemory(entry, enabled);

  try {
    await upsertWatchlistOverride({
      wallet_id: entry.id,
      enabled,
      actor: compactString(options?.actor) || "dashboard",
      reason: compactString(options?.reason) || "manual toggle",
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Keep the optimistic in-memory override so the UI contract remains stable
    // when the Sheets write path is unavailable or the tab is still absent.
  }

  return entry;
}

export function findCuratedWalletMatch(input: {
  address?: string;
  owner?: string;
  chain?: string;
  includeDisabled?: boolean;
  wallets?: readonly CuratedWalletEntry[];
}): CuratedWalletMatch | null {
  const sourceEntries = input.wallets
    ? sortWallets([...input.wallets]).filter((entry) => input.includeDisabled || entry.enabled)
    : input.includeDisabled
      ? listCuratedWalletEntries()
      : listEnabledCuratedWalletEntries();
  const entries = sourceEntries.filter((entry) => {
    if (!input.chain) {
      return true;
    }
    return normalizeText(entry.chain) === normalizeText(input.chain);
  });

  const address = normalizeAddress(input.address ?? "");
  if (address) {
    const exact = entries.find((entry) => normalizeAddress(entry.address) === address);
    if (exact) {
      return {
        walletId: exact.id,
        label: exact.label,
        category: exact.category,
        grade: exact.grade,
        priority: exact.priority,
        chain: exact.chain,
        address: exact.address,
        matchReason: "address",
      };
    }
  }

  const owner = normalizeText(input.owner);
  if (!owner) {
    return null;
  }

  const scored = entries
    .map((entry) => {
      const label = normalizeText(entry.label);
      if (label && owner === label) {
        return { entry, matchReason: "owner_label" as const, score: 0 };
      }
      if (label && owner.includes(label)) {
        return { entry, matchReason: "owner_label" as const, score: 1 };
      }

      const alias = entry.aliases?.find((candidate) => {
        const normalized = normalizeText(candidate);
        return normalized && owner.includes(normalized);
      });
      if (alias) {
        return { entry, matchReason: "alias" as const, score: 2 };
      }
      return null;
    })
    .filter(
      (
        candidate,
      ): candidate is {
        entry: CuratedWalletEntry;
        matchReason: "owner_label" | "alias";
        score: number;
      } => candidate !== null,
    )
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.entry.priority - right.entry.priority;
    })[0];

  if (!scored) {
    return null;
  }

  return {
    walletId: scored.entry.id,
    label: scored.entry.label,
    category: scored.entry.category,
    grade: scored.entry.grade,
    priority: scored.entry.priority,
    chain: scored.entry.chain,
    address: scored.entry.address,
    matchReason: scored.matchReason,
  };
}

function relatedSignalCount(
  transaction: TransactionLike,
  signals: readonly SignalLike[],
): number {
  const hash = normalizeText(transaction.hash);
  if (!hash) {
    return 0;
  }

  return signals.reduce((count, signal) => {
    return signalEvidenceHashes(signal.evidence_tx_hashes).includes(hash) ? count + 1 : count;
  }, 0);
}

function walletActivity(
  wallet: CuratedWalletEntry,
  transactions: readonly TransactionLike[],
  signals: readonly SignalLike[],
): WalletActivity {
  const matched = newestFirst(
    transactions.filter((transaction) => roleFromTransaction(wallet, transaction) !== null),
    (transaction) =>
      parseDateTimeSafe(transaction.created_at) ?? parseDateTimeSafe(transaction.timestamp),
  )[0];

  if (!matched) {
    const symbol = wallet.focusSymbols?.[0] ?? wallet.chain.toUpperCase();
    return {
      wallet,
      symbol,
      note:
        wallet.note ??
        `${categoryLabel(wallet.category)} 카테고리로 큐레이션된 주소입니다.`,
      badge: `${wallet.grade}등급 ${categoryLabel(wallet.category)}`,
      tone: "neutral",
      relatedSignalCount: 0,
      activityScore: wallet.enabled ? 10 - wallet.priority : 0,
    };
  }

  const symbol = compactString(matched.symbol).toUpperCase() || wallet.focusSymbols?.[0] || wallet.chain.toUpperCase();
  const amountUsd = parseFloatSafe(compactString(matched.amount_usd)) ?? 0;
  const relatedSignals = relatedSignalCount(matched, signals);
  const role = roleFromTransaction(wallet, matched);
  const direction = role === "from" ? "출금" : "유입";
  const note = amountUsd > 0
    ? `${symbol} ${formatCompactUsd(amountUsd)} ${direction} 움직임이 최근 감지되었습니다.`
    : `${symbol} ${direction} 움직임이 최근 감지되었습니다.`;

  return {
    wallet,
    symbol,
    note,
    badge:
      relatedSignals > 0
        ? `${relatedSignals}개 관련 시그널`
        : `${wallet.grade}등급 ${categoryLabel(wallet.category)}`,
    tone: toneForActivity(amountUsd, relatedSignals),
    lastSeenAt: compactString(matched.timestamp) || compactString(matched.created_at) || undefined,
    relatedSignalCount: relatedSignals,
    activityScore:
      (wallet.enabled ? 100 : 0) +
      Math.min(relatedSignals * 10, 30) +
      Math.min(amountUsd / 100_000, 50) -
      wallet.priority,
  };
}

export function buildCuratedWatchlistItems(options?: {
  wallets?: CuratedWalletEntry[];
  recentTransactions?: readonly TransactionLike[];
  recentSignals?: readonly SignalLike[];
  maxItems?: number;
}): CuratedWatchlistItem[] {
  const wallets = options?.wallets ?? listEnabledCuratedWalletEntries();
  const transactions = options?.recentTransactions ?? [];
  const signals = options?.recentSignals ?? [];
  const maxItems = options?.maxItems ?? 4;

  return wallets
    .map((wallet) => walletActivity(wallet, transactions, signals))
    .sort((left, right) => {
      if (left.activityScore !== right.activityScore) {
        return right.activityScore - left.activityScore;
      }
      return left.wallet.priority - right.wallet.priority;
    })
    .slice(0, maxItems)
    .map((activity) => ({
      id: activity.wallet.id,
      symbol: activity.symbol,
      title: activity.wallet.label,
      note: activity.note,
      badge: activity.badge,
      address: activity.wallet.address,
      chain: activity.wallet.chain,
      enabled: activity.wallet.enabled,
      category: activity.wallet.category,
      grade: activity.wallet.grade,
      priority: activity.wallet.priority,
      tone: activity.tone,
      lastSeenAt: activity.lastSeenAt,
      relatedSignalCount: activity.relatedSignalCount,
    }));
}

export function toLegacyWatchlistEntries(
  wallets: readonly CuratedWalletEntry[] = listCuratedWalletEntries(),
): Array<{
  address: string;
  chain: string;
  label: string;
  enabled: boolean;
}> {
  return wallets.map((wallet) => ({
    address: wallet.address,
    chain: wallet.chain,
    label: wallet.label,
    enabled: wallet.enabled,
  }));
}
