export const LIVE_UPDATE_POLL_INTERVAL_MS = 5_000;
export const LIVE_UPDATE_HEARTBEAT_INTERVAL_MS = 15_000;

export const LIVE_UPDATE_SECTIONS = [
  "brief",
  "news",
  "watchlist",
  "stories",
] as const;

export type LiveUpdateSection = (typeof LIVE_UPDATE_SECTIONS)[number];

export type LiveUpdateStatusReason =
  | "feature_disabled"
  | "not_configured";

export type LiveUpdateStatusEvent = {
  state: "enabled" | "disabled";
  reason?: LiveUpdateStatusReason;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  sections: LiveUpdateSection[];
};

export type LiveUpdateEvent = {
  section: LiveUpdateSection;
  kind: LiveUpdateSection;
  ts: string;
  version: string;
  meta?: Record<string, string | number | boolean>;
};

export type LiveUpdateStatusInput = {
  enabled: boolean;
  configured: boolean;
};

export function liveUpdateTimestampValue(update: LiveUpdateEvent): number {
  const parsed = Date.parse(update.ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function getLiveUpdateStatus(
  input: LiveUpdateStatusInput,
): LiveUpdateStatusEvent {
  if (!input.enabled) {
    return {
      state: "disabled",
      reason: "feature_disabled",
      pollIntervalMs: LIVE_UPDATE_POLL_INTERVAL_MS,
      heartbeatIntervalMs: LIVE_UPDATE_HEARTBEAT_INTERVAL_MS,
      sections: [...LIVE_UPDATE_SECTIONS],
    };
  }

  if (!input.configured) {
    return {
      state: "disabled",
      reason: "not_configured",
      pollIntervalMs: LIVE_UPDATE_POLL_INTERVAL_MS,
      heartbeatIntervalMs: LIVE_UPDATE_HEARTBEAT_INTERVAL_MS,
      sections: [...LIVE_UPDATE_SECTIONS],
    };
  }

  return {
    state: "enabled",
    pollIntervalMs: LIVE_UPDATE_POLL_INTERVAL_MS,
    heartbeatIntervalMs: LIVE_UPDATE_HEARTBEAT_INTERVAL_MS,
    sections: [...LIVE_UPDATE_SECTIONS],
  };
}
