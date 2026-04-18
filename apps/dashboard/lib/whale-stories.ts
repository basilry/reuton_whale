import {
  compactString,
  newestFirst,
  parseDateTimeSafe,
  parseFloatSafe,
  parseJsonSafe,
} from "./format";
import { findCuratedWalletMatch, listCuratedWalletEntries } from "./curated-wallets";
import type { SignalRow, TransactionRow } from "./schema";
import type {
  CuratedWalletEntry,
  CuratedWalletMatch,
  WhaleStory,
  WhaleStoryParticipant,
  WhaleStoryTone,
} from "./types";

type TransactionLike = Pick<
  TransactionRow,
  | "hash"
  | "symbol"
  | "amount"
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
  "signal_id" | "created_at" | "rule" | "severity" | "score" | "evidence_tx_hashes" | "summary"
>;

type BriefLike = {
  summary?: string;
  date?: string;
};

type StoryCard = Pick<WhaleStory, "title" | "body" | "meta" | "hash" | "tone">;

function normalizeText(value?: string): string {
  return compactString(value).toLowerCase();
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

function formatDateTime(value?: string): string {
  if (!value) {
    return "시간 미상";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function truncate(value?: string): string {
  const text = compactString(value);
  if (!text) {
    return "미확인 주소";
  }
  if (text.length <= 14) {
    return text;
  }
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function chainLabel(value?: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Unknown";
  }
  if (normalized === "ethereum" || normalized === "eth") {
    return "Ethereum";
  }
  if (normalized === "solana" || normalized === "sol") {
    return "Solana";
  }
  if (normalized === "bitcoin" || normalized === "btc") {
    return "Bitcoin";
  }
  return compactString(value);
}

function humanizeRule(rule: string): string {
  const normalized = normalizeText(rule);
  const labels: Record<string, string> = {
    cex_inflow_spike: "거래소 유입 급증",
    cex_outflow_spike: "거래소 유출 급증",
    smart_money_accumulation: "스마트머니 매집",
    cold_to_hot_transfer: "보관 지갑에서 활동 지갑 이동",
    corroborated_move: "온체인과 채널에서 함께 확인된 이동",
    whale_cluster_move: "고래 군집 이동",
    tg_cex_inflow_burst: "텔레그램과 거래소 유입 동시 감지",
  };

  return labels[normalized] ?? compactString(rule).replace(/[_-]+/g, " ");
}

function toneForSignal(signal: SignalLike | null): WhaleStoryTone {
  if (!signal) {
    return "neutral";
  }

  const severity = normalizeText(signal.severity);
  const score = parseFloatSafe(compactString(signal.score)) ?? 0;
  const rule = normalizeText(signal.rule);

  if (severity.includes("critical") || severity.includes("high") || score >= 80) {
    return "critical";
  }
  if (severity.includes("medium") || score >= 50) {
    return "watch";
  }
  if (rule.includes("outflow") || rule.includes("accum")) {
    return "positive";
  }
  return "neutral";
}

function toneForTransaction(amountUsd: number, signal: SignalLike | null): WhaleStoryTone {
  if (signal) {
    return toneForSignal(signal);
  }
  if (amountUsd >= 1_000_000) {
    return "critical";
  }
  if (amountUsd >= 100_000) {
    return "watch";
  }
  if (amountUsd > 0) {
    return "positive";
  }
  return "neutral";
}

function participantLabel(
  owner: string,
  address: string,
  curatedMatch: CuratedWalletMatch | null,
): string {
  if (curatedMatch) {
    return curatedMatch.label;
  }

  const ownerText = compactString(owner);
  if (ownerText && ownerText.toLowerCase() !== "unknown") {
    return ownerText;
  }

  return `지갑 ${truncate(address)}`;
}

function participant(
  role: "from" | "to",
  owner: string,
  address: string,
  chain: string,
  wallets?: readonly CuratedWalletEntry[],
): WhaleStoryParticipant {
  const curatedMatch = findCuratedWalletMatch({
    address,
    owner,
    chain,
    includeDisabled: true,
    wallets,
  });

  return {
    role,
    label: participantLabel(owner, address, curatedMatch),
    address: compactString(address) || undefined,
    curatedWallet: curatedMatch ?? undefined,
  };
}

function relatedSignalsByHash(signals: readonly SignalLike[]): Map<string, SignalLike[]> {
  const map = new Map<string, SignalLike[]>();

  signals.forEach((signal) => {
    signalEvidenceHashes(signal.evidence_tx_hashes).forEach((hash) => {
      const bucket = map.get(hash) ?? [];
      bucket.push(signal);
      map.set(hash, bucket);
    });
  });

  return map;
}

function storyPriority(amountUsd: number, signal: SignalLike | null, curatedHits: number): number {
  const base = Math.min(Math.round(amountUsd / 100_000), 10);
  const signalWeight = signal ? 10 : 0;
  return base + signalWeight + curatedHits * 3;
}

function topSignal(signals: readonly SignalLike[]): SignalLike | null {
  return (
    [...signals].sort((left, right) => {
      const leftScore = parseFloatSafe(compactString(left.score)) ?? 0;
      const rightScore = parseFloatSafe(compactString(right.score)) ?? 0;
      return rightScore - leftScore;
    })[0] ?? null
  );
}

function buildTransactionStory(
  transaction: TransactionLike,
  relatedSignals: readonly SignalLike[],
  generatedAt: string,
  curatedWallets?: readonly CuratedWalletEntry[],
): WhaleStory {
  const symbol = compactString(transaction.symbol).toUpperCase() || "UNKNOWN";
  const amountUsd = parseFloatSafe(compactString(transaction.amount_usd)) ?? 0;
  const fromParticipant = participant(
    "from",
    transaction.from_owner,
    transaction.from_address,
    transaction.blockchain,
    curatedWallets,
  );
  const toParticipant = participant(
    "to",
    transaction.to_owner,
    transaction.to_address,
    transaction.blockchain,
    curatedWallets,
  );
  const signal = topSignal(relatedSignals);
  const curatedParticipants = [fromParticipant, toParticipant].filter(
    (item) => item.curatedWallet,
  );
  const featuredLabel =
    curatedParticipants[0]?.label ?? fromParticipant.label;
  const title = `${featuredLabel} ${symbol} 이동`;
  const signalSummary = signal ? humanizeRule(signal.rule) : "";
  const bodyBase = `${fromParticipant.label}에서 ${toParticipant.label}로 ${
    amountUsd > 0 ? `${formatCompactUsd(amountUsd)} 규모의 ${symbol}` : symbol
  } 이동이 기록됐습니다.`;
  const body = signalSummary
    ? `${bodyBase} ${signalSummary} 신호와 함께 읽을 수 있습니다.`
    : bodyBase;
  const occurredAt =
    compactString(transaction.timestamp) ||
    compactString(transaction.created_at) ||
    generatedAt;
  const metaParts = [
    chainLabel(transaction.blockchain),
    formatDateTime(occurredAt),
    curatedParticipants.length > 0 ? `${curatedParticipants.length}개 큐레이션 주소 연관` : "",
  ].filter(Boolean);

  return {
    id: compactString(transaction.hash) || `${symbol}-${occurredAt}`,
    kind: "transaction",
    title,
    body,
    meta: metaParts.join(" · "),
    tone: toneForTransaction(amountUsd, signal),
    hash: compactString(transaction.hash) || undefined,
    symbol,
    chain: compactString(transaction.blockchain) || undefined,
    occurredAt,
    priority: storyPriority(amountUsd, signal, curatedParticipants.length),
    supportingSignalIds: relatedSignals.map((item) => compactString(item.signal_id)).filter(Boolean),
    participants: [fromParticipant, toParticipant],
  };
}

function buildSignalStory(signal: SignalLike): WhaleStory {
  const label = humanizeRule(signal.rule);
  return {
    id: compactString(signal.signal_id) || `${label}-${compactString(signal.created_at)}`,
    kind: "signal",
    title: `${label} 포착`,
    body:
      compactString(signal.summary) ||
      `${label} 신호가 감지되었습니다. 아직 연결된 거래 근거는 적지만 후속 움직임을 지켜볼 필요가 있습니다.`,
    meta: formatDateTime(compactString(signal.created_at) || undefined),
    tone: toneForSignal(signal),
    occurredAt: compactString(signal.created_at) || undefined,
    priority: 5,
    supportingSignalIds: [compactString(signal.signal_id)].filter(Boolean),
    participants: [],
  };
}

function buildBriefFallbackStory(brief: BriefLike | null): WhaleStory | null {
  const summary = compactString(brief?.summary);
  if (!summary) {
    return null;
  }

  return {
    id: `brief-${compactString(brief?.date) || "latest"}`,
    kind: "brief",
    title: "오늘의 브리핑 요약",
    body: summary,
    meta: compactString(brief?.date) || "최신 브리핑",
    tone: "neutral",
    occurredAt: compactString(brief?.date) || undefined,
    priority: 1,
    supportingSignalIds: [],
    participants: [],
  };
}

export function buildWhaleStories(options?: {
  recentTransactions?: readonly TransactionLike[];
  recentSignals?: readonly SignalLike[];
  latestBrief?: BriefLike | null;
  generatedAt?: string;
  maxItems?: number;
  curatedWallets?: readonly CuratedWalletEntry[];
}): WhaleStory[] {
  const transactions = newestFirst(
    [...(options?.recentTransactions ?? [])],
    (transaction) =>
      parseDateTimeSafe(transaction.created_at) ?? parseDateTimeSafe(transaction.timestamp),
  );
  const signals = newestFirst(
    [...(options?.recentSignals ?? [])],
    (signal) => parseDateTimeSafe(signal.created_at),
  );
  const generatedAt = compactString(options?.generatedAt) || new Date().toISOString();
  const maxItems = options?.maxItems ?? 4;
  const curatedWallets = options?.curatedWallets ?? listCuratedWalletEntries();

  const signalsByHash = relatedSignalsByHash(signals);
  const transactionStories = transactions.map((transaction) =>
    buildTransactionStory(
      transaction,
      signalsByHash.get(normalizeText(transaction.hash)) ?? [],
      generatedAt,
      curatedWallets,
    ),
  );

  if (transactionStories.length > 0) {
    return transactionStories
      .sort((left, right) => right.priority - left.priority)
      .slice(0, maxItems);
  }

  if (signals.length > 0) {
    return signals.slice(0, maxItems).map(buildSignalStory);
  }

  const briefStory = buildBriefFallbackStory(options?.latestBrief ?? null);
  if (briefStory) {
    return [briefStory];
  }

  return [
    {
      id: "whale-story-empty",
      kind: "empty",
      title: "아직 기록된 고래 스토리가 없습니다.",
      body:
        "정보수집 파이프라인이 실행되면, 최근 거래와 시그널을 기반으로 사람이 읽기 쉬운 고래 스토리가 여기에 생성됩니다.",
      meta: "실행 대기",
      tone: "neutral",
      priority: 0,
      supportingSignalIds: [],
      participants: [],
    },
  ];
}

export function buildWhaleStoryCards(stories: readonly WhaleStory[]): StoryCard[] {
  return stories.map((story) => ({
    title: story.title,
    body: story.body,
    meta: story.meta,
    hash: story.hash,
    tone: story.tone,
  }));
}
