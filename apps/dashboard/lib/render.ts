import "server-only";

import { unstable_cache } from "next/cache";

import { getRenderEnvState, type RenderServiceEnvMap } from "./env";
import { compactString, parseDateTimeSafe } from "./format";
import type {
  AdminRenderDeploy,
  AdminRenderEndpointError,
  AdminRenderInstance,
  AdminRenderLogLine,
  AdminRenderObservability,
  AdminRenderService,
  RenderApiError,
  RenderDeployStatus,
  RenderInstanceState,
  RenderLogLevel,
  RenderLogType,
  RenderServiceKey,
  RenderServiceStatus,
  RenderServiceType,
} from "./types";

const RENDER_API_BASE = "https://api.render.com/v1";
const RENDER_USER_AGENT = "whalescope-admin/1.0";
const RENDER_DEFAULT_TIMEOUT_MS = 5_000;
const RENDER_LOG_TIMEOUT_MS = 10_000;
const RENDER_DEPLOY_LIMIT = 3;
const RENDER_MAX_ATTEMPTS = 3;
const RENDER_LOG_CACHE_BUCKET_MS = 15_000;
export const RENDER_LOG_WINDOW_MINUTES = 15;
export const RENDER_LOG_LIMIT = 50;

type RawRecord = Record<string, unknown>;

type RawServiceEnvelope = {
  service?: RawRecord;
};

type RawDeployEnvelope = {
  deploy?: RawRecord;
};

type RawInstanceEnvelope = {
  instance?: RawRecord;
};

type RawLogsResponse = {
  logs?: unknown[];
};

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function takeText(value: unknown, maxLength: number): string | undefined {
  const text = textValue(value);

  if (!text) {
    return undefined;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function recordText(record: RawRecord | null | undefined, key: string): string {
  return record ? textValue(record[key]) : "";
}

function nestedRecord(record: RawRecord | null | undefined, key: string): RawRecord | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return isRecord(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => textValue(item))
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildInternalErrorId(): string {
  return `render_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRenderApiError(error: unknown): error is RenderApiError {
  if (!isRecord(error)) {
    return false;
  }

  return typeof error.code === "string";
}

function toRenderApiError(error: unknown): RenderApiError {
  if (isRenderApiError(error)) {
    return error;
  }

  return {
    code: "internal",
    errId: buildInternalErrorId(),
  };
}

function requireRenderEnv(): {
  apiKey: string;
  ownerId: string;
  serviceIds: RenderServiceEnvMap;
} {
  const state = getRenderEnvState();

  if (
    !state.configured ||
    !state.apiKey ||
    !state.ownerId ||
    !state.serviceIds.pipeline ||
    !state.serviceIds.listener ||
    !state.serviceIds.bot
  ) {
    throw {
      code: "config_missing",
      missingEnv: state.missingEnv,
    } satisfies RenderApiError;
  }

  return {
    apiKey: state.apiKey,
    ownerId: state.ownerId,
    serviceIds: {
      pipeline: state.serviceIds.pipeline,
      listener: state.serviceIds.listener,
      bot: state.serviceIds.bot,
    },
  };
}

function shouldRetry(error: RenderApiError, attempt: number): boolean {
  if (attempt >= RENDER_MAX_ATTEMPTS) {
    return false;
  }

  return (
    error.code === "rate_limited" ||
    error.code === "network" ||
    error.code === "timeout" ||
    error.code === "upstream"
  );
}

function retryDelayMs(error: RenderApiError, attempt: number): number {
  if (error.code === "rate_limited" && error.retryAfterMs != null && error.retryAfterMs > 0) {
    return Math.min(error.retryAfterMs, 30_000);
  }

  return Math.min(2 ** (attempt - 1) * 1_000, 30_000);
}

async function renderFetch<T>(
  path: string,
  options?: {
    timeoutMs?: number;
  },
): Promise<T> {
  const env = requireRenderEnv();
  const timeoutMs = options?.timeoutMs ?? RENDER_DEFAULT_TIMEOUT_MS;
  const url = `${RENDER_API_BASE}${path}`;

  for (let attempt = 1; attempt <= RENDER_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${env.apiKey}`,
          "User-Agent": RENDER_USER_AGENT,
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw { code: "auth_failed" } satisfies RenderApiError;
      }

      if (response.status === 403) {
        throw { code: "forbidden" } satisfies RenderApiError;
      }

      if (response.status === 404) {
        throw { code: "not_found", resource: path } satisfies RenderApiError;
      }

      if (response.status === 429) {
        const retryAfterHeader = compactString(response.headers.get("retry-after"));
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
        throw {
          code: "rate_limited",
          retryAfterMs: Number.isFinite(retryAfterSeconds)
            ? Math.max(0, retryAfterSeconds * 1_000)
            : undefined,
        } satisfies RenderApiError;
      }

      if (response.status >= 500) {
        throw {
          code: "upstream",
          httpStatus: response.status,
        } satisfies RenderApiError;
      }

      if (!response.ok) {
        throw {
          code: "bad_request",
          detail: takeText(await response.text().catch(() => ""), 200) ?? response.statusText,
        } satisfies RenderApiError;
      }

      return (await response.json()) as T;
    } catch (error) {
      const normalizedError =
        error instanceof Error && error.name === "AbortError"
          ? ({
              code: "timeout",
              afterMs: timeoutMs,
            } satisfies RenderApiError)
          : isRenderApiError(error)
            ? error
            : ({
                code: "network",
                cause: error instanceof Error ? error.message : String(error),
              } satisfies RenderApiError);

      if (!shouldRetry(normalizedError, attempt)) {
        throw normalizedError;
      }

      await sleep(retryDelayMs(normalizedError, attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw {
    code: "internal",
    errId: buildInternalErrorId(),
  } satisfies RenderApiError;
}

function mapRenderServiceType(rawType: string): RenderServiceType {
  switch (rawType.toLowerCase()) {
    case "cron_job":
      return "cron";
    case "background_worker":
      return "worker";
    case "web_service":
      return "web";
    case "private_service":
      return "private";
    default:
      return "unknown";
  }
}

function mapDeployStatus(rawStatus: string): RenderDeployStatus {
  switch (rawStatus.toLowerCase()) {
    case "live":
      return "live";
    case "created":
    case "build_in_progress":
    case "update_in_progress":
    case "pre_deploy_in_progress":
      return "deploying";
    case "build_failed":
    case "update_failed":
    case "pre_deploy_failed":
      return "failed";
    case "canceled":
    case "deactivated":
      return "inactive";
    default:
      return "inactive";
  }
}

function mapInstanceState(rawState: string): RenderInstanceState {
  switch (rawState.toLowerCase()) {
    case "starting":
    case "running":
    case "stopped":
    case "failed":
    case "succeeded":
      return rawState.toLowerCase() as RenderInstanceState;
    default:
      return "unknown";
  }
}

function mapLogLevel(rawLevel: string): RenderLogLevel {
  switch (rawLevel.toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return rawLevel.toLowerCase() as RenderLogLevel;
    case "warning":
      return "warn";
    default:
      return "unknown";
  }
}

function mapLogType(rawType: string): RenderLogType | undefined {
  switch (rawType.toLowerCase()) {
    case "app":
    case "build":
    case "system":
      return rawType.toLowerCase() as RenderLogType;
    default:
      return undefined;
  }
}

function mapService(rawService: RawRecord): AdminRenderService {
  const suspenders = toStringArray(rawService.suspenders);
  const serviceDetails = nestedRecord(rawService, "serviceDetails");
  const suspended = recordText(rawService, "suspended");
  const suspendedStatus: RenderServiceStatus =
    suspended && suspended !== "not_suspended"
      ? { kind: "suspended", suspenders: suspenders.length > 0 ? suspenders : [suspended] }
      : suspenders.length > 0
        ? { kind: "suspended", suspenders }
        : { kind: "unknown" };

  return {
    id: recordText(rawService, "id"),
    name: recordText(rawService, "name") || recordText(rawService, "slug") || "render-service",
    type: mapRenderServiceType(recordText(rawService, "type")),
    status: suspendedStatus,
    schedule: recordText(serviceDetails, "schedule") || undefined,
    createdAt: recordText(rawService, "createdAt") || undefined,
    updatedAt: recordText(rawService, "updatedAt") || undefined,
  };
}

function durationMs(startedAt: string | undefined, finishedAt: string | undefined): number | undefined {
  const startedAtMs = startedAt ? parseDateTimeSafe(startedAt) : null;
  const finishedAtMs = finishedAt ? parseDateTimeSafe(finishedAt) : null;

  if (startedAtMs == null || finishedAtMs == null || finishedAtMs < startedAtMs) {
    return undefined;
  }

  return finishedAtMs - startedAtMs;
}

function mapDeploy(serviceId: string, rawDeploy: RawRecord): AdminRenderDeploy {
  const commit = nestedRecord(rawDeploy, "commit");
  const createdAt = recordText(rawDeploy, "createdAt") || new Date(0).toISOString();
  const startedAt = recordText(rawDeploy, "startedAt") || undefined;
  const finishedAt = recordText(rawDeploy, "finishedAt") || undefined;
  const rawStatus = recordText(rawDeploy, "status");

  return {
    serviceId,
    deployId: recordText(rawDeploy, "id") || `${serviceId}:deploy`,
    status: mapDeployStatus(rawStatus),
    rawStatus: rawStatus || "unknown",
    commitSha: recordText(commit, "id") || undefined,
    commitMessage: takeText(commit?.message, 80),
    trigger: recordText(rawDeploy, "trigger") || undefined,
    createdAt,
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
  };
}

function mapInstance(serviceId: string, rawInstance: RawRecord): AdminRenderInstance {
  return {
    serviceId,
    instanceId: recordText(rawInstance, "id") || `${serviceId}:instance`,
    state: mapInstanceState(recordText(rawInstance, "state")),
    startedAt: recordText(rawInstance, "startedAt") || undefined,
    finishedAt: recordText(rawInstance, "finishedAt") || undefined,
  };
}

function mapLogLine(rawLog: RawRecord): AdminRenderLogLine {
  const labels = nestedRecord(rawLog, "labels");

  return {
    serviceId: recordText(labels, "serviceId") || recordText(rawLog, "serviceId") || "unknown",
    serviceName:
      recordText(labels, "serviceName") ||
      recordText(rawLog, "serviceName") ||
      recordText(labels, "resource") ||
      "render-service",
    timestamp: recordText(rawLog, "timestamp") || new Date(0).toISOString(),
    level: mapLogLevel(recordText(rawLog, "level")),
    message: takeText(rawLog.message, 1_000) ?? "",
    instanceId: recordText(labels, "instanceId") || undefined,
    type: mapLogType(recordText(labels, "type")),
  };
}

function attachServiceStatus(
  service: AdminRenderService,
  deploys: AdminRenderDeploy[],
): AdminRenderService {
  const latestDeploy = [...deploys].sort((left, right) => {
    const leftTime =
      parseDateTimeSafe(left.createdAt) ??
      parseDateTimeSafe(left.startedAt ?? "") ??
      parseDateTimeSafe(left.finishedAt ?? "") ??
      0;
    const rightTime =
      parseDateTimeSafe(right.createdAt) ??
      parseDateTimeSafe(right.startedAt ?? "") ??
      parseDateTimeSafe(right.finishedAt ?? "") ??
      0;
    return rightTime - leftTime;
  })[0];

  if (!latestDeploy) {
    return service;
  }

  if (service.status.kind === "suspended") {
    return {
      ...service,
      lastDeployAt: latestDeploy.finishedAt || latestDeploy.startedAt || latestDeploy.createdAt,
      lastDeployStatus: latestDeploy.status,
      lastDeployId: latestDeploy.deployId,
    };
  }

  let status: RenderServiceStatus = { kind: "unknown" };
  if (latestDeploy.status === "live") {
    status = { kind: "live" };
  } else if (latestDeploy.status === "deploying") {
    status = {
      kind: "deploying",
      deployId: latestDeploy.deployId,
      startedAt: latestDeploy.startedAt || latestDeploy.createdAt,
    };
  } else if (latestDeploy.status === "failed") {
    status = {
      kind: "failed",
      deployId: latestDeploy.deployId,
      reason: latestDeploy.rawStatus,
    };
  }

  return {
    ...service,
    status,
    lastDeployAt: latestDeploy.finishedAt || latestDeploy.startedAt || latestDeploy.createdAt,
    lastDeployStatus: latestDeploy.status,
    lastDeployId: latestDeploy.deployId,
  };
}

function buildTrackedServiceKeyMap(serviceIds: RenderServiceEnvMap): Map<string, RenderServiceKey> {
  return new Map<string, RenderServiceKey>([
    [serviceIds.pipeline, "pipeline"],
    [serviceIds.listener, "listener"],
    [serviceIds.bot, "bot"],
  ]);
}

function withServiceKey<T extends { serviceId: string; serviceKey?: RenderServiceKey }>(
  value: T,
  serviceKeyById: Map<string, RenderServiceKey>,
): T {
  const serviceKey = serviceKeyById.get(value.serviceId);
  return serviceKey ? { ...value, serviceKey } : value;
}

function withServiceMetadata(
  logLine: AdminRenderLogLine,
  servicesById: Map<string, AdminRenderService>,
): AdminRenderLogLine {
  const service = servicesById.get(logLine.serviceId);

  if (!service) {
    return logLine;
  }

  return {
    ...logLine,
    serviceKey: service.key,
    serviceName: logLine.serviceName === "render-service" ? service.name : logLine.serviceName,
  };
}

export function getRenderLogWindow(nowMs = Date.now()): {
  startTime: string;
  endTime: string;
} {
  const endTimeMs = Math.floor(nowMs / RENDER_LOG_CACHE_BUCKET_MS) * RENDER_LOG_CACHE_BUCKET_MS;
  const startTimeMs = endTimeMs - RENDER_LOG_WINDOW_MINUTES * 60 * 1_000;

  return {
    startTime: new Date(startTimeMs).toISOString(),
    endTime: new Date(endTimeMs).toISOString(),
  };
}

export const listRenderServices = unstable_cache(
  async (): Promise<AdminRenderService[]> => {
    const env = requireRenderEnv();
    const response = await renderFetch<RawServiceEnvelope[]>(
      `/services?limit=50&ownerId=${encodeURIComponent(env.ownerId)}`,
    );

    return response
      .map((item) => (isRecord(item?.service) ? mapService(item.service) : null))
      .filter((item): item is AdminRenderService => item != null && item.id !== "");
  },
  ["render-services-v1"],
  {
    revalidate: 60,
    tags: ["render-services"],
  },
);

const listRenderDeploysCached = unstable_cache(
  async (serviceId: string): Promise<AdminRenderDeploy[]> => {
    const response = await renderFetch<RawDeployEnvelope[]>(
      `/services/${encodeURIComponent(serviceId)}/deploys?limit=${RENDER_DEPLOY_LIMIT}`,
    );

    return response
      .map((item) => (isRecord(item?.deploy) ? mapDeploy(serviceId, item.deploy) : null))
      .filter((item): item is AdminRenderDeploy => Boolean(item));
  },
  ["render-deploys-v1"],
  {
    revalidate: 60,
    tags: ["render-deploys"],
  },
);

export function listRenderDeploys(serviceId: string): Promise<AdminRenderDeploy[]> {
  return listRenderDeploysCached(serviceId);
}

const listRenderInstancesCached = unstable_cache(
  async (serviceId: string): Promise<AdminRenderInstance[]> => {
    const response = await renderFetch<RawInstanceEnvelope[]>(
      `/services/${encodeURIComponent(serviceId)}/instances`,
    );

    return response
      .map((item) => (isRecord(item?.instance) ? mapInstance(serviceId, item.instance) : null))
      .filter((item): item is AdminRenderInstance => Boolean(item));
  },
  ["render-instances-v1"],
  {
    revalidate: 30,
    tags: ["render-instances"],
  },
);

export function listRenderInstances(serviceId: string): Promise<AdminRenderInstance[]> {
  return listRenderInstancesCached(serviceId);
}

const listRenderLogsCached = unstable_cache(
  async (
    serviceIdsKey: string,
    startTime: string,
    endTime: string,
    limit: number,
  ): Promise<AdminRenderLogLine[]> => {
    const env = requireRenderEnv();
    const params = new URLSearchParams({
      ownerId: env.ownerId,
      resource: serviceIdsKey,
      startTime,
      endTime,
      limit: String(limit),
      direction: "backward",
    });
    const response = await renderFetch<RawLogsResponse>(`/logs?${params.toString()}`, {
      timeoutMs: RENDER_LOG_TIMEOUT_MS,
    });

    return Array.isArray(response.logs)
      ? response.logs
          .map((item) => (isRecord(item) ? mapLogLine(item) : null))
          .filter((item): item is AdminRenderLogLine => Boolean(item))
      : [];
  },
  ["render-logs-v1"],
  {
    revalidate: 15,
    tags: ["render-logs"],
  },
);

export function listRenderLogs(args: {
  serviceIds: string[];
  startTime: string;
  endTime: string;
  limit?: number;
}): Promise<AdminRenderLogLine[]> {
  const serviceIdsKey = [...new Set(args.serviceIds)].sort().join(",");
  return listRenderLogsCached(
    serviceIdsKey,
    args.startTime,
    args.endTime,
    args.limit ?? RENDER_LOG_LIMIT,
  );
}

export async function loadRenderObservability(): Promise<AdminRenderObservability> {
  const envState = getRenderEnvState();
  const fetchedAt = new Date().toISOString();

  if (
    !envState.configured ||
    !envState.serviceIds.pipeline ||
    !envState.serviceIds.listener ||
    !envState.serviceIds.bot
  ) {
    return {
      provider: "render",
      state: "disabled",
      enabled: false,
      configured: false,
      missingEnv: envState.missingEnv,
      fetchedAt,
      logWindowMinutes: RENDER_LOG_WINDOW_MINUTES,
      services: [],
      deploys: [],
      instances: [],
      logs: [],
      error: {
        code: "config_missing",
        missingEnv: envState.missingEnv,
      },
      errors: [],
    };
  }

  const trackedServiceIds = envState.serviceIds as RenderServiceEnvMap;
  const serviceKeyById = buildTrackedServiceKeyMap(trackedServiceIds);

  try {
    const allServices = await listRenderServices();
    const trackedServices = allServices
      .filter((service) => serviceKeyById.has(service.id))
      .map((service) => ({
        ...service,
        key: serviceKeyById.get(service.id),
      }));
    const errors: AdminRenderEndpointError[] = [];

    for (const [serviceId, serviceKey] of serviceKeyById.entries()) {
      if (!trackedServices.some((service) => service.id === serviceId)) {
        errors.push({
          endpoint: "services",
          serviceId,
          serviceKey,
          error: {
            code: "not_found",
            resource: `/services/${serviceId}`,
          },
        });
      }
    }

    const deployResults = await Promise.all(
      trackedServices.map(async (service) => {
        try {
          const deploys = await listRenderDeploys(service.id);
          return deploys.map((deploy) => withServiceKey(deploy, serviceKeyById));
        } catch (error) {
          errors.push({
            endpoint: "deploys",
            serviceId: service.id,
            serviceKey: service.key,
            error: toRenderApiError(error),
          });
          return [];
        }
      }),
    );

    const instanceResults = await Promise.all(
      trackedServices.map(async (service) => {
        try {
          const instances = await listRenderInstances(service.id);
          return instances.map((instance) => withServiceKey(instance, serviceKeyById));
        } catch (error) {
          errors.push({
            endpoint: "instances",
            serviceId: service.id,
            serviceKey: service.key,
            error: toRenderApiError(error),
          });
          return [];
        }
      }),
    );

    const { startTime, endTime } = getRenderLogWindow();
    const deploys = deployResults.flat();
    const instances = instanceResults.flat();
    const services = trackedServices.map((service) =>
      attachServiceStatus(
        service,
        deploys.filter((deploy) => deploy.serviceId === service.id),
      ),
    );
    const servicesById = new Map(services.map((service) => [service.id, service] as const));
    let logs: AdminRenderLogLine[] = [];

    if (services.length > 0) {
      try {
        const loadedLogs = await listRenderLogs({
          serviceIds: services.map((service) => service.id),
          startTime,
          endTime,
          limit: RENDER_LOG_LIMIT,
        });
        logs = loadedLogs
          .map((logLine) => withServiceMetadata(logLine, servicesById))
          .filter((logLine) => serviceKeyById.has(logLine.serviceId))
          .sort((left, right) => {
            const leftTime = parseDateTimeSafe(left.timestamp) ?? 0;
            const rightTime = parseDateTimeSafe(right.timestamp) ?? 0;
            return rightTime - leftTime;
          });
      } catch (error) {
        errors.push({
          endpoint: "logs",
          error: toRenderApiError(error),
        });
      }
    }

    const lastLogAt = logs[0]?.timestamp;
    const state =
      errors.length > 0
        ? services.length > 0
          ? "degraded"
          : "error"
        : "ready";

    return {
      provider: "render",
      state,
      enabled: true,
      configured: true,
      missingEnv: [],
      fetchedAt,
      lastLogAt,
      logWindowMinutes: RENDER_LOG_WINDOW_MINUTES,
      services,
      deploys: deploys.sort((left, right) => {
        const leftTime =
          parseDateTimeSafe(left.createdAt) ??
          parseDateTimeSafe(left.startedAt ?? "") ??
          parseDateTimeSafe(left.finishedAt ?? "") ??
          0;
        const rightTime =
          parseDateTimeSafe(right.createdAt) ??
          parseDateTimeSafe(right.startedAt ?? "") ??
          parseDateTimeSafe(right.finishedAt ?? "") ??
          0;
        return rightTime - leftTime;
      }),
      instances: instances.sort((left, right) => {
        const leftTime =
          parseDateTimeSafe(left.startedAt ?? "") ?? parseDateTimeSafe(left.finishedAt ?? "") ?? 0;
        const rightTime =
          parseDateTimeSafe(right.startedAt ?? "") ?? parseDateTimeSafe(right.finishedAt ?? "") ?? 0;
        return rightTime - leftTime;
      }),
      logs,
      errors,
    };
  } catch (error) {
    return {
      provider: "render",
      state: "error",
      enabled: true,
      configured: true,
      missingEnv: [],
      fetchedAt,
      logWindowMinutes: RENDER_LOG_WINDOW_MINUTES,
      services: [],
      deploys: [],
      instances: [],
      logs: [],
      error: toRenderApiError(error),
      errors: [],
    };
  }
}
