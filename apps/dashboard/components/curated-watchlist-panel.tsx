"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import type { DashboardLanguage } from "@/lib/i18n/config";
import { useDashboardI18n } from "@/lib/i18n/client";
import type { CuratedWatchlistItem } from "@/lib/types";

const loadCuratedWalletDetailModal = () =>
  import("@/components/curated-wallet-detail-modal").then((mod) => mod.CuratedWalletDetailModal);

const CuratedWalletDetailModal = dynamic(loadCuratedWalletDetailModal, {
  ssr: false,
  loading: () => null,
});

type CuratedWatchlistPanelProps = {
  items: CuratedWatchlistItem[];
  initialLanguage: DashboardLanguage;
  title?: string;
  lead?: string;
  emptyTitle?: string;
  emptyBody?: string;
  collapsedCount?: number;
};

const panelStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const itemListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const itemButtonStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "16px",
  borderRadius: "20px",
  border: "1px solid var(--line)",
  background: "color-mix(in srgb, white 88%, var(--surface-2, #f3f8fc))",
  textAlign: "left",
  cursor: "pointer",
};

const itemCopyStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  minWidth: 0,
};

const avatarStyle: CSSProperties = {
  minWidth: "48px",
  height: "32px",
  padding: "0 10px",
  borderRadius: "999px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "0.04em",
  background: "color-mix(in srgb, var(--accent-soft, #d9f0ff) 65%, white)",
  color: "var(--accent-strong, #0f6db5)",
  flexShrink: 0,
};

const badgeStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "999px",
  background: "color-mix(in srgb, var(--surface-2, #f3f8fc) 72%, white)",
  color: "var(--on-surface, #09253a)",
  fontSize: "12px",
  fontWeight: 700,
  flexShrink: 0,
};

function humanizeChain(chain: string, language: DashboardLanguage): string {
  switch (chain.toLowerCase()) {
    case "ethereum":
      return "Ethereum";
    case "bitcoin":
      return "Bitcoin";
    case "tron":
      return "TRON";
    case "solana":
      return "Solana";
    default:
      return language === "ko" ? "멀티체인" : "Multi-chain";
  }
}

export function CuratedWatchlistPanel({
  items,
  initialLanguage,
  title,
  lead,
  emptyTitle,
  emptyBody,
  collapsedCount = 4,
}: CuratedWatchlistPanelProps) {
  const { dictionary, language } = useDashboardI18n(initialLanguage);
  const [selectedItem, setSelectedItem] = useState<CuratedWatchlistItem | null>(null);
  const primaryItems = items.slice(0, collapsedCount);
  const overflowItems = items.slice(collapsedCount);
  const selectedWalletKey = selectedItem?.entityId ?? selectedItem?.id ?? selectedItem?.address ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || items.length === 0) return;
    const schedule =
      (window as typeof window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));
    const handle = schedule(() => {
      loadCuratedWalletDetailModal().catch(() => undefined);
    });
    return () => {
      const cancel =
        (window as typeof window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback ??
        window.clearTimeout;
      cancel(handle as number);
    };
  }, [items.length]);

  const copy = useMemo(
    () =>
      language === "ko"
        ? {
            expand: `지갑 ${overflowItems.length}개 더 보기`,
            detailCta: "상세 보기",
          }
        : {
            expand: `Show ${overflowItems.length} more wallets`,
            detailCta: "Open detail",
          },
    [language, overflowItems.length],
  );

  const renderItems = (watchlist: CuratedWatchlistItem[]) =>
    watchlist.map((item) => {
      const isHighlight = item.tone === "critical" || item.relatedSignalCount > 0;
      const symbolLabel = item.symbol.slice(0, 4).toUpperCase();

      return (
        <button
          key={item.id}
          type="button"
          style={{
            ...itemButtonStyle,
            borderColor: isHighlight ? "var(--accent-strong, #0f6db5)" : "var(--line)",
          }}
          onClick={() => setSelectedItem(item)}
          onPointerEnter={() => loadCuratedWalletDetailModal().catch(() => undefined)}
          onFocus={() => loadCuratedWalletDetailModal().catch(() => undefined)}
          onTouchStart={() => loadCuratedWalletDetailModal().catch(() => undefined)}
          aria-label={`${item.title} ${humanizeChain(item.chain, language)} ${copy.detailCta}`}
        >
          <div style={itemCopyStyle}>
            <div style={avatarStyle} aria-hidden="true">{symbolLabel}</div>
            <div style={{ minWidth: 0, display: "grid", gap: "2px" }}>
              <p
                style={{
                  margin: 0,
                  fontWeight: 700,
                  color: "var(--on-surface)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.title}
              </p>
              <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "12px" }}>
                {humanizeChain(item.chain, language)}
              </p>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <span style={badgeStyle}>{item.badge}</span>
            <span style={{ ...badgeStyle, background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
              {copy.detailCta}
            </span>
          </div>
        </button>
      );
    });

  return (
    <section style={panelStyle}>
      <div style={{ display: "grid", gap: "6px" }}>
        <h3 style={{ margin: 0, color: "var(--on-surface)" }}>
          {title ?? dictionary.home.watchlistTitle}
        </h3>
        <p style={{ margin: 0, color: "var(--on-surface-variant)" }}>
          {lead ?? dictionary.home.watchlistLead}
        </p>
      </div>

      {items.length > 0 ? (
        <>
          <div style={itemListStyle}>{renderItems(primaryItems)}</div>
          {overflowItems.length > 0 ? (
            <details
              style={{
                borderTop: "1px solid var(--line)",
                paddingTop: "14px",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  color: "var(--accent-strong, #0f6db5)",
                  fontWeight: 700,
                }}
              >
                {copy.expand}
              </summary>
              <div style={{ ...itemListStyle, marginTop: "12px" }}>{renderItems(overflowItems)}</div>
            </details>
          ) : null}
        </>
      ) : (
        <article
          style={{
            display: "grid",
            gap: "8px",
            padding: "18px",
            borderRadius: "20px",
            border: "1px dashed var(--line)",
            background: "color-mix(in srgb, white 90%, var(--surface-2, #f3f8fc))",
          }}
        >
          <h4 style={{ margin: 0, color: "var(--on-surface)" }}>
            {emptyTitle ?? dictionary.curated.emptyTitle}
          </h4>
          <p style={{ margin: 0, color: "var(--on-surface-variant)" }}>
            {emptyBody ?? dictionary.curated.emptyBody}
          </p>
        </article>
      )}

      <CuratedWalletDetailModal
        walletKey={selectedWalletKey}
        fallbackTitle={selectedItem?.title}
        initialLanguage={initialLanguage}
        isOpen={selectedItem != null}
        onClose={() => setSelectedItem(null)}
      />
    </section>
  );
}
