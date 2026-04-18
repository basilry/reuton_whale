import type { DashboardLanguage } from "./i18n/config";

type SignalRuleDoc = {
  label: string;
  short: string;
  long: string;
  action: string;
};

type SignalRuleDocMap = Record<DashboardLanguage, SignalRuleDoc>;

const RULE_DOCS: Record<string, SignalRuleDocMap> = {
  cex_inflow_spike: {
    ko: {
      label: "거래소 유입 급증",
      short: "거래소 입금이 짧은 구간에 빠르게 늘어났습니다.",
      long: "특정 거래소 방향의 유입 규모가 최근 분포 상단을 넘어섰습니다. 단기 매도 압력이나 포지션 재배치 전조로 해석할 수 있습니다.",
      action: "같은 자산의 현물 호가와 최근 프리미엄 흐름을 함께 확인하세요.",
    },
    en: {
      label: "CEX inflow spike",
      short: "Exchange-directed deposits accelerated in a short window.",
      long: "Inflow into exchange-facing wallets moved above the recent distribution range. That can precede short-term sell pressure or balance reshuffling.",
      action: "Check spot depth and recent premium changes for the same asset before reacting.",
    },
  },
  cex_outflow_spike: {
    ko: {
      label: "거래소 유출 급증",
      short: "거래소에서 외부 지갑으로 빠져나가는 흐름이 커졌습니다.",
      long: "거래소 출금이 평소보다 크게 늘었습니다. 장기 보관 전환이나 매도 압력 완화 신호로 읽힐 수 있습니다.",
      action: "출금 이후 유입 대상이 커스터디나 콜드월렛인지 함께 확인하세요.",
    },
    en: {
      label: "CEX outflow spike",
      short: "Exchange outflows into external wallets picked up.",
      long: "Withdrawals from exchange-linked wallets rose above their recent baseline. That can align with custody transfer or easing immediate sell pressure.",
      action: "Check whether the receiving side looks like custody, treasury, or cold storage.",
    },
  },
  cold_to_hot_transfer: {
    ko: {
      label: "보관 지갑에서 활동 지갑 이동",
      short: "장기 보관 성격 지갑에서 활동 지갑으로 이동이 포착됐습니다.",
      long: "콜드 또는 보관 성격 주소에서 상대적으로 활동성이 높은 주소로 자금이 이동했습니다. 실제 체결 전 준비 흐름일 수 있습니다.",
      action: "수신 지갑의 최근 거래 빈도와 추가 분산 여부를 확인하세요.",
    },
    en: {
      label: "Cold-to-hot transfer",
      short: "Funds moved from a storage-style wallet into a more active one.",
      long: "Assets left a cold or custody-like address for a wallet with higher recent activity. That can be a preparation step before execution.",
      action: "Inspect whether the receiving wallet starts routing funds out again.",
    },
  },
  smart_money_accumulation: {
    ko: {
      label: "스마트머니 매집 가능성",
      short: "경험치가 높은 참여자의 축적 흐름이 관찰됐습니다.",
      long: "과거 의미 있는 방향성을 보였던 지갑군이 같은 자산을 반복적으로 쌓는 패턴입니다. 누적 강도 자체보다 지속성 확인이 중요합니다.",
      action: "반복 구간이 계속 이어지는지, 거래소 유출과 함께 나타나는지 보세요.",
    },
    en: {
      label: "Smart money accumulation",
      short: "Experienced wallets appear to be adding exposure.",
      long: "Wallets with a stronger historical hit rate are accumulating the same asset over repeated observations. Persistence matters more than any single print.",
      action: "Watch whether the pattern continues across the next few windows.",
    },
  },
  token_whale_concentration_shift: {
    ko: {
      label: "토큰 고래 집중도 변화",
      short: "대형 보유 주소 간 집중도 구조가 흔들렸습니다.",
      long: "상위 고래 지갑 비중이 짧은 시간에 바뀌었습니다. 특정 주체 재편이나 분산 배치 가능성을 시사합니다.",
      action: "상위 주소 랭킹 변화와 신규 진입 주소의 성격을 함께 보세요.",
    },
    en: {
      label: "Whale concentration shift",
      short: "Large-holder concentration changed over a short window.",
      long: "The ownership mix across top wallets moved meaningfully. That can imply rebalancing by a major holder or redistribution into new entities.",
      action: "Compare the new top-wallet set with recent transfer destinations.",
    },
  },
  tg_cex_inflow_burst: {
    ko: {
      label: "텔레그램·거래소 유입 동시 감지",
      short: "채널 제보와 거래소 유입이 같은 방향으로 맞물렸습니다.",
      long: "텔레그램 청취 이벤트와 온체인 거래소 유입이 같은 구간에서 함께 나타났습니다. 외부 신호와 체인 데이터가 교차 확인된 케이스입니다.",
      action: "수신 거래소, 자산, 반복 빈도를 함께 보고 과열 여부를 판단하세요.",
    },
    en: {
      label: "Telegram + CEX inflow burst",
      short: "Telegram listening and exchange inflow lined up in the same direction.",
      long: "A channel event and on-chain exchange-directed inflow appeared in the same window. That gives you cross-source corroboration rather than a single noisy signal.",
      action: "Check which venue and asset are involved before escalating the signal.",
    },
  },
  corroborated_move: {
    ko: {
      label: "교차 확인된 이동",
      short: "서로 다른 데이터 소스가 같은 움직임을 가리켰습니다.",
      long: "온체인, 청취, 또는 내부 규칙 여러 개가 하나의 이동을 함께 지목했습니다. 단일 신호보다 설명력이 높은 구간입니다.",
      action: "연관된 증거 해시가 실제로 같은 서사를 이루는지 순서대로 읽어보세요.",
    },
    en: {
      label: "Corroborated move",
      short: "Multiple sources pointed to the same move.",
      long: "On-chain, listener, or rule-level evidence converged on one movement. This is stronger than a single-source alert because the narrative is reinforced from different angles.",
      action: "Read the evidence hashes in order and verify that they tell one coherent story.",
    },
  },
  weekly_net_accumulation: {
    ko: {
      label: "주간 순매집",
      short: "주간 기준 순유출 또는 순유입 방향성이 누적됐습니다.",
      long: "단일 슬롯보다는 최근 일주일 흐름에서 누적된 순방향이 감지된 상태입니다. 구조적 흐름 확인에 적합합니다.",
      action: "일중 변동성보다 주간 방향성을 우선해서 해석하세요.",
    },
    en: {
      label: "Weekly net accumulation",
      short: "A weekly net-flow bias has started to build.",
      long: "This is less about a single burst and more about a persistent weekly flow imbalance. It is useful for reading structural direction rather than intraday noise.",
      action: "Weight the weekly bias more heavily than any single intraday reversal.",
    },
  },
  whale_cluster_move: {
    ko: {
      label: "고래 군집 이동",
      short: "여러 대형 지갑이 비슷한 방향으로 움직였습니다.",
      long: "복수의 대형 지갑이 같은 자산 또는 같은 방향으로 동시성 있는 이동을 보였습니다. 단발보다 군집성이 핵심입니다.",
      action: "같은 거래소 또는 동일 카운터파티로 수렴하는지 확인하세요.",
    },
    en: {
      label: "Whale cluster move",
      short: "Several large wallets moved in the same direction.",
      long: "Multiple whale wallets showed aligned movement around the same asset or direction. The cluster pattern matters more than any one wallet here.",
      action: "Check whether the destinations converge on one venue or counterparty.",
    },
  },
};

function fallbackLabel(ruleId: string): string {
  return ruleId.replace(/[_-]+/g, " ").trim() || "Signal";
}

export function getSignalRuleDoc(ruleId: string, language: DashboardLanguage): SignalRuleDoc {
  const normalized = ruleId.trim().toLowerCase();
  const docs = RULE_DOCS[normalized];
  if (docs) {
    return docs[language];
  }

  if (language === "ko") {
    return {
      label: fallbackLabel(normalized),
      short: "감지된 규칙을 상세 문서와 함께 확인하세요.",
      long: "이 규칙에 대한 정적 해설이 아직 준비되지 않았습니다. 아래 증거 해시와 점수, 소스 정보를 함께 검토하는 것이 좋습니다.",
      action: "증거 해시의 방향성과 반복 빈도를 먼저 확인하세요.",
    };
  }

  return {
    label: fallbackLabel(normalized),
    short: "Review this detected rule with the attached evidence.",
    long: "A dedicated fallback document is not available for this rule yet. Use the evidence hashes, score, and source metadata to interpret it conservatively.",
    action: "Start with direction, venue, and repetition before drawing a conclusion.",
  };
}
