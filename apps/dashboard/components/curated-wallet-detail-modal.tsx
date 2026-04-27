"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";

import {
  focusModalFallback,
  trapModalKeydown,
} from "./modal-focus-trap";
import styles from "./curated-wallet-detail-modal.module.css";

type WalletDetailSignal = {
  id: string;
  createdAt?: string;
  rule: string;
  severity: string;
  score: number | null;
  source: string;
  summary: string;
  evidenceTxHashes: string[];
  relatedAssets: string[];
  relatedWalletLabels: string[];
};

type WalletDetailTransaction = {
  hash: string;
  timestamp?: string;
  chain: string;
  symbol: string;
  amount: string;
  amountUsd: number | null;
  direction: "inflow" | "outflow" | "internal";
  fromLabel: string;
  toLabel: string;
  fromAddress: string;
  toAddress: string;
  counterpartyLabel: string;
  counterpartyAddress: string;
};

type WalletDetailBalance = {
  walletId: string;
  label: string;
  chain: string;
  approxBalance: string;
  approxBalanceValue: number | null;
  sourceRef?: string;
  sourceUrl?: string;
  note?: string;
  isActive: boolean;
  updatedAt?: string;
};

type WalletDetailAnalysis = {
  title: string;
  thesis?: string;
  behaviorSummary?: string;
  watchReason?: string;
  riskNote?: string;
  dataStatus?: string;
  approxBalanceLabel?: string;
  tags: string[];
  source?: string;
  sourceRef?: string;
  sourceUrl?: string;
  updatedAt?: string;
};

export type CuratedWalletDetailPayload = {
  wallet: {
    id: string;
    entityId?: string;
    label: string;
    address: string;
    chain: string;
    category: string;
    grade: string;
    enabled: boolean;
    isRepresentative: boolean;
    note?: string;
    focusSymbols: string[];
    aliases: string[];
    narrativeTags: string[];
    sourceRef?: string;
    sourceUrl?: string;
    approxBalance?: string;
    updatedAt?: string;
  };
  analysis?: WalletDetailAnalysis;
  entity: {
    id?: string;
    matchedOn: string;
    walletCount: number;
    representativeWalletId: string;
    relatedWallets: Array<{
      id: string;
      label: string;
      address: string;
      chain: string;
      category: string;
      grade: string;
      isRepresentative: boolean;
    }>;
  };
  stats: {
    lastSeenAt?: string;
    relatedSignalCount: number;
    recentTransactionCount: number;
    inflowUsd: number;
    outflowUsd: number;
    netflowUsd: number;
    latestBalance?: string;
    latestBalanceUpdatedAt?: string;
  };
  balances: WalletDetailBalance[];
  transactions: WalletDetailTransaction[];
  signals: WalletDetailSignal[];
  meta: {
    resolvedBy: string;
    availableSources: {
      curatedWallets: boolean;
      transactions: boolean;
      signals: boolean;
      balances: boolean;
    };
  };
};

type CuratedWalletDetailModalProps = {
  walletKey: string | null;
  fallbackTitle?: string;
  initialLanguage: DashboardLanguage;
  isOpen: boolean;
  onClose: () => void;
};

type LoadState =
  | { status: "idle"; data: null; errorMessage: null }
  | { status: "loading"; data: CuratedWalletDetailPayload | null; errorMessage: null }
  | { status: "ready"; data: CuratedWalletDetailPayload; errorMessage: null }
  | { status: "error"; data: CuratedWalletDetailPayload | null; errorMessage: string };

type BalanceCompositionSlice = {
  label: string;
  value: number;
  share: number;
};

const detailCache = new Map<string, CuratedWalletDetailPayload>();
const BALANCE_COMPOSITION_COLORS = [
  "#0f6db5",
  "#49a3df",
  "#7fd4f2",
  "#8edcb5",
  "#f0a36b",
];

function formatKstDateTime(value: string | undefined, fallback: string): string {
  const text = value?.trim();
  if (!text) {
    return fallback;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function formatCompactNumber(
  value: number | null | undefined,
  language: DashboardLanguage,
  fallback: string,
): string {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }

  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatUsd(
  value: number | null | undefined,
  language: DashboardLanguage,
  fallback: string,
): string {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }

  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function shortAddress(value: string): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function amountBarWidth(value: number | null, maxValue: number): number {
  if (value == null || !Number.isFinite(value) || maxValue <= 0) {
    return 0;
  }
  return Math.max(8, Math.min(100, (Math.abs(value) / maxValue) * 100));
}

function formatPercent(value: number, language: DashboardLanguage): string {
  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}


type SvgDonutChartProps = {
  slices: BalanceCompositionSlice[];
  colors: string[];
  innerRadius: number;
  outerRadius: number;
  language: DashboardLanguage;
  unresolved: string;
};

function SvgDonutChart({
  slices,
  colors,
  innerRadius,
  outerRadius,
  language,
  unresolved,
}: SvgDonutChartProps) {
  const cx = 100;
  const cy = 100;
  const gap = 2; // degrees of padding between slices

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  const paths: { d: string; fill: string; title: string }[] = [];
  let cursor = 0;

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const sweep = (slice.value / total) * 360;
    const halfGap = gap / 2;
    const startAngle = cursor + halfGap;
    const endAngle = cursor + sweep - halfGap;
    cursor += sweep;

    if (endAngle <= startAngle) continue;

    // Build full donut slice path: outer arc forward, line to inner, inner arc back, close
    const x2out = cx + outerRadius * Math.cos(((endAngle - 90) * Math.PI) / 180);
    const y2out = cy + outerRadius * Math.sin(((endAngle - 90) * Math.PI) / 180);
    const x1in = cx + innerRadius * Math.cos(((endAngle - 90) * Math.PI) / 180);
    const y1in = cy + innerRadius * Math.sin(((endAngle - 90) * Math.PI) / 180);
    const x2in = cx + innerRadius * Math.cos(((startAngle - 90) * Math.PI) / 180);
    const y2in = cy + innerRadius * Math.sin(((startAngle - 90) * Math.PI) / 180);
    const x1out = cx + outerRadius * Math.cos(((startAngle - 90) * Math.PI) / 180);
    const y1out = cy + outerRadius * Math.sin(((startAngle - 90) * Math.PI) / 180);

    const largeArc = sweep - gap > 180 ? 1 : 0;

    const d = [
      `M ${x1out} ${y1out}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2out} ${y2out}`,
      `L ${x1in} ${y1in}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x2in} ${y2in}`,
      "Z",
    ].join(" ");

    paths.push({
      d,
      fill: colors[i % colors.length],
      title: `${slice.label}: ${formatUsd(slice.value, language, unresolved)} (${formatPercent(slice.share, language)})`,
    });
  }

  return (
    <svg
      viewBox="0 0 200 200"
      width="100%"
      height="100%"
      role="img"
      aria-label="Balance composition donut chart"
    >
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill}>
          <title>{p.title}</title>
        </path>
      ))}
    </svg>
  );
}

export function CuratedWalletDetailModal({
  walletKey,
  fallbackTitle,
  initialLanguage,
  isOpen,
  onClose,
}: CuratedWalletDetailModalProps) {
  const { dictionary, language } = useDashboardI18n(initialLanguage);
  const [isMounted, setIsMounted] = useState(false);
  const [state, setState] = useState<LoadState>({
    status: "idle",
    data: null,
    errorMessage: null,
  });
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const copy = useMemo(
    () =>
      language === "ko"
        ? {
            eyebrow: "Wallet detail",
            loadingTitle: "지갑 상세를 불러오는 중입니다.",
            loadingBody: "관련 트랜잭션, 시그널, 잔고 스냅샷을 순서대로 정리하고 있습니다.",
            errorTitle: "지갑 상세를 불러오지 못했습니다.",
            errorBody: "잠시 후 다시 시도해 주세요. 기본 watchlist 정보는 그대로 유지됩니다.",
            emptyTitle: "상세 데이터가 아직 충분하지 않습니다.",
            emptyBody: "큐레이션 레지스트리는 있지만 연결된 트랜잭션/시그널/잔고 스냅샷이 아직 없습니다.",
            modalClose: "지갑 상세 닫기",
            overviewTitle: "핵심 요약",
            overviewLead: "대표 주소와 최근 관측 흐름을 한 번에 봅니다.",
            analysisTitle: "지갑 분석",
            analysisLead: "이 지갑을 왜 봐야 하는지와 현재 데이터 상태를 사람이 읽는 문장으로 정리합니다.",
            analysisThesis: "핵심 관찰",
            analysisBehavior: "행동 패턴",
            analysisWatchReason: "관찰 이유",
            analysisRiskNote: "해석 주의점",
            analysisDataStatus: "데이터 상태",
            analysisSource: "프로필 출처",
            analysisUpdatedAt: "프로필 업데이트",
            noAnalysis: "분석 프로필이 아직 기록되지 않았습니다. wallet_detail_profiles 테이블 시드가 필요합니다.",
            entityWalletsTitle: "같은 엔티티로 묶인 주소",
            entityWalletsLead: "대표 주소가 아닌 보조 주소도 함께 확인합니다.",
            balancesTitle: "잔고 스냅샷",
            balancesLead: "현재 시트에서 읽을 수 있는 최신 잔고 정보입니다.",
            balanceCompositionTitle: "잔고 구성",
            balanceCompositionLead: "USD 환산 잔고가 확인된 항목만 비중 차트로 보여줍니다.",
            activityTitle: "최근 온체인 이동",
            activityLead: "해당 엔티티 주소가 직접 연관된 최신 거래입니다.",
            signalsTitle: "연결된 시그널",
            signalsLead: "지갑 주소 또는 연결 거래 해시로 추적된 시그널입니다.",
            tagsTitle: "내러티브 태그",
            aliasesTitle: "별칭",
            latestSeen: "최근 관측",
            linkedSignals: "연결 시그널",
            txCount: "최근 거래",
            netFlow: "순유입",
            balance: "최신 잔고",
            representative: "대표 주소",
            viewSource: "출처 열기",
            sourceReference: "출처",
            noPublicSource: "공개 URL 없음",
            profileOnlyTitle: "현재는 큐레이션 프로필 기반 상세입니다.",
            profileOnlyBody:
              "이 지갑 주소와 직접 매칭된 최근 거래·시그널은 아직 없습니다. 실시간 수집 데이터가 같은 주소 또는 증거 해시로 연결되면 이 숫자가 자동으로 채워집니다.",
            unresolved: "데이터 대기",
            noTags: "등록된 태그 없음",
            noAliases: "등록된 별칭 없음",
            noBalances: "표시 가능한 잔고 스냅샷이 없습니다.",
            noBalanceComposition: "USD 환산 잔고가 부족해 구성 차트를 만들지 않았습니다.",
            noActivity: "연결된 거래가 아직 없습니다.",
            noSignals: "연결된 시그널이 아직 없습니다.",
            inflow: "유입",
            outflow: "유출",
            internal: "내부 이동",
            from: "보낸 쪽",
            to: "받은 쪽",
            counterparty: "상대",
            updatedAt: "업데이트",
            resolvedBy: "매칭 기준",
            sourcesReady: "데이터 소스",
          }
        : {
            eyebrow: "Wallet detail",
            loadingTitle: "Loading wallet detail.",
            loadingBody: "Transactions, signals, and balance snapshots are being assembled.",
            errorTitle: "Wallet detail is unavailable.",
            errorBody: "Try again in a moment. The watchlist card itself is still available.",
            emptyTitle: "Not enough linked detail is ready yet.",
            emptyBody: "The curated registry exists, but there are no linked transactions, signals, or balance snapshots yet.",
            modalClose: "Close wallet detail",
            overviewTitle: "Overview",
            overviewLead: "Representative address and recent context in one place.",
            analysisTitle: "Wallet analysis",
            analysisLead: "Explains why this wallet matters and what data is currently available in human terms.",
            analysisThesis: "Core read",
            analysisBehavior: "Behavior pattern",
            analysisWatchReason: "Why watch it",
            analysisRiskNote: "Interpretation guardrail",
            analysisDataStatus: "Data status",
            analysisSource: "Profile source",
            analysisUpdatedAt: "Profile updated",
            noAnalysis: "No analysis profile has been recorded yet. Seed the wallet_detail_profiles table.",
            entityWalletsTitle: "Addresses under the same entity",
            entityWalletsLead: "Secondary addresses are listed together with the representative one.",
            balancesTitle: "Balance snapshots",
            balancesLead: "Latest balance rows available from the sheet-backed registry.",
            balanceCompositionTitle: "Balance composition",
            balanceCompositionLead:
              "Shows composition only when USD-normalized balances are available.",
            activityTitle: "Recent on-chain activity",
            activityLead: "Latest transfers directly involving this entity's addresses.",
            signalsTitle: "Linked signals",
            signalsLead: "Signals matched by wallet address or related transaction hashes.",
            tagsTitle: "Narrative tags",
            aliasesTitle: "Aliases",
            latestSeen: "Last seen",
            linkedSignals: "Linked signals",
            txCount: "Recent transfers",
            netFlow: "Net flow",
            balance: "Latest balance",
            representative: "Representative",
            viewSource: "Open source",
            sourceReference: "Source",
            noPublicSource: "No public URL",
            profileOnlyTitle: "This detail is currently backed by the curated profile.",
            profileOnlyBody:
              "No recent transactions or signals are directly matched to this wallet address yet. These counts will fill in when live telemetry connects by address or evidence hash.",
            unresolved: "Waiting for data",
            noTags: "No narrative tags yet",
            noAliases: "No aliases yet",
            noBalances: "No balance snapshots are available.",
            noBalanceComposition: "There is not enough USD-normalized balance data to draw a composition chart.",
            noActivity: "No related transfers yet.",
            noSignals: "No linked signals yet.",
            inflow: "Inflow",
            outflow: "Outflow",
            internal: "Internal",
            from: "From",
            to: "To",
            counterparty: "Counterparty",
            updatedAt: "Updated",
            resolvedBy: "Matched by",
            sourcesReady: "Available sources",
          },
    [language],
  );

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  useEffect(() => {
    if (!isMounted || !isOpen) {
      return undefined;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      focusModalFallback(modalRef.current, closeButtonRef.current);
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      trapModalKeydown(event, modalRef.current, closeButtonRef.current, onClose);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const modal = modalRef.current;
      if (!modal) {
        return;
      }

      const target = event.target;
      if (target instanceof Node && modal.contains(target)) {
        return;
      }

      focusModalFallback(modal, closeButtonRef.current);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [isMounted, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !walletKey) {
      return undefined;
    }

    const cached = detailCache.get(walletKey);
    if (cached) {
      setState({ status: "ready", data: cached, errorMessage: null });
      return undefined;
    }

    const controller = new AbortController();
    setState((prev) => ({
      status: "loading",
      data:
        prev.data &&
        (prev.data.wallet.id === walletKey || prev.data.wallet.entityId === walletKey)
          ? prev.data
          : cached ?? null,
      errorMessage: null,
    }));

    fetch(`/api/wallet/${encodeURIComponent(walletKey)}`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`wallet detail request failed: ${response.status}`);
        }
        return (await response.json()) as CuratedWalletDetailPayload;
      })
      .then((payload) => {
        detailCache.set(walletKey, payload);
        setState({ status: "ready", data: payload, errorMessage: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("[curated-wallet-detail-modal]", String(error));
        setState({
          status: "error",
          data: cached ?? null,
          errorMessage: copy.errorBody,
        });
      });

    return () => {
      controller.abort();
    };
  }, [copy.errorBody, isOpen, walletKey]);

  const data = state.data;
  const maxBalanceValue = useMemo(() => {
    if (!data) {
      return 0;
    }
    return data.balances.reduce((max, row) => {
      const value = row.approxBalanceValue ?? 0;
      return value > max ? value : max;
    }, 0);
  }, [data]);
  const maxTransactionUsd = useMemo(() => {
    if (!data) {
      return 0;
    }
    return data.transactions.reduce((max, row) => {
      const value = Math.abs(row.amountUsd ?? 0);
      return value > max ? value : max;
    }, 0);
  }, [data]);
  const balanceComposition = useMemo(() => {
    if (!data) {
      return { total: 0, slices: [] as BalanceCompositionSlice[] };
    }

    const ranked = data.balances
      .map((row) => ({
        label: row.label,
        value: row.approxBalanceValue ?? 0,
      }))
      .filter((row) => Number.isFinite(row.value) && row.value > 0)
      .sort((left, right) => right.value - left.value);

    const total = ranked.reduce((sum, row) => sum + row.value, 0);
    if (total <= 0) {
      return { total: 0, slices: [] as BalanceCompositionSlice[] };
    }

    const topRows = ranked.slice(0, 4);
    const othersValue = ranked.slice(4).reduce((sum, row) => sum + row.value, 0);
    const slices = topRows.map((row) => ({
      label: row.label,
      value: row.value,
      share: row.value / total,
    }));

    if (othersValue > 0) {
      slices.push({
        label: language === "ko" ? "기타 잔고" : "Other balances",
        value: othersValue,
        share: othersValue / total,
      });
    }

    return { total, slices };
  }, [data, language]);

  if (!isMounted || !isOpen) {
    return null;
  }

  const title = data?.wallet.label ?? fallbackTitle ?? dictionary.home.watchlistTitle;
  const description = data?.wallet.note || fallbackTitle || copy.loadingBody;
  const sourceFlags = data
    ? Object.entries(data.meta.availableSources)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
    : [];

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
            {data ? (
              <div className={styles.headerMeta}>
                <span className={styles.pill}>{data.wallet.grade}</span>
                <span className={styles.pill}>{data.wallet.category}</span>
                <span className={styles.pill}>{data.wallet.chain}</span>
                {data.wallet.isRepresentative ? (
                  <span className={styles.pill}>{copy.representative}</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={copy.modalClose}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className={styles.content}>
          {state.status === "loading" && !data ? (
            <div className={styles.loadingState}>
              <p className={styles.stateTitle}>{copy.loadingTitle}</p>
              <p className={styles.stateBody}>{copy.loadingBody}</p>
              <div className={styles.skeletonLine} data-width="lg" />
              <div className={styles.skeletonLine} data-width="md" />
              <div className={styles.skeletonLine} data-width="sm" />
            </div>
          ) : null}

          {state.status === "error" && !data ? (
            <div className={styles.errorState}>
              <p className={styles.stateTitle}>{copy.errorTitle}</p>
              <p className={styles.stateBody}>{state.errorMessage ?? copy.errorBody}</p>
            </div>
          ) : null}

          {data ? (
            <>
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h4 className={styles.sectionTitle}>
                      {data.analysis?.title || copy.analysisTitle}
                    </h4>
                    <p className={styles.sectionLead}>{copy.analysisLead}</p>
                  </div>
                </div>

                {data.analysis ? (
                  <div className={styles.analysisGrid}>
                    {data.analysis.thesis ? (
                      <article className={styles.analysisCard}>
                        <span className={styles.metricLabel}>{copy.analysisThesis}</span>
                        <p className={styles.analysisText}>{data.analysis.thesis}</p>
                      </article>
                    ) : null}
                    {data.analysis.behaviorSummary ? (
                      <article className={styles.analysisCard}>
                        <span className={styles.metricLabel}>{copy.analysisBehavior}</span>
                        <p className={styles.analysisText}>{data.analysis.behaviorSummary}</p>
                      </article>
                    ) : null}
                    {data.analysis.watchReason ? (
                      <article className={styles.analysisCard}>
                        <span className={styles.metricLabel}>{copy.analysisWatchReason}</span>
                        <p className={styles.analysisText}>{data.analysis.watchReason}</p>
                      </article>
                    ) : null}
                    {data.analysis.riskNote ? (
                      <article className={styles.analysisCard}>
                        <span className={styles.metricLabel}>{copy.analysisRiskNote}</span>
                        <p className={styles.analysisText}>{data.analysis.riskNote}</p>
                      </article>
                    ) : null}
                    {data.analysis.dataStatus ? (
                      <article className={styles.analysisCard}>
                        <span className={styles.metricLabel}>{copy.analysisDataStatus}</span>
                        <p className={styles.analysisText}>{data.analysis.dataStatus}</p>
                      </article>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <p className={styles.stateBody}>{copy.noAnalysis}</p>
                  </div>
                )}

                {data.analysis ? (
                  <div className={styles.analysisFooter}>
                    {data.analysis.tags.length > 0 ? (
                      <div className={styles.tagList}>
                        {data.analysis.tags.map((tag) => (
                          <span key={`analysis-${tag}`} className={styles.tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className={styles.analysisMeta}>
                      {data.analysis.source ? (
                        <span>
                          {copy.analysisSource}: {data.analysis.source}
                        </span>
                      ) : null}
                      {data.analysis.updatedAt ? (
                        <span>
                          {copy.analysisUpdatedAt}:{" "}
                          {formatKstDateTime(data.analysis.updatedAt, copy.unresolved)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={styles.heroCard}>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h4 className={styles.sectionTitle}>{copy.overviewTitle}</h4>
                      <p className={styles.sectionLead}>{copy.overviewLead}</p>
                    </div>
                    {data.wallet.sourceUrl ? (
                      <a
                        href={data.wallet.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.pill}
                      >
                        {copy.viewSource}
                      </a>
                    ) : data.wallet.sourceRef ? (
                      <span className={styles.pill}>
                        {copy.sourceReference}: {data.wallet.sourceRef} · {copy.noPublicSource}
                      </span>
                    ) : null}
                  </div>

                  <div className={styles.tagList}>
                    <span className={styles.tag}>
                      {copy.resolvedBy}: {data.meta.resolvedBy}
                    </span>
                    <span className={styles.tag}>
                      {copy.sourcesReady}: {sourceFlags.length > 0 ? sourceFlags.join(" · ") : copy.unresolved}
                    </span>
                  </div>

                  <div className={styles.metricGrid}>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>{copy.latestSeen}</span>
                      <p className={styles.metricValue}>
                        {formatKstDateTime(data.stats.lastSeenAt, copy.unresolved)}
                      </p>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>{copy.linkedSignals}</span>
                      <p className={styles.metricValue}>
                        {formatCompactNumber(data.stats.relatedSignalCount, language, "0")}
                      </p>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>{copy.txCount}</span>
                      <p className={styles.metricValue}>
                        {formatCompactNumber(data.stats.recentTransactionCount, language, "0")}
                      </p>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>{copy.netFlow}</span>
                      <p className={styles.metricValue}>
                        {formatUsd(data.stats.netflowUsd, language, copy.unresolved)}
                      </p>
                      <p className={styles.metricHelp}>
                        {copy.inflow} {formatUsd(data.stats.inflowUsd, language, copy.unresolved)} /{" "}
                        {copy.outflow} {formatUsd(data.stats.outflowUsd, language, copy.unresolved)}
                      </p>
                    </div>
                  </div>
                  {data.stats.relatedSignalCount === 0 && data.stats.recentTransactionCount === 0 ? (
                    <div className={styles.noticeCard}>
                      <p className={styles.noticeTitle}>{copy.profileOnlyTitle}</p>
                      <p className={styles.noticeBody}>{copy.profileOnlyBody}</p>
                    </div>
                  ) : null}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h4 className={styles.sectionTitle}>{copy.balance}</h4>
                      <p className={styles.sectionLead}>
                        {formatKstDateTime(data.stats.latestBalanceUpdatedAt, copy.unresolved)}
                      </p>
                    </div>
                  </div>
                  <div className={styles.metricCard}>
                    <span className={styles.metricLabel}>{copy.balance}</span>
                    <p className={styles.metricValue}>
                      {data.stats.latestBalance ?? data.wallet.approxBalance ?? copy.unresolved}
                    </p>
                    {data.wallet.sourceRef ? (
                      <p className={styles.metricHelp}>{data.wallet.sourceRef}</p>
                    ) : null}
                  </div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h4 className={styles.sectionTitle}>{copy.balanceCompositionTitle}</h4>
                      <p className={styles.sectionLead}>{copy.balanceCompositionLead}</p>
                    </div>
                  </div>
                  {balanceComposition.slices.length > 0 ? (
                    <div className={styles.compositionCard}>
                      <div className={styles.compositionChartWrap}>
                        <SvgDonutChart
                          slices={balanceComposition.slices}
                          colors={BALANCE_COMPOSITION_COLORS}
                          innerRadius={54}
                          outerRadius={84}
                          language={language}
                          unresolved={copy.unresolved}
                        />
                      </div>
                      <div className={styles.compositionLegend}>
                        <div className={styles.compositionLegendItem}>
                          <span className={styles.compositionLegendLabel}>{copy.balance}</span>
                          <strong className={styles.compositionLegendValue}>
                            {formatUsd(balanceComposition.total, language, copy.unresolved)}
                          </strong>
                        </div>
                        {balanceComposition.slices.map((slice, index) => (
                          <div key={`${slice.label}-${slice.value}`} className={styles.compositionLegendItem}>
                            <div className={styles.compositionLegendCopy}>
                              <span
                                className={styles.compositionSwatch}
                                style={{
                                  background:
                                    BALANCE_COMPOSITION_COLORS[
                                      index % BALANCE_COMPOSITION_COLORS.length
                                    ],
                                }}
                                aria-hidden="true"
                              />
                              <span className={styles.compositionLegendLabel}>{slice.label}</span>
                            </div>
                            <div className={styles.compositionLegendMetrics}>
                              <strong className={styles.compositionLegendValue}>
                                {formatUsd(slice.value, language, copy.unresolved)}
                              </strong>
                              <span className={styles.compositionLegendShare}>
                                {formatPercent(slice.share, language)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyState}>
                      <p className={styles.stateBody}>{copy.noBalanceComposition}</p>
                    </div>
                  )}
                  <div className={styles.sectionHeader}>
                    <div>
                      <h4 className={styles.sectionTitle}>{copy.tagsTitle}</h4>
                    </div>
                  </div>
                  <div className={styles.tagList}>
                    {(data.wallet.narrativeTags.length > 0 ? data.wallet.narrativeTags : [copy.noTags]).map(
                      (tag) => (
                        <span key={tag} className={styles.tag}>
                          {tag}
                        </span>
                      ),
                    )}
                  </div>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h4 className={styles.sectionTitle}>{copy.aliasesTitle}</h4>
                    </div>
                  </div>
                  <div className={styles.tagList}>
                    {(data.wallet.aliases.length > 0 ? data.wallet.aliases : [copy.noAliases]).map((alias) => (
                      <span key={alias} className={styles.tag}>
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h4 className={styles.sectionTitle}>{copy.entityWalletsTitle}</h4>
                    <p className={styles.sectionLead}>{copy.entityWalletsLead}</p>
                  </div>
                </div>
                <div className={styles.walletList}>
                  {data.entity.relatedWallets.map((wallet) => (
                    <article key={wallet.id} className={styles.walletRow}>
                      <div className={styles.walletRowCopy}>
                        <p className={styles.walletLabel}>{wallet.label}</p>
                        <p className={styles.walletMeta}>
                          {wallet.chain} · {shortAddress(wallet.address)}
                        </p>
                      </div>
                      <span className={styles.walletBadge}>
                        {wallet.grade} · {wallet.category}
                      </span>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h4 className={styles.sectionTitle}>{copy.balancesTitle}</h4>
                    <p className={styles.sectionLead}>{copy.balancesLead}</p>
                  </div>
                </div>
                {data.balances.length > 0 ? (
                  <div className={styles.balanceList}>
                    {data.balances.map((balance) => (
                      <article key={`${balance.walletId}-${balance.updatedAt ?? "none"}`} className={styles.balanceRow}>
                        <div className={styles.rowHeader}>
                          <div>
                            <p className={styles.rowTitle}>{balance.label}</p>
                            <p className={styles.rowMeta}>
                              {balance.chain} · {balance.updatedAt ? formatKstDateTime(balance.updatedAt, copy.unresolved) : copy.unresolved}
                            </p>
                          </div>
                          <span className={styles.walletBadge}>{balance.approxBalance}</span>
                        </div>
                        <div className={styles.barTrack}>
                          <div
                            className={styles.barFill}
                            style={{ width: `${amountBarWidth(balance.approxBalanceValue, maxBalanceValue)}%` }}
                          />
                        </div>
                        <div className={styles.barLegend}>
                          <span>{balance.sourceRef ?? copy.unresolved}</span>
                          {balance.sourceUrl ? (
                            <a href={balance.sourceUrl} target="_blank" rel="noreferrer">
                              {copy.viewSource}
                            </a>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <p className={styles.stateBody}>{copy.noBalances}</p>
                  </div>
                )}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h4 className={styles.sectionTitle}>{copy.activityTitle}</h4>
                    <p className={styles.sectionLead}>{copy.activityLead}</p>
                  </div>
                </div>
                {data.transactions.length > 0 ? (
                  <div className={styles.activityList}>
                    {data.transactions.map((transaction) => (
                      <article key={`${transaction.hash}-${transaction.timestamp ?? ""}`} className={styles.activityRow}>
                        <div className={styles.rowHeader}>
                          <div>
                            <p className={styles.rowTitle}>
                              {transaction.symbol} · {formatUsd(transaction.amountUsd, language, transaction.amount)}
                            </p>
                            <p className={styles.rowMeta}>
                              {formatKstDateTime(transaction.timestamp, copy.unresolved)} · {transaction.chain}
                            </p>
                          </div>
                          <span className={styles.walletBadge}>
                            {transaction.direction === "inflow"
                              ? copy.inflow
                              : transaction.direction === "outflow"
                                ? copy.outflow
                                : copy.internal}
                          </span>
                        </div>
                        <div className={styles.barTrack}>
                          <div
                            className={styles.barFill}
                            data-tone={transaction.direction}
                            style={{ width: `${amountBarWidth(transaction.amountUsd, maxTransactionUsd)}%` }}
                          />
                        </div>
                        <div className={styles.activityMeta}>
                          <span className={styles.activityChip}>
                            {copy.from}: {transaction.fromLabel}
                          </span>
                          <span className={styles.activityChip}>
                            {copy.to}: {transaction.toLabel}
                          </span>
                          <span className={styles.activityChip}>
                            {copy.counterparty}: {transaction.counterpartyLabel}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <p className={styles.stateBody}>{copy.noActivity}</p>
                  </div>
                )}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h4 className={styles.sectionTitle}>{copy.signalsTitle}</h4>
                    <p className={styles.sectionLead}>{copy.signalsLead}</p>
                  </div>
                </div>
                {data.signals.length > 0 ? (
                  <div className={styles.signalList}>
                    {data.signals.map((signal) => (
                      <article key={signal.id} className={styles.signalRow}>
                        <div className={styles.rowHeader}>
                          <div>
                            <p className={styles.rowTitle}>{signal.summary || signal.rule}</p>
                            <p className={styles.rowMeta}>
                              {formatKstDateTime(signal.createdAt, copy.unresolved)} · {signal.source}
                            </p>
                          </div>
                          <span className={styles.walletBadge}>
                            {signal.severity}
                            {signal.score != null ? ` · ${formatCompactNumber(signal.score, language, "-")}` : ""}
                          </span>
                        </div>
                        <div className={styles.signalMeta}>
                          {signal.relatedAssets.map((asset) => (
                            <span key={`${signal.id}-${asset}`} className={styles.signalChip}>
                              {asset}
                            </span>
                          ))}
                          {signal.relatedWalletLabels.map((label) => (
                            <span key={`${signal.id}-${label}`} className={styles.signalChip}>
                              {label}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <p className={styles.stateBody}>{copy.noSignals}</p>
                  </div>
                )}
              </section>
            </>
          ) : null}

          {state.status === "ready" &&
          data &&
          data.transactions.length === 0 &&
          data.signals.length === 0 &&
          data.balances.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.stateTitle}>{copy.emptyTitle}</p>
              <p className={styles.stateBody}>{copy.emptyBody}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
