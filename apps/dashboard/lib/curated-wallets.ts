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
  WatchedAddressRow,
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

export type CuratedWalletRegistrySource =
  | "curated_wallets"
  | "watched_addresses"
  | "seed"
  | "empty";

export type CuratedWalletRegistryMeta = {
  source: CuratedWalletRegistrySource;
  label: string;
  rowCount: number;
  aliasCount: number;
  overrideCount: number;
  seedEnabled: boolean;
};

type CuratedWalletRowExtended = CuratedWalletRow & {
  entity_id?: string;
  is_representative?: string;
  narrative_tags?: string;
  display_priority?: string;
};

type CuratedNoteBucket = "idle" | "active" | "critical";

const WALLET_CATEGORY_WEIGHT: Record<CuratedWalletCategory, number> = {
  celebrity: 0,
  founder: 1,
  protocol_treasury: 2,
  fund: 3,
  foundation: 4,
  protocol: 5,
  market_maker: 6,
  custody: 7,
  exchange: 8,
  bridge: 9,
  unknown: 10,
};

const CURATED_NOTE_POOL: Record<CuratedNoteBucket, string[]> = {
  idle: [
    "오늘은 비교적 조용하지만, 움직임 하나로 시장 서사가 바뀔 수 있는 지갑입니다.",
    "현재는 관망 구간이지만 보유 성격 자체가 심리적 기준점으로 작동합니다.",
    "직접적인 거래가 없어도 내러티브 추적용 기준선으로 유지할 가치가 있습니다.",
    "변동이 적은 날에도 뉴스와 연결해 함께 확인해야 하는 큐레이션 지갑입니다.",
    "최근 대형 이동은 없지만, 다시 움직이면 해석 우선순위가 바로 올라갑니다.",
    "시장 참여자들이 꾸준히 관찰하는 대표 지갑으로 watchlist에 유지 중입니다.",
    "조용한 구간일수록 다음 이동의 맥락을 준비해 두기 좋은 대상입니다.",
  ],
  active: [
    "최근 흐름이 다시 살아나면서 시장 심리와 연결해 볼 가치가 커졌습니다.",
    "이 지갑의 자금 이동이 관련 프로젝트 뉴스 사이클과 맞물리는 구간입니다.",
    "평소 대비 활동성이 올라와 해석 우선순위를 한 단계 높여 봐야 합니다.",
    "연결된 주소 또는 토큰 흐름과 함께 읽으면 맥락이 더 선명해집니다.",
    "최근 움직임이 단발성인지 포지션 재편인지 계속 추적할 필요가 있습니다.",
    "시장 참가자 시선이 다시 모일 수 있는 활동 구간으로 판단합니다.",
    "현재 관측된 흐름이 내러티브 재점화 신호인지 확인 중입니다.",
  ],
  critical: [
    "오늘 브리핑에서 우선 확인해야 할 상위 고래 활동 축에 들어갑니다.",
    "최근 감지된 대형 이동이 단기 변동성에 직접 영향을 줄 수 있는 수준입니다.",
    "동일 주체의 관련 주소 흐름까지 함께 보면 의미 있는 재배치 가능성이 큽니다.",
    "이번 움직임은 시장 해석을 바꿀 수 있어 긴급 모니터링 대상으로 올립니다.",
    "뉴스와 온체인 신호가 한 지점으로 겹치는 보기 드문 활동 구간입니다.",
    "단순 잡음으로 보기 어려운 강도의 움직임이어서 맥락 점검이 필요합니다.",
    "현재 변동성의 배경 설명에 직접 들어갈 정도로 존재감이 큰 활동입니다.",
  ],
};

const curatedWalletSeed: CuratedWalletEntry[] = [
  {
    id: "trump-personal-eth",
    address: "0x94845333028b1204fbe14e1278fd4adde46b22ce",
    chain: "ethereum",
    label: "Donald Trump (Personal)",
    category: "celebrity",
    grade: "A",
    priority: 1,
    displayPriority: 120,
    enabled: true,
    entityId: "donald-trump",
    isRepresentative: true,
    aliases: ["donald trump", "trump", "trump wallet", "trump personal"],
    narrativeTags: ["us-politics", "memecoin", "public-figure"],
    note: "전직 대통령의 공개 개인 지갑으로, 뉴스 사이클과 밈코인 심리가 함께 붙는 대표 관측 대상입니다.",
    focusSymbols: ["ETH", "TRUMP", "WETH"],
  },
  {
    id: "vitalik-main-eth",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    chain: "ethereum",
    label: "Vitalik Buterin",
    category: "founder",
    grade: "A",
    priority: 3,
    displayPriority: 112,
    enabled: true,
    entityId: "vitalik-buterin",
    isRepresentative: true,
    aliases: ["vitalik", "vitalik buterin", "vitalik main"],
    narrativeTags: ["founder", "ethereum", "philanthropy"],
    note: "Ethereum 공동 창립자의 대표 주소로, 연구비 집행과 공공재 기부 흐름을 해석할 때 기준점이 됩니다.",
    focusSymbols: ["ETH", "USDC"],
  },
  {
    id: "vitalik-secondary-eth",
    address: "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
    chain: "ethereum",
    label: "Vitalik Buterin (vitalik.eth)",
    category: "founder",
    grade: "B",
    priority: 5,
    displayPriority: 104,
    enabled: true,
    entityId: "vitalik-buterin",
    isRepresentative: false,
    aliases: ["vitalik eth", "vitalik ens", "vitalik secondary"],
    narrativeTags: ["founder", "ethereum", "ens"],
    note: "Vitalik ENS 매핑 주소로, 대표 주소와 함께 보면 이더리움 생태계 자금 재배치 맥락이 드러납니다.",
    focusSymbols: ["ETH"],
  },
  {
    id: "vitalik-donation-eth",
    address: "0x1Db3439a222C519ab44bb1144fC28167b4Fa6EE6",
    chain: "ethereum",
    label: "Vitalik Buterin (Donation Wallet)",
    category: "founder",
    grade: "B",
    priority: 6,
    displayPriority: 102,
    enabled: true,
    entityId: "vitalik-buterin",
    isRepresentative: false,
    aliases: ["vitalik donation", "vitalik 3", "vitalik grants"],
    narrativeTags: ["founder", "ethereum", "grants", "philanthropy"],
    note: "Vitalik 연관 기부·지원금 집행 주소로, 대표 주소와 분리된 자금 목적성을 읽는 데 유용합니다.",
    focusSymbols: ["ETH", "USDC"],
  },
  {
    id: "justin-sun-eth",
    address: "0x176F3DAb24a159341c0509bB36B833E7fdd0a132",
    chain: "ethereum",
    label: "Justin Sun",
    category: "founder",
    grade: "A",
    priority: 4,
    displayPriority: 108,
    enabled: true,
    entityId: "justin-sun",
    isRepresentative: true,
    aliases: ["justin sun", "sun", "tron founder"],
    narrativeTags: ["tron", "wlfi-investor", "multi-chain"],
    note: "TRON 창립자이자 대형 투자자 축으로, 공격적인 멀티체인 이동이 뉴스와 시장 심리에 빠르게 반영됩니다.",
    focusSymbols: ["ETH", "TRX", "USDT"],
  },
  {
    id: "justin-sun-tron",
    address: "TTm3QKKu7dcmm6g2J3Fvb7rGcmz9ACtCqU",
    chain: "tron",
    label: "Justin Sun (Tron HD Wallet)",
    category: "founder",
    grade: "A",
    priority: 7,
    displayPriority: 100,
    enabled: true,
    entityId: "justin-sun",
    isRepresentative: false,
    aliases: ["justin sun tron", "trx whale", "tron hd wallet"],
    narrativeTags: ["tron", "trx", "multi-chain"],
    note: "TRON 체인 쪽 대표 관측 주소로, 스테이블 이동과 프로젝트 간 자금 배치를 읽는 기준선입니다.",
    focusSymbols: ["TRX", "USDT"],
  },
  {
    id: "wlfi-treasury-eth",
    address: "0x5be9a4959308a0d0c7bc0870e319314d8d957dbb",
    chain: "ethereum",
    label: "World Liberty Financial (Treasury Multisig)",
    category: "protocol_treasury",
    grade: "A",
    priority: 2,
    displayPriority: 116,
    enabled: true,
    entityId: "world-liberty-financial",
    isRepresentative: true,
    aliases: ["wlfi", "world liberty financial", "wlf treasury", "wlfi treasury"],
    narrativeTags: ["wlfi", "trump-family", "treasury"],
    note: "Trump Family가 관여한 WLFI 프로젝트의 트레저리 멀티시그로, 개인 지갑이 아닌 프로젝트 자금 흐름 관측용입니다.",
    focusSymbols: ["ETH", "USDC", "WBTC"],
  },
  {
    id: "binance-14-eth",
    address: "0x28C6c06298d514Db089934071355E5743bf21d60",
    chain: "ethereum",
    label: "Binance 14",
    category: "exchange",
    grade: "A",
    priority: 8,
    displayPriority: 88,
    enabled: true,
    entityId: "binance",
    isRepresentative: true,
    aliases: ["binance", "binance 14", "binance hot wallet"],
    narrativeTags: ["exchange-liquidity", "cex"],
    note: "거래소 유동성 이동을 비교하는 기준 주소로 남겨 둔 핵심 CEX 지갑입니다.",
    focusSymbols: ["ETH", "BTC", "USDT"],
  },
  {
    id: "binance-7-eth",
    address: "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",
    chain: "ethereum",
    label: "Binance 7",
    category: "exchange",
    grade: "A",
    priority: 9,
    displayPriority: 86,
    enabled: true,
    entityId: "binance",
    isRepresentative: false,
    aliases: ["binance 7", "binance cold", "binance reserve"],
    narrativeTags: ["exchange-liquidity", "cex", "reserve"],
    note: "거래소 보관 성격이 강한 대형 Binance 주소로, 입출금 압력과 준비금 이동을 함께 읽는 용도입니다.",
    focusSymbols: ["ETH", "BTC", "USDT"],
  },
  {
    id: "coinbase-prime-eth",
    address: "0xa9D1e08C7793af67e9d92fe308d5697FB81d3E43",
    chain: "ethereum",
    label: "Coinbase Prime",
    category: "custody",
    grade: "A",
    priority: 10,
    displayPriority: 84,
    enabled: true,
    entityId: "coinbase",
    isRepresentative: true,
    aliases: ["coinbase", "coinbase prime", "coinbase 1"],
    narrativeTags: ["custody", "cex", "prime-brokerage"],
    note: "기관 수탁 성격이 강한 Coinbase Prime 주소로, ETF·기관 자금 재배치를 읽는 기준점 역할을 합니다.",
    focusSymbols: ["BTC", "ETH", "USDC"],
  },
  {
    id: "coinbase-2-eth",
    address: "0x503828976D22510aad0201ac7EC88293211D23Da",
    chain: "ethereum",
    label: "Coinbase 2",
    category: "exchange",
    grade: "A",
    priority: 11,
    displayPriority: 82,
    enabled: true,
    entityId: "coinbase",
    isRepresentative: false,
    aliases: ["coinbase 2", "coinbase hot wallet"],
    narrativeTags: ["exchange-liquidity", "cex"],
    note: "보다 실무적인 입출금 흐름이 자주 잡히는 Coinbase 측 주소로, Prime 주소와 함께 봐야 맥락이 완성됩니다.",
    focusSymbols: ["BTC", "ETH", "USDC"],
  },
  {
    id: "robinhood-1-eth",
    address: "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
    chain: "ethereum",
    label: "Robinhood 1",
    category: "custody",
    grade: "B",
    priority: 12,
    displayPriority: 78,
    enabled: true,
    entityId: "robinhood",
    isRepresentative: true,
    aliases: ["robinhood", "robinhood 1", "robinhood wallet"],
    narrativeTags: ["retail-flow", "custody", "cex"],
    note: "리테일 유동성 흐름을 읽는 기준 주소로, 개인 투자자 심리와 거래소 흐름을 연결해 보기 좋습니다.",
    focusSymbols: ["BTC", "ETH", "DOGE"],
  },
  {
    id: "kraken-1-eth",
    address: "0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2",
    chain: "ethereum",
    label: "Kraken 1",
    category: "exchange",
    grade: "A",
    priority: 13,
    displayPriority: 76,
    enabled: true,
    entityId: "kraken",
    isRepresentative: true,
    aliases: ["kraken", "kraken 1", "kraken exchange"],
    narrativeTags: ["exchange-liquidity", "cex"],
    note: "달러권 거래소 유동성 비교에 자주 쓰이는 Kraken 대표 주소로, Binance·Coinbase와 교차 비교하기 좋습니다.",
    focusSymbols: ["BTC", "ETH", "USDT"],
  },
  {
    id: "bitfinex-cold-btc",
    address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    chain: "bitcoin",
    label: "Bitfinex cold wallet",
    category: "custody",
    grade: "A",
    priority: 14,
    displayPriority: 74,
    enabled: true,
    entityId: "bitfinex",
    isRepresentative: true,
    aliases: ["bitfinex", "bitfinex cold wallet", "cold wallet"],
    narrativeTags: ["custody", "btc-reserve"],
    note: "장기 보관 성격이 강해 대규모 출금이나 재배치 신호를 읽을 때 비교 기준으로 쓰기 좋습니다.",
    focusSymbols: ["BTC"],
  },
  {
    id: "bitfinex-cold-eth",
    address: "0x742d35Cc6634C0532925a3b8D4C9C8b97Bb3a4BF",
    chain: "ethereum",
    label: "Bitfinex cold wallet (ETH)",
    category: "custody",
    grade: "A",
    priority: 15,
    displayPriority: 72,
    enabled: true,
    entityId: "bitfinex",
    isRepresentative: false,
    aliases: ["bitfinex eth", "bitfinex 2", "bitfinex cold eth"],
    narrativeTags: ["custody", "eth-reserve", "cex"],
    note: "이더리움 쪽 준비금 흐름을 읽는 Bitfinex 보조 기준 주소로, BTC cold wallet과 함께 보면 자산별 리밸런싱이 드러납니다.",
    focusSymbols: ["ETH", "USDT"],
  },
  {
    id: "wintermute-eth",
    address: "0xFE674a9682F6D9B5D0D5e62613aB22D3C50f3af3",
    chain: "ethereum",
    label: "Wintermute",
    category: "market_maker",
    grade: "A",
    priority: 16,
    displayPriority: 70,
    enabled: true,
    entityId: "wintermute",
    isRepresentative: true,
    aliases: ["wintermute", "wintermute trading", "wintermute market maker"],
    narrativeTags: ["market-maker", "liquidity", "otc"],
    note: "메이커 유동성 공급 재배치를 읽는 대표 주소로, 거래소 입출금과 함께 보면 체결 압력의 배경 설명이 좋아집니다.",
    focusSymbols: ["ETH", "USDC", "WBTC"],
  },
  {
    id: "jump-crypto-eth",
    address: "0x4862733B5FdDFd35f35ea8CCf08F5045e57388B3",
    chain: "ethereum",
    label: "Jump Crypto",
    category: "market_maker",
    grade: "A",
    priority: 17,
    displayPriority: 68,
    enabled: true,
    entityId: "jump-crypto",
    isRepresentative: true,
    aliases: ["jump", "jump crypto", "jump trading"],
    narrativeTags: ["market-maker", "trading-firm", "liquidity"],
    note: "대형 트레이딩 하우스 계열 주소로, 시장 급변 시 유동성 방어 또는 회수의 흔적을 포착하는 데 유효합니다.",
    focusSymbols: ["ETH", "BTC", "USDC"],
  },
  {
    id: "arbitrum-bridge-eth",
    address: "0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a",
    chain: "ethereum",
    label: "Arbitrum Bridge",
    category: "bridge",
    grade: "A",
    priority: 18,
    displayPriority: 64,
    enabled: true,
    entityId: "arbitrum-bridge",
    isRepresentative: true,
    aliases: ["arbitrum bridge", "arbitrum l1 bridge"],
    narrativeTags: ["bridge", "layer2", "cross-chain"],
    note: "Arbitrum 쪽 체인 이동을 읽는 대표 브리지 주소로, L1-L2 자금 이동이 커질 때 가장 먼저 확인할 대상입니다.",
    focusSymbols: ["ETH", "ARB"],
  },
  {
    id: "base-portal-eth",
    address: "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e",
    chain: "ethereum",
    label: "Base Portal",
    category: "bridge",
    grade: "A",
    priority: 19,
    displayPriority: 62,
    enabled: true,
    entityId: "base-portal",
    isRepresentative: true,
    aliases: ["base portal", "base bridge", "base optimism portal"],
    narrativeTags: ["bridge", "layer2", "cross-chain", "coinbase-ecosystem"],
    note: "Base 생태계 유입·유출을 읽는 핵심 포털 주소로, Coinbase 흐름과 묶어서 보면 해석력이 높아집니다.",
    focusSymbols: ["ETH", "USDC"],
  },
  {
    id: "optimism-portal-eth",
    address: "0xbEb5Fc579115071764c7423A4f12eDde41f106Ed",
    chain: "ethereum",
    label: "Optimism Portal",
    category: "bridge",
    grade: "A",
    priority: 20,
    displayPriority: 60,
    enabled: true,
    entityId: "optimism-bridge",
    isRepresentative: true,
    aliases: ["optimism portal", "optimism bridge", "op portal"],
    narrativeTags: ["bridge", "layer2", "cross-chain", "optimism"],
    note: "Optimism 네트워크로 이동하는 자금 흐름을 읽는 대표 포털 주소로, 브리지 수요와 리스크 전이를 함께 관찰합니다.",
    focusSymbols: ["ETH", "OP"],
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
let curatedWalletRegistryMeta: CuratedWalletRegistryMeta = {
  source: "seed",
  label: "seed",
  rowCount: curatedWalletSeed.length,
  aliasCount: 0,
  overrideCount: 0,
  seedEnabled: true,
};

function normalizeAddress(value: string): string {
  return compactString(value).toLowerCase();
}

function normalizeText(value?: string): string {
  return compactString(value).toLowerCase();
}

function normalizeWalletKey(value: string): string {
  return normalizeAddress(value);
}

function slugifyText(value: string): string {
  return compactString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNarrativeTag(value: string): string {
  return slugifyText(value);
}

function cloneWalletEntry(entry: CuratedWalletEntry): CuratedWalletEntry {
  return {
    ...entry,
    aliases: entry.aliases ? [...entry.aliases] : undefined,
    narrativeTags: entry.narrativeTags ? [...entry.narrativeTags] : undefined,
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

function parseNarrativeTags(
  value?: string,
  fallback?: readonly string[],
): string[] | undefined {
  const raw = compactString(value);
  const parsed = raw ? parseJsonSafe<unknown>(raw) : null;
  const parsedValues = Array.isArray(parsed)
    ? parsed
        .map((item) => normalizeNarrativeTag(String(item)))
        .filter(Boolean)
    : raw
      ? raw
          .split(/[,\n|]+/)
          .map((item) => normalizeNarrativeTag(item))
          .filter(Boolean)
      : [];
  const merged = [...(fallback ?? []), ...parsedValues]
    .map((item) => normalizeNarrativeTag(item))
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
  return merged.length > 0 ? merged : undefined;
}

function walletCategoryWeight(category: CuratedWalletCategory): number {
  return WALLET_CATEGORY_WEIGHT[category] ?? WALLET_CATEGORY_WEIGHT.unknown;
}

function walletDisplayPriorityValue(entry: CuratedWalletEntry): number {
  return Number.isFinite(entry.displayPriority)
    ? entry.displayPriority ?? Number.NEGATIVE_INFINITY
    : Number.NEGATIVE_INFINITY;
}

function walletDisplayPriorityBoost(entry: CuratedWalletEntry): number {
  if (Number.isFinite(entry.displayPriority)) {
    return Math.min(Math.round((entry.displayPriority ?? 0) / 4), 30);
  }
  return Math.max(0, 12 - entry.priority);
}

function compareWalletSortOrder(left: CuratedWalletEntry, right: CuratedWalletEntry): number {
  if (left.enabled !== right.enabled) {
    return left.enabled ? -1 : 1;
  }

  const leftDisplayPriority = walletDisplayPriorityValue(left);
  const rightDisplayPriority = walletDisplayPriorityValue(right);
  if (leftDisplayPriority !== rightDisplayPriority) {
    return rightDisplayPriority - leftDisplayPriority;
  }

  const categoryDiff =
    walletCategoryWeight(left.category) - walletCategoryWeight(right.category);
  if (categoryDiff !== 0) {
    return categoryDiff;
  }

  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  return left.label.localeCompare(right.label);
}

function seedFallbackEnabled(): boolean {
  return !["1", "true", "yes", "on"].includes(
    normalizeText(process.env.WHALESCOPE_CURATED_DISABLE_SEED),
  );
}

function ownerCategoryFromSheet(
  value: string,
  fallback: CuratedWalletCategory,
): CuratedWalletCategory {
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
    case "protocol_treasury":
    case "treasury":
      return "protocol_treasury";
    case "foundation":
      return "foundation";
    case "founder":
      return "founder";
    case "celebrity":
      return "celebrity";
    case "unknown":
      return "unknown";
    default:
      return fallback;
  }
}

function gradeFromTier(
  value: string,
  fallback: CuratedWalletEntry["grade"],
): CuratedWalletEntry["grade"] {
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
  return override === undefined
    ? cloneWalletEntry(entry)
    : { ...cloneWalletEntry(entry), enabled: override };
}

function updateCuratedWalletRegistryMeta(
  nextMeta: Partial<CuratedWalletRegistryMeta> & Pick<CuratedWalletRegistryMeta, "source">,
): void {
  curatedWalletRegistryMeta = {
    source: nextMeta.source,
    label: nextMeta.label ?? nextMeta.source,
    rowCount: nextMeta.rowCount ?? 0,
    aliasCount: nextMeta.aliasCount ?? 0,
    overrideCount: nextMeta.overrideCount ?? 0,
    seedEnabled: nextMeta.seedEnabled ?? seedFallbackEnabled(),
  };
}

function refreshCuratedWalletRegistry(
  baseEntries: CuratedWalletEntry[],
  meta?: Partial<CuratedWalletRegistryMeta> & Pick<CuratedWalletRegistryMeta, "source">,
): CuratedWalletEntry[] {
  curatedWalletBaseRegistry = baseEntries.map((entry) => cloneWalletEntry(entry));
  curatedWalletRegistry = sortWallets(
    curatedWalletBaseRegistry.map((entry) => applyOverride(entry)),
  );
  if (meta) {
    updateCuratedWalletRegistryMeta({
      rowCount: curatedWalletBaseRegistry.length,
      ...meta,
    });
  }
  return curatedWalletRegistry;
}

function recordOverrideInMemory(entry: CuratedWalletEntry, enabled: boolean): void {
  watchlistOverrides.set(normalizeWalletKey(entry.id), enabled);
  watchlistOverrides.set(normalizeWalletKey(entry.address), enabled);
  curatedWalletRegistry = sortWallets(
    curatedWalletBaseRegistry.map((wallet) => applyOverride(wallet)),
  );
}

function resolveRegistryEntry(addressOrId: string): CuratedWalletEntry | null {
  const normalized = normalizeWalletKey(addressOrId);
  if (!normalized) {
    return null;
  }

  return (
    curatedWalletRegistry.find(
      (entry) =>
        normalizeWalletKey(entry.id) === normalized ||
        normalizeWalletKey(entry.address) === normalized,
    ) ?? null
  );
}

function walletFromSheetRow(
  row: CuratedWalletRow,
  index: number,
  fallback?: CuratedWalletEntry,
): CuratedWalletEntry {
  const extendedRow = row as CuratedWalletRowExtended;
  const fallbackCategory = fallback?.category ?? "unknown";
  const fallbackGrade = fallback?.grade ?? "C";
  const fallbackPriority = fallback?.priority ?? index + 1;
  const id = compactString(row.id) || fallback?.id || `wallet-${index + 1}`;
  const address = compactString(row.address) || fallback?.address || id;
  const label = compactString(row.owner_label) || fallback?.label || id;
  const category = ownerCategoryFromSheet(row.owner_category, fallbackCategory);
  const grade = gradeFromTier(row.tier, fallbackGrade);
  const priority = fallbackPriority;
  const displayPriority =
    parseIntSafe(compactString(extendedRow.display_priority)) ?? fallback?.displayPriority;
  const enabled = parseLooseBoolean(row.is_active, fallback?.enabled ?? true);
  const aliases = dedupeStrings([
    ...(fallback?.aliases ?? []),
    compactString(row.owner_label),
  ]);
  const note = compactString(row.note) || fallback?.note;
  const focusSymbols = fallback?.focusSymbols ? [...fallback.focusSymbols] : undefined;
  const entityId = compactString(extendedRow.entity_id) || fallback?.entityId;
  const isRepresentative = entityId
    ? compactString(extendedRow.is_representative)
      ? parseLooseBoolean(
          extendedRow.is_representative ?? "",
          fallback?.isRepresentative ?? true,
        )
      : fallback?.isRepresentative ?? true
    : fallback?.isRepresentative;
  const narrativeTags = parseNarrativeTags(
    compactString(extendedRow.narrative_tags),
    fallback?.narrativeTags,
  );

  return {
    id,
    address,
    chain: compactString(row.chain) || fallback?.chain || "unknown",
    label,
    category,
    grade,
    priority: Number.isFinite(priority) ? priority : fallbackPriority,
    displayPriority,
    enabled,
    entityId,
    isRepresentative,
    narrativeTags,
    aliases,
    note,
    focusSymbols,
  };
}

function ownerCategoryFromLegacyWatchedAddress(value: string): CuratedWalletCategory {
  switch (normalizeText(value)) {
    case "cex":
    case "exchange":
      return "exchange";
    case "market_maker":
      return "market_maker";
    case "fund":
    case "smart_money":
      return "fund";
    case "custody":
      return "custody";
    case "bridge":
      return "bridge";
    case "protocol":
    case "token_whale":
      return "protocol";
    case "protocol_treasury":
    case "treasury":
      return "protocol_treasury";
    case "foundation":
      return "foundation";
    case "founder":
      return "founder";
    case "celebrity":
      return "celebrity";
    default:
      return "unknown";
  }
}

function gradeFromLegacyConfidence(value: string): CuratedWalletEntry["grade"] {
  switch (normalizeText(value)) {
    case "high":
      return "A";
    case "medium":
      return "B";
    case "low":
      return "C";
    default:
      return "C";
  }
}

function walletFromLegacyWatchedAddress(
  row: WatchedAddressRow,
  index: number,
): CuratedWalletEntry | null {
  const address = compactString(row.address);
  if (!address) {
    return null;
  }

  const chain = compactString(row.chain).toLowerCase() || "unknown";
  const label = compactString(row.label) || address;
  const category = ownerCategoryFromLegacyWatchedAddress(row.category);
  const enabled = parseLooseBoolean(row.enabled, true);
  const slug =
    slugifyText(label) || normalizeWalletKey(address).slice(0, 16) || `wallet-${index + 1}`;
  const addressKey =
    normalizeWalletKey(address).replace(/[^a-z0-9]/g, "").slice(0, 18) || `addr-${index + 1}`;

  return {
    id: `watched-${chain}-${slug}-${addressKey}`,
    address,
    chain,
    label,
    category,
    grade: gradeFromLegacyConfidence(row.confidence),
    priority: index + 1,
    enabled,
    aliases: dedupeStrings([label]),
    note: compactString(row.notes) || compactString(row.source) || undefined,
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
  watchlistOverrides.clear();
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

function buildRegistryFromEntries(args: {
  entries: CuratedWalletEntry[];
  aliasRows: readonly WalletAliasRow[];
  overrideRows: readonly WatchlistOverrideRow[];
  meta: Partial<CuratedWalletRegistryMeta> & Pick<CuratedWalletRegistryMeta, "source">;
}): CuratedWalletEntry[] {
  const { entries, aliasRows, overrideRows, meta } = args;
  const entriesById = new Map<string, CuratedWalletEntry>();
  const orderedEntries: CuratedWalletEntry[] = [];

  for (const entry of entries) {
    const cloned = cloneWalletEntry(entry);
    entriesById.set(normalizeWalletKey(cloned.id), cloned);
    orderedEntries.push(cloned);
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
  return refreshCuratedWalletRegistry(mergedEntries, {
    aliasCount: aliasRows.length,
    overrideCount: overrideRows.length,
    ...meta,
  });
}

function buildCuratedRegistryFromSheetRows(
  walletRows: readonly CuratedWalletRow[],
  aliasRows: readonly WalletAliasRow[],
  overrideRows: readonly WatchlistOverrideRow[],
): CuratedWalletEntry[] {
  const seedById = new Map(
    curatedWalletSeed.map((entry) => [normalizeWalletKey(entry.id), entry] as const),
  );
  const seedByAddress = new Map(
    curatedWalletSeed.map((entry) => [normalizeWalletKey(entry.address), entry] as const),
  );
  const entries = walletRows
    .map((row, index) => {
      const fallback =
        seedById.get(normalizeWalletKey(row.id)) ??
        seedByAddress.get(normalizeWalletKey(row.address));
      return walletFromSheetRow(row, index, fallback);
    })
    .filter((entry, index, items) => {
      const key = normalizeWalletKey(entry.id) || normalizeWalletKey(entry.address);
      return items.findIndex((candidate) => {
        const candidateKey =
          normalizeWalletKey(candidate.id) || normalizeWalletKey(candidate.address);
        return candidateKey === key;
      }) === index;
    });

  return buildRegistryFromEntries({
    entries,
    aliasRows,
    overrideRows,
    meta: {
      source: "curated_wallets",
      label: "curated_wallets",
      rowCount: walletRows.length,
    },
  });
}

function buildCuratedRegistryFromLegacyRows(
  watchedRows: readonly WatchedAddressRow[],
  overrideRows: readonly WatchlistOverrideRow[],
): CuratedWalletEntry[] {
  const entries = watchedRows
    .map((row, index) => walletFromLegacyWatchedAddress(row, index))
    .filter((entry): entry is CuratedWalletEntry => entry !== null);

  return buildRegistryFromEntries({
    entries,
    aliasRows: [],
    overrideRows,
    meta: {
      source: "watched_addresses",
      label: "watched_addresses (legacy)",
      rowCount: watchedRows.length,
    },
  });
}

async function loadSheetBackedRegistry(): Promise<CuratedWalletEntry[]> {
  const [walletRows, watchedRows, aliasRows, overrideRows] = await Promise.all([
    readOptionalSheetRows("curated_wallets"),
    readOptionalSheetRows("watched_addresses"),
    readOptionalSheetRows("wallet_aliases"),
    readOptionalSheetRows("watchlist_overrides"),
  ]);

  if (walletRows.length > 0) {
    return buildCuratedRegistryFromSheetRows(walletRows, aliasRows, overrideRows);
  }

  if (watchedRows.length > 0) {
    return buildCuratedRegistryFromLegacyRows(watchedRows, overrideRows);
  }

  if (!seedFallbackEnabled()) {
    loadWatchlistOverrides(overrideRows, []);
    return refreshCuratedWalletRegistry([], {
      source: "empty",
      label: "empty",
      rowCount: 0,
      aliasCount: aliasRows.length,
      overrideCount: overrideRows.length,
      seedEnabled: false,
    });
  }

  return buildRegistryFromEntries({
    entries: curatedWalletSeed,
    aliasRows: [],
    overrideRows,
    meta: {
      source: "seed",
      label: "seed",
      rowCount: curatedWalletSeed.length,
      seedEnabled: true,
    },
  });
}

function categoryLabel(category: CuratedWalletCategory): string {
  switch (category) {
    case "celebrity":
      return "셀러브리티";
    case "founder":
      return "창립자";
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
    case "protocol_treasury":
      return "프로토콜 트레저리";
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

function activityBucketFor(
  amountUsd: number,
  relatedSignalCount: number,
): CuratedNoteBucket {
  if (relatedSignalCount >= 2 || amountUsd >= 1_000_000) {
    return "critical";
  }
  if (relatedSignalCount >= 1 || amountUsd >= 100_000) {
    return "active";
  }
  return "idle";
}

function hashStringToIndex(input: string, modulo: number): number {
  if (modulo <= 0) {
    return 0;
  }

  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash % modulo;
}

function currentKstDateSeed(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year ?? "0000"}-${byType.month ?? "00"}-${byType.day ?? "00"}`;
}

function selectCuratedNote(
  wallet: CuratedWalletEntry,
  bucket: CuratedNoteBucket,
  seed = "watchlist",
): string {
  const pool = CURATED_NOTE_POOL[bucket];
  const hashInput = `${wallet.id}:${currentKstDateSeed()}:${seed}`;
  return pool[hashStringToIndex(hashInput, pool.length)] ?? pool[0] ?? "";
}

function walletNarrativeLead(wallet: CuratedWalletEntry): string {
  const tags = new Set((wallet.narrativeTags ?? []).map((item) => normalizeText(item)));
  const entityId = normalizeText(wallet.entityId);

  if (entityId === "donald-trump" || wallet.category === "celebrity" || tags.has("public-figure")) {
    return wallet.isRepresentative === false
      ? "Trump 관련 보조 주소로, 대표 개인 지갑과 묶어서 봐야 정치 뉴스와 시장 반응의 맥락이 선명해집니다."
      : "정치 뉴스, 밈코인 심리, WLFI 담론이 함께 반응하는 대표 공인 지갑입니다.";
  }
  if (
    entityId === "world-liberty-financial" ||
    wallet.category === "protocol_treasury" ||
    tags.has("wlfi") ||
    tags.has("treasury")
  ) {
    return wallet.isRepresentative === false
      ? "WLFI 관련 보조 금고 주소로, 대표 트레저리와 함께 보면 자금 집행과 리밸런싱의 역할 분담이 드러납니다."
      : "프로젝트 금고 흐름을 읽는 대표 지갑으로, 개인 지갑과 분리해서 봐야 하는 WLFI 자금 축입니다.";
  }
  if (entityId === "vitalik-buterin" || (wallet.category === "founder" && tags.has("ethereum"))) {
    return wallet.isRepresentative === false
      ? "Vitalik 관련 보조 주소로, 대표 주소와 함께 보면 기부·생태계 지원·개인 자금의 쓰임새가 구분됩니다."
      : "이더리움 핵심 인물의 자금 흐름을 읽는 대표 기준 지갑입니다.";
  }
  if (entityId === "justin-sun" || (wallet.category === "founder" && tags.has("tron"))) {
    return wallet.isRepresentative === false
      ? "Justin Sun 연관 보조 주소로, 대표 주소와 묶어 보면 멀티체인 자금 재배치의 실제 실행 경로가 더 잘 보입니다."
      : "TRON 및 멀티체인 자금 재배치를 읽는 핵심 인물 지갑입니다.";
  }
  if (wallet.category === "market_maker" || tags.has("market-maker")) {
    return "시장 유동성 공급자의 재배치를 읽는 핵심 메이커 지갑으로, 거래소 흐름과 함께 봐야 의미가 커집니다.";
  }
  if (wallet.category === "bridge" || tags.has("bridge")) {
    return "체인 간 자금 이동과 유동성 전이를 읽는 브리지 기준 지갑입니다.";
  }
  if (wallet.category === "exchange" || wallet.category === "custody") {
    return wallet.isRepresentative === false
      ? "대표 거래소 주소를 보조하는 운영 지갑으로, 준비금과 실거래 유동성 흐름을 나눠 읽는 데 도움이 됩니다."
      : "거래소·수탁 측 유동성 재배치를 읽는 대표 기준 지갑입니다.";
  }
  if (wallet.entityId && wallet.isRepresentative === false) {
    return "대표 주소를 보조하는 연관 지갑으로, 같은 주체의 역할 분담을 읽을 때 함께 확인할 가치가 있습니다.";
  }
  return wallet.note ?? `${categoryLabel(wallet.category)} 흐름을 읽는 기준 지갑입니다.`;
}

function joinNoteParts(parts: Array<string | undefined>): string {
  return parts.map((part) => compactString(part)).filter(Boolean).join(" ");
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
  return [...entries].sort(compareWalletSortOrder);
}

export function listCuratedWalletEntries(): CuratedWalletEntry[] {
  return curatedWalletRegistry.map((entry) => cloneWalletEntry(entry));
}

export function getCuratedWalletRegistryMeta(): CuratedWalletRegistryMeta {
  return { ...curatedWalletRegistryMeta };
}

export async function loadCuratedWalletEntries(forceRefresh = false): Promise<CuratedWalletEntry[]> {
  if (!forceRefresh && curatedWalletLoadPromise) {
    return curatedWalletLoadPromise;
  }

  const loadPromise = loadSheetBackedRegistry().catch(() => {
    if (!seedFallbackEnabled()) {
      loadWatchlistOverrides([], []);
      return refreshCuratedWalletRegistry([], {
        source: "empty",
        label: "empty",
        rowCount: 0,
        seedEnabled: false,
      });
    }
    return buildRegistryFromEntries({
      entries: curatedWalletSeed,
      aliasRows: [],
      overrideRows: [],
      meta: {
        source: "seed",
        label: "seed",
        rowCount: curatedWalletSeed.length,
        seedEnabled: true,
      },
    });
  });
  curatedWalletLoadPromise = loadPromise;

  try {
    return await loadPromise;
  } finally {
    if (curatedWalletLoadPromise === loadPromise) {
      curatedWalletLoadPromise = null;
    }
  }
}

export async function loadCuratedWalletEntriesWithMeta(
  forceRefresh = false,
): Promise<{ wallets: CuratedWalletEntry[]; meta: CuratedWalletRegistryMeta }> {
  const wallets = await loadCuratedWalletEntries(forceRefresh);
  return {
    wallets,
    meta: getCuratedWalletRegistryMeta(),
  };
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
    const bucket = activityBucketFor(0, 0);
    return {
      wallet,
      symbol,
      note: joinNoteParts([walletNarrativeLead(wallet), selectCuratedNote(wallet, bucket)]),
      badge: `${wallet.grade}등급 ${categoryLabel(wallet.category)}`,
      tone: "neutral",
      relatedSignalCount: 0,
      activityScore:
        (wallet.enabled ? 100 : 0) +
        walletDisplayPriorityBoost(wallet) -
        walletCategoryWeight(wallet.category) * 2 -
        wallet.priority,
    };
  }

  const symbol = compactString(matched.symbol).toUpperCase() || wallet.focusSymbols?.[0] || wallet.chain.toUpperCase();
  const amountUsd = parseFloatSafe(compactString(matched.amount_usd)) ?? 0;
  const relatedSignals = relatedSignalCount(matched, signals);
  const role = roleFromTransaction(wallet, matched);
  const direction = role === "from" ? "출금" : "유입";
  const bucket = activityBucketFor(amountUsd, relatedSignals);
  const note = joinNoteParts([
    amountUsd > 0
      ? `${symbol} ${formatCompactUsd(amountUsd)} ${direction} 움직임이 최근 감지되었습니다.`
      : `${symbol} ${direction} 움직임이 최근 감지되었습니다.`,
    selectCuratedNote(wallet, bucket, direction),
  ]);

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
      walletCategoryWeight(wallet.category) * 2 +
      walletDisplayPriorityBoost(wallet) -
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
  const maxItems = options?.maxItems ?? 20;

  return wallets
    .map((wallet) => walletActivity(wallet, transactions, signals))
    .sort((left, right) => {
      if (left.activityScore !== right.activityScore) {
        return right.activityScore - left.activityScore;
      }
      return compareWalletSortOrder(left.wallet, right.wallet);
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
      displayPriority: activity.wallet.displayPriority,
      entityId: activity.wallet.entityId,
      isRepresentative: activity.wallet.isRepresentative,
      narrativeTags: activity.wallet.narrativeTags ? [...activity.wallet.narrativeTags] : undefined,
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
