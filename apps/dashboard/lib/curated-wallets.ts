import {
  compactString,
  newestFirst,
  parseDateTimeSafe,
  parseFloatSafe,
  parseJsonSafe,
} from "./format";
import type { SignalRow, TransactionRow } from "./schema";
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

function normalizeAddress(value: string): string {
  return compactString(value).toLowerCase();
}

function normalizeText(value?: string): string {
  return compactString(value).toLowerCase();
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

function applyOverride(entry: CuratedWalletEntry): CuratedWalletEntry {
  const override = watchlistOverrides.get(normalizeAddress(entry.address));
  return override === undefined ? entry : { ...entry, enabled: override };
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
  return sortWallets(curatedWalletSeed.map(applyOverride));
}

export function listEnabledCuratedWalletEntries(): CuratedWalletEntry[] {
  return listCuratedWalletEntries().filter((entry) => entry.enabled);
}

export function setCuratedWalletEnabled(
  address: string,
  enabled: boolean,
): CuratedWalletEntry | null {
  const normalized = normalizeAddress(address);
  const entry = curatedWalletSeed.find(
    (candidate) => normalizeAddress(candidate.address) === normalized,
  );

  if (!entry) {
    return null;
  }

  watchlistOverrides.set(normalized, enabled);
  return { ...entry, enabled };
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
