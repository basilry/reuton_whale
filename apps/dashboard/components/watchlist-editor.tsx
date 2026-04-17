"use client";

import { useEffect, useState } from "react";

export type WatchlistEntry = {
  address: string;
  chain: string;
  label: string;
  enabled: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entries: WatchlistEntry[] };

export function WatchlistEditor() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);

  // Fetch on mount only. Empty deps + abort signal ⇒ no re-run loops.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/watchlist", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`watchlist fetch failed: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        const entries: WatchlistEntry[] = Array.isArray(data?.addresses) ? data.addresses : [];
        setState({ kind: "ready", entries });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        setState({ kind: "error", message });
      });
    return () => controller.abort();
  }, []);

  async function toggleAddress(address: string, enabled: boolean) {
    if (pendingAddress === address) return;
    setPendingAddress(address);

    // Optimistic update: flip immediately, revert on failure.
    setState((prev) =>
      prev.kind === "ready"
        ? {
            kind: "ready",
            entries: prev.entries.map((entry) =>
              entry.address === address ? { ...entry, enabled } : entry,
            ),
          }
        : prev,
    );

    try {
      const res = await fetch("/api/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, enabled }),
      });
      if (!res.ok) {
        // Revert on error.
        setState((prev) =>
          prev.kind === "ready"
            ? {
                kind: "ready",
                entries: prev.entries.map((entry) =>
                  entry.address === address ? { ...entry, enabled: !enabled } : entry,
                ),
              }
            : prev,
        );
      }
    } catch {
      setState((prev) =>
        prev.kind === "ready"
          ? {
              kind: "ready",
              entries: prev.entries.map((entry) =>
                entry.address === address ? { ...entry, enabled: !enabled } : entry,
              ),
            }
          : prev,
      );
    } finally {
      setPendingAddress(null);
    }
  }

  if (state.kind === "loading") {
    return <p className="watchlist-editor__hint">감시 주소를 불러오는 중...</p>;
  }
  if (state.kind === "error") {
    return <p className="watchlist-editor__hint">감시 주소를 불러오지 못했습니다. ({state.message})</p>;
  }

  if (state.entries.length === 0) {
    return <p className="watchlist-editor__hint">등록된 감시 주소가 없습니다.</p>;
  }

  return (
    <ul className="watchlist-editor__list" aria-label="감시 주소 목록">
      {state.entries.map((entry) => (
        <li key={entry.address} className="watchlist-editor__row">
          <div className="watchlist-editor__meta">
            <span className="watchlist-editor__label">{entry.label}</span>
            <span className="watchlist-editor__chain">{entry.chain}</span>
            <span className="watchlist-editor__address" title={entry.address}>
              {entry.address.length > 18
                ? `${entry.address.slice(0, 8)}…${entry.address.slice(-6)}`
                : entry.address}
            </span>
          </div>
          <button
            type="button"
            className={`watchlist-editor__toggle ${entry.enabled ? "watchlist-editor__toggle--on" : "watchlist-editor__toggle--off"}`}
            onClick={() => toggleAddress(entry.address, !entry.enabled)}
            disabled={pendingAddress === entry.address}
            aria-pressed={entry.enabled}
          >
            {pendingAddress === entry.address
              ? "저장 중..."
              : entry.enabled
                ? "활성화"
                : "비활성화"}
          </button>
        </li>
      ))}
    </ul>
  );
}
