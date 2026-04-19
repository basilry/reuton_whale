"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { LiveUpdatesStatus } from "./live-updates-status";

type LiveUpdatesControllerProps = {
  chipClassName: string;
  dotClassName: string;
  language: "ko" | "en";
};

type LiveUpdateStatus = "connected" | "reconnecting" | "offline";
type LiveUpdateKind = "brief" | "news" | "watchlist" | "stories";

type StreamPayload = {
  event?: string;
  kind?: string;
  type?: string;
  eventId?: string;
  publishedAt?: string;
};

type StreamStatusPayload = StreamPayload & {
  state?: "enabled" | "disabled";
  reason?: "feature_disabled" | "redis_missing" | "token_missing";
};

type LiveUpdatesConnectionState = {
  status: LiveUpdateStatus;
  detail: string;
  receivedAt: number | null;
  latencyMs: number | null;
  reconnectCount: number;
  lastErrorAt: number | null;
  lastEventId: string | null;
};

const STREAM_PATH = "/api/stream";
const REFRESHABLE_KINDS = new Set<LiveUpdateKind>(["brief", "news", "watchlist", "stories"]);
const KIND_ALIASES: Record<string, LiveUpdateKind | null> = {
  brief: "brief",
  briefing: "brief",
  news: "news",
  watchlist: "watchlist",
  curated_watchlist: "watchlist",
  story: "stories",
  stories: "stories",
  whale_story: "stories",
};
const MIN_REFRESH_INTERVAL_MS = 8_000;
const REFRESH_DEBOUNCE_MS = 1_500;
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

function parseStreamPayload(rawData: string): StreamPayload | null {
  try {
    const parsed = JSON.parse(rawData) as StreamPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeKind(eventType: string, payload: StreamPayload | null): LiveUpdateKind | null {
  const eventKey = eventType.trim().toLowerCase();
  if (eventKey && eventKey !== "message") {
    return KIND_ALIASES[eventKey] ?? null;
  }

  const payloadKey = String(payload?.kind ?? payload?.type ?? payload?.event ?? "")
    .trim()
    .toLowerCase();
  return KIND_ALIASES[payloadKey] ?? null;
}

function formatTime(language: "ko" | "en", value: number): string {
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function formatRelativeTime(lastUpdatedMs: number, nowMs: number, language: "ko" | "en"): string {
  const diffSec = Math.max(0, Math.floor((nowMs - lastUpdatedMs) / 1000));
  if (language === "ko") {
    if (diffSec < 5) return "방금 전";
    if (diffSec < 60) return `${diffSec}초 전`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}분 전`;
    return `${Math.floor(diffMin / 60)}시간 전`;
  }
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

function getCopy(language: "ko" | "en") {
  if (language === "ko") {
    return {
      ariaLabel: "실시간 업데이트 연결 상태",
      labels: {
        connected: "실시간 연결됨",
        reconnecting: "재연결 중",
        offline: "오프라인",
      },
      details: {
        connectedIdle: "브리핑, 뉴스, 감시 지갑, 고래 스토리 변경을 자동 반영합니다.",
        connectedEvent: (kind: LiveUpdateKind, receivedAt: number) =>
          `${humanizeKind(kind, language)} 이벤트 수신 · ${formatTime(language, receivedAt)}에 새로고침 예약`,
        reconnecting: (seconds: number) => `${seconds}초 후 스트림 재연결을 시도합니다.`,
        hidden: "백그라운드 탭에서는 실시간 연결을 잠시 멈춥니다.",
        offline: "네트워크 또는 스트림 연결이 오프라인 상태입니다.",
        unsupported: "이 브라우저는 EventSource를 지원하지 않습니다.",
        featureDisabled: "실시간 자동 새로고침 기능이 현재 비활성화되어 있습니다.",
        redisMissing: "실시간 자동 새로고침에 필요한 Redis REST URL이 설정되지 않았습니다.",
        tokenMissing: "실시간 자동 새로고침에 필요한 Redis REST 토큰이 설정되지 않았습니다.",
      },
    };
  }

  return {
    ariaLabel: "Live update connection status",
    labels: {
      connected: "Live connected",
      reconnecting: "Reconnecting",
      offline: "Offline",
    },
    details: {
      connectedIdle: "Auto-refreshes brief, news, watchlist, and whale stories when new events arrive.",
      connectedEvent: (kind: LiveUpdateKind, receivedAt: number) =>
        `${humanizeKind(kind, language)} event received · refresh scheduled at ${formatTime(language, receivedAt)}`,
      reconnecting: (seconds: number) => `Retrying the stream in ${seconds}s.`,
      hidden: "The tab is in the background, so the live stream is paused.",
      offline: "The network or stream connection is offline.",
      unsupported: "This browser does not support EventSource.",
      featureDisabled: "Live auto-refresh is currently disabled.",
      redisMissing: "Live auto-refresh is missing the Redis REST URL.",
      tokenMissing: "Live auto-refresh is missing the Redis REST token.",
    },
  };
}

function humanizeKind(kind: LiveUpdateKind, language: "ko" | "en"): string {
  if (language === "ko") {
    if (kind === "brief") {
      return "브리핑";
    }
    if (kind === "news") {
      return "뉴스";
    }
    if (kind === "watchlist") {
      return "감시 지갑";
    }
    return "고래 스토리";
  }

  if (kind === "brief") {
    return "Brief";
  }
  if (kind === "news") {
    return "News";
  }
  if (kind === "watchlist") {
    return "Watchlist";
  }
  return "Stories";
}

function detailForStatusReason(
  copy: ReturnType<typeof getCopy>,
  reason?: StreamStatusPayload["reason"],
): string {
  if (reason === "feature_disabled") {
    return copy.details.featureDisabled;
  }

  if (reason === "redis_missing") {
    return copy.details.redisMissing;
  }

  if (reason === "token_missing") {
    return copy.details.tokenMissing;
  }

  return copy.details.offline;
}

function parseTimestamp(value?: string): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function initialConnectionState(
  copy: ReturnType<typeof getCopy>,
): LiveUpdatesConnectionState {
  return {
    status: "reconnecting",
    detail: copy.details.reconnecting(1),
    receivedAt: null,
    latencyMs: null,
    reconnectCount: 0,
    lastErrorAt: null,
    lastEventId: null,
  };
}

export function LiveUpdatesController({
  chipClassName,
  dotClassName,
  language,
}: LiveUpdatesControllerProps) {
  const router = useRouter();
  const copy = getCopy(language);
  const [connection, setConnection] = useState<LiveUpdatesConnectionState>(() =>
    initialConnectionState(copy),
  );
  const [now, setNow] = useState(() => Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pendingRefreshRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const visibleRef = useRef(true);
  const onlineRef = useRef(true);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const effectCopy = getCopy(language);

    const patchConnection = (patch: Partial<LiveUpdatesConnectionState>) => {
      setConnection((current) => ({
        ...current,
        ...patch,
      }));
    };

    const recordIncomingEvent = (event: MessageEvent<string>) => {
      const payload = parseStreamPayload(event.data);
      const receivedAt = Date.now();
      const publishedAt = parseTimestamp(payload?.publishedAt);
      const lastEventId =
        event.lastEventId.trim() ||
        (typeof payload?.eventId === "string" ? payload.eventId.trim() : "") ||
        null;

      setConnection((current) => ({
        ...current,
        receivedAt,
        latencyMs: publishedAt == null ? null : Math.max(0, receivedAt - publishedAt),
        lastEventId: lastEventId ?? current.lastEventId,
      }));

      return {
        payload,
        receivedAt,
      };
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearRefreshTimer = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    const closeStream = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.onopen = null;
        eventSourceRef.current.onerror = null;
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const requestRefresh = (kind: LiveUpdateKind, receivedAt: number) => {
      pendingRefreshRef.current = true;
      patchConnection({
        status: "connected",
        detail: effectCopy.details.connectedEvent(kind, receivedAt),
      });

      if (!visibleRef.current || !onlineRef.current) {
        return;
      }

      if (refreshTimerRef.current !== null) {
        return;
      }

      const elapsed = Date.now() - lastRefreshAtRef.current;
      const waitMs =
        elapsed >= MIN_REFRESH_INTERVAL_MS
          ? REFRESH_DEBOUNCE_MS
          : Math.max(REFRESH_DEBOUNCE_MS, MIN_REFRESH_INTERVAL_MS - elapsed);

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;

        if (!visibleRef.current || !onlineRef.current) {
          pendingRefreshRef.current = true;
          return;
        }

        pendingRefreshRef.current = false;
        lastRefreshAtRef.current = Date.now();
        router.refresh();
      }, waitMs);
    };

    const connect = () => {
      clearReconnectTimer();
      closeStream();

      if (!("EventSource" in window)) {
        patchConnection({
          status: "offline",
          detail: effectCopy.details.unsupported,
        });
        return;
      }

      if (!visibleRef.current) {
        patchConnection({
          status: "offline",
          detail: effectCopy.details.hidden,
        });
        return;
      }

      if (!onlineRef.current) {
        patchConnection({
          status: "offline",
          detail: effectCopy.details.offline,
        });
        return;
      }

      const source = new EventSource(STREAM_PATH);
      eventSourceRef.current = source;
      patchConnection({
        status: "reconnecting",
        detail: effectCopy.details.reconnecting(1),
      });

      const handleIncoming = (eventType: string, event: MessageEvent<string>) => {
        const { payload, receivedAt } = recordIncomingEvent(event);
        const kind = normalizeKind(eventType, payload);
        if (!kind || !REFRESHABLE_KINDS.has(kind)) {
          return;
        }
        requestRefresh(kind, receivedAt);
      };

      source.onopen = () => {
        reconnectAttemptRef.current = 0;
        patchConnection({
          status: "connected",
          detail: effectCopy.details.connectedIdle,
        });
        if (pendingRefreshRef.current) {
          requestRefresh("brief", Date.now());
        }
      };

      source.onerror = () => {
        closeStream();

        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay =
          RECONNECT_BACKOFF_MS[Math.min(attempt - 1, RECONNECT_BACKOFF_MS.length - 1)];
        const nextStatus = attempt >= 3 ? "offline" : "reconnecting";
        const lastErrorAt = Date.now();

        setConnection((current) => ({
          ...current,
          status: nextStatus,
          detail:
            visibleRef.current && onlineRef.current
              ? effectCopy.details.reconnecting(Math.round(delay / 1000))
              : effectCopy.details.offline,
          reconnectCount: current.reconnectCount + 1,
          lastErrorAt,
        }));

        if (!visibleRef.current || !onlineRef.current) {
          return;
        }

        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
      };

      source.onmessage = (event) => {
        handleIncoming("message", event);
      };

      source.addEventListener("brief", (event) => {
        handleIncoming("brief", event as MessageEvent<string>);
      });
      source.addEventListener("news", (event) => {
        handleIncoming("news", event as MessageEvent<string>);
      });
      source.addEventListener("watchlist", (event) => {
        handleIncoming("watchlist", event as MessageEvent<string>);
      });
      source.addEventListener("stories", (event) => {
        handleIncoming("stories", event as MessageEvent<string>);
      });
      source.addEventListener("whale_story", (event) => {
        handleIncoming("whale_story", event as MessageEvent<string>);
      });
      source.addEventListener("heartbeat", (event) => {
        recordIncomingEvent(event as MessageEvent<string>);
      });
      source.addEventListener("status", (event) => {
        const { payload } = recordIncomingEvent(event as MessageEvent<string>);
        const statusPayload = payload as StreamStatusPayload | null;

        if (statusPayload?.state === "disabled") {
          patchConnection({
            status: "offline",
            detail: detailForStatusReason(effectCopy, statusPayload.reason),
          });
          return;
        }

        if (statusPayload?.state === "enabled") {
          patchConnection({
            status: "connected",
            detail: effectCopy.details.connectedIdle,
          });
        }
      });
    };

    const handleVisibilityChange = () => {
      visibleRef.current = !document.hidden;

      if (visibleRef.current) {
        connect();
        if (pendingRefreshRef.current) {
          requestRefresh("brief", Date.now());
        }
        return;
      }

      clearReconnectTimer();
      clearRefreshTimer();
      closeStream();
      patchConnection({
        status: "offline",
        detail: effectCopy.details.hidden,
      });
    };

    const handleOnline = () => {
      onlineRef.current = true;
      connect();
    };

    const handleOffline = () => {
      onlineRef.current = false;
      clearReconnectTimer();
      clearRefreshTimer();
      closeStream();
      patchConnection({
        status: "offline",
        detail: effectCopy.details.offline,
      });
    };

    visibleRef.current = !document.hidden;
    onlineRef.current = navigator.onLine;

    if (onlineRef.current && visibleRef.current) {
      connect();
    } else {
      patchConnection({
        status: "offline",
        detail: visibleRef.current ? effectCopy.details.offline : effectCopy.details.hidden,
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearReconnectTimer();
      clearRefreshTimer();
      closeStream();
    };
  }, [language, router]);

  const tone =
    connection.status === "connected"
      ? "good"
      : connection.status === "reconnecting"
        ? "warn"
        : "bad";
  const label = copy.labels[connection.status];

  const displayDetail =
    connection.receivedAt != null && connection.status === "connected"
      ? `${connection.detail} · ${
          language === "ko"
            ? `${formatRelativeTime(connection.receivedAt, now, language)} 업데이트`
            : `Updated ${formatRelativeTime(connection.receivedAt, now, language)}`
        }`
      : connection.detail;

  return (
    <LiveUpdatesStatus
      ariaLabel={copy.ariaLabel}
      chipClassName={chipClassName}
      dotClassName={dotClassName}
      label={label}
      title={displayDetail}
      tone={tone}
    />
  );
}
