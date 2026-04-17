// Display humanizers / formatters (extracted from app/page.tsx during the W1-B split).
// Pure functions; safe to import from Server or Client Components.

import type {
  DisplaySignalRow,
  DisplaySystemLogRow,
  DisplayTransactionRow,
  MetricTone,
} from "./types";

// ---------- Coercers ----------

export function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item).trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => toText(item).trim())
            .filter(Boolean);
        }
      } catch {
        // Fall through to a lenient split for partially serialized values.
      }
    }

    return value
      .split(/[,|]/)
      .map((item) => item.trim().replace(/^\[?["']?/, "").replace(/["']?\]?$/, ""))
      .filter(Boolean);
  }
  return [];
}

// ---------- Formatters ----------

export function formatTime(value: string, options?: Intl.DateTimeFormatOptions): string {
  const text = value.trim();
  const numeric = Number(text);
  const date =
    text && Number.isFinite(numeric) && /^\d{10,13}$/.test(text)
      ? new Date(text.length === 10 ? numeric * 1000 : numeric)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "Unknown";
  }

  return new Intl.DateTimeFormat("ko-KR", options ?? { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// NB5 fix: the old `if (!value)` branch classified a legitimate $0 as missing
// because 0 is falsy. Require an explicit undefined/null/NaN to surface the
// "USD 환산값 없음" label so real zero totals render as "$0".
export function formatUsd(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "USD 환산값 없음";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value || 0);
}

export function formatScore(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value || 0);
}

export function formatCompactCount(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value || 0);
}

// ---------- Labels / humanizers ----------

export function humanizeConfidence(value?: string): string {
  const normalized = (value ?? "").toLowerCase();

  if (!normalized) {
    return "신뢰도 미표시";
  }
  if (normalized.includes("high")) {
    return "신뢰도 높음";
  }
  if (normalized.includes("medium")) {
    return "신뢰도 보통";
  }
  if (normalized.includes("low")) {
    return "신뢰도 낮음";
  }
  return value ?? "신뢰도 미표시";
}

export function humanizeChain(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized || normalized === "unknown") {
    return "체인 미확인";
  }
  if (normalized === "eth" || normalized === "ethereum") {
    return "Ethereum";
  }
  if (normalized === "sol" || normalized === "solana") {
    return "Solana";
  }
  return value;
}

export function shortAddressLabel(value: string): string {
  const normalized = value.toLowerCase();

  if (!value || normalized === "unknown") {
    return "미확인 지갑";
  }
  if (normalized.includes("exchange") || normalized.includes("cex")) {
    return "거래소 관련 주소";
  }
  if (normalized === "unknown") {
    return "주소 미확인";
  }
  if (normalized.includes("vault")) {
    return "Vault";
  }
  if (normalized.includes("deposit")) {
    return "입금 주소";
  }
  if (normalized.includes("withdraw")) {
    return "출금 주소";
  }
  if (normalized.includes("bridge")) {
    return "브리지 주소";
  }
  if (normalized.startsWith("0x") && value.length > 12) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
  return value;
}

export function shortHashLabel(value: string): string {
  const text = value.trim();
  if (!text) {
    return "근거 거래";
  }
  if (text.length > 14) {
    return `${text.slice(0, 6)}…${text.slice(-4)}`;
  }
  return text;
}

// ---------- Tone helpers ----------

type ToneOutput = Exclude<MetricTone, "accent" | "soft">;

export function toneForSeverity(severity: string): ToneOutput {
  const value = severity.toLowerCase();

  if (value.includes("critical") || value.includes("high")) {
    return "bad";
  }
  if (value.includes("medium") || value.includes("warn")) {
    return "warn";
  }
  if (value.includes("low")) {
    return "good";
  }
  return "neutral";
}

export function toneForStatus(status: string): ToneOutput {
  const value = status.toLowerCase();

  if (value.includes("failed") || value.includes("error")) {
    return "bad";
  }
  if (value.includes("warn") || value.includes("completed_with_errors")) {
    return "warn";
  }
  if (value.includes("completed") || value.includes("healthy") || value.includes("connected")) {
    return "good";
  }
  return "neutral";
}

export function toneForListenerStatus(status: string): ToneOutput {
  if (status === "ok") {
    return "good";
  }
  if (status === "waiting" || status === "unknown") {
    return "warn";
  }
  if (status === "auth_required" || status === "attention") {
    return "bad";
  }
  return "neutral";
}

export function humanizeSeverity(severity: string): string {
  const value = severity.toLowerCase();

  if (value.includes("critical") || value.includes("high")) {
    return "강한 주의";
  }
  if (value.includes("medium") || value.includes("warn")) {
    return "관찰 필요";
  }
  if (value.includes("low")) {
    return "낮은 강도";
  }
  return severity || "강도 미상";
}

export function humanizeSource(source: string): string {
  const value = source.toLowerCase();

  if (value.includes("chain") || value.includes("onchain")) {
    return "온체인 규칙";
  }
  if (value.includes("telegram") || value.includes("tg")) {
    return "Telegram 교차검증";
  }
  if (value.includes("system")) {
    return "시스템";
  }
  return source || "출처 미상";
}

export function humanizeLatestRunStatus(status: string): string {
  const value = status.toLowerCase();

  if (value.includes("completed_with_errors")) {
    return "완료됐지만 경고가 있습니다";
  }
  if (value.includes("completed")) {
    return "정상 완료";
  }
  if (value.includes("failed")) {
    return "실패";
  }
  if (value.includes("warning") || value.includes("warn")) {
    return "확인 필요";
  }
  if (value.includes("running")) {
    return "실행 중";
  }
  if (value.includes("queued")) {
    return "대기 중";
  }
  return status || "상태 미상";
}

export function ruleLabel(rule: string): string {
  const value = rule.toLowerCase();

  if (value.includes("cex_inflow_spike")) {
    return "거래소 유입 급증";
  }
  if (value.includes("cex_outflow_spike")) {
    return "거래소 유출 급증";
  }
  if (value.includes("cold_to_hot_transfer")) {
    return "콜드월렛에서 핫월렛 이동";
  }
  if (value.includes("smart_money_accumulation")) {
    return "스마트머니 매집 가능성";
  }
  if (value.includes("corroborated_move")) {
    return "온체인과 Telegram에서 동시에 확인된 움직임";
  }
  return rule
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function humanizeSignalSummary(row: DisplaySignalRow): string {
  const summary = row.summary.trim();
  if (summary) {
    const inflow = summary.match(/CEX inflow spike:\s*\$([\d,.]+)/i);
    if (inflow) {
      return `거래소로 약 $${inflow[1]} 규모의 자금 유입이 감지되었습니다. 단기 매도 압력 또는 포지션 정리 가능성을 관찰해야 합니다.`;
    }

    const outflow = summary.match(/CEX outflow spike:\s*\$([\d,.]+)/i);
    if (outflow) {
      return `거래소에서 약 $${outflow[1]} 규모의 자금 유출이 감지되었습니다. 보관 지갑 이동 또는 매도 압력 완화 가능성을 함께 봅니다.`;
    }

    return summary;
  }

  return `${ruleLabel(row.rule)}가 감지되었습니다.`;
}

export function humanizeSignal(row: DisplaySignalRow) {
  return {
    ...row,
    title: ruleLabel(row.rule),
    summary: humanizeSignalSummary(row),
    confidenceLabel: humanizeConfidence(row.confidence),
    severityLabel: humanizeSeverity(row.severity),
    sourceLabel: humanizeSource(row.source),
    tone: toneForSeverity(row.severity),
  };
}

export function humanizeTransaction(row: DisplayTransactionRow) {
  const from = shortAddressLabel(row.from);
  const to = shortAddressLabel(row.to);
  const amount = formatAmount(row.amount);
  const valueSummary = row.amountUsd > 0 ? `${formatUsd(row.amountUsd)} 규모` : "USD 환산값 없음";
  const chain = humanizeChain(row.chain);
  const direction = row.direction?.trim();
  const directionLabel =
    direction ||
    (row.to.toLowerCase().includes("exchange")
      ? "거래소 유입"
      : row.from.toLowerCase().includes("exchange")
        ? "거래소 유출"
        : "지갑 이동");

  return {
    ...row,
    headline: `${row.symbol} ${amount}개가 ${from}에서 ${to}로 이동했습니다.`,
    summary: `${valueSummary} · ${chain} · ${directionLabel}`,
    fromLabel: from,
    toLabel: to,
    chainLabel: chain,
    hashLabel: shortHashLabel(row.hash),
  };
}

export function humanizeLogMessage(message: string, status: string): string {
  const trimmed = message.trim();

  if (/completed_with_errors/i.test(status)) {
    return trimmed || "실행은 완료됐지만 확인할 경고가 있습니다.";
  }
  if (/failed/i.test(status)) {
    return trimmed || "실행에 실패했습니다.";
  }

  const telegramMatch = trimmed.match(/sent=(\d+).*failed=(\d+).*blocked=(\d+)/i);
  if (telegramMatch) {
    const [, sent, failed, blocked] = telegramMatch;
    return `Telegram 브리핑 ${sent}건 발송 완료, 실패 ${failed}건, 차단 ${blocked}건.`;
  }

  if (/price.*unknown/i.test(trimmed)) {
    return "일부 자산의 가격을 찾지 못했습니다. USD 환산이 제한될 수 있습니다.";
  }

  if (/google sheets/i.test(trimmed) && /connect/i.test(trimmed)) {
    return "Google Sheets 연결이 확인되었습니다.";
  }

  if (/missing/i.test(trimmed) && /env/i.test(trimmed)) {
    return "필수 환경 변수가 누락되었습니다.";
  }

  if (/no_brief_generated/i.test(trimmed)) {
    return "이번 실행에서는 발송 가능한 브리핑이 생성되지 않았습니다.";
  }

  return trimmed.replace(/[_]+/g, " ");
}

export function humanizeLogTitle(title: string, status: string): string {
  const value = title.toLowerCase();

  if (value.includes("daily_brief")) {
    return "일일 브리핑 발송";
  }
  if (value.includes("price_unknown_symbols")) {
    return "가격 보강 경고";
  }
  if (value.includes("latest pipeline")) {
    return "최근 파이프라인 실행";
  }
  if (value.includes("system event")) {
    return humanizeLatestRunStatus(status);
  }
  return title.replace(/[_-]+/g, " ") || humanizeLatestRunStatus(status);
}

export function humanizeLog(row: DisplaySystemLogRow) {
  return {
    ...row,
    title: humanizeLogTitle(row.title, row.status),
    message: humanizeLogMessage(row.message, row.status),
    statusLabel: humanizeLatestRunStatus(row.status),
    tone: toneForStatus(row.status),
  };
}

// ---------- UI glyph helpers ----------

export function iconToneClass(tone: string): string {
  if (tone === "good") return "service-card__icon--good";
  if (tone === "bad") return "service-card__icon--bad";
  if (tone === "warn") return "service-card__icon--warn";
  return "service-card__icon--neutral";
}

export function badgeToneClass(tone: string): string {
  if (tone === "good") return "service-card__status-badge--good";
  if (tone === "bad") return "service-card__status-badge--bad";
  if (tone === "warn") return "service-card__status-badge--warn";
  return "service-card__status-badge--neutral";
}

export function chainIconName(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes("eth")) return "currency_exchange";
  if (c.includes("btc") || c.includes("bitcoin")) return "currency_bitcoin";
  if (c.includes("sol")) return "token";
  return "monetization_on";
}

export function chainIconColor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes("eth")) return "var(--accent)";
  if (c.includes("btc") || c.includes("bitcoin")) return "#ea580c";
  if (c.includes("sol")) return "#7c3aed";
  return "#0d9488";
}
