import { getLiveUpdatesEnv } from "@/lib/env";
import {
  getLiveUpdateStatus,
  LIVE_UPDATE_HEARTBEAT_INTERVAL_MS,
  LIVE_UPDATE_POLL_INTERVAL_MS,
  type LiveUpdateEvent,
} from "@/lib/live-updates";
import { fetchLiveUpdateEvents } from "@/lib/live-updates.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

function encodeSseFrame(params: {
  event?: string;
  id?: string;
  data?: unknown;
  comment?: string;
  retry?: number;
}): string {
  const lines: string[] = [];

  if (params.comment) {
    lines.push(`: ${params.comment}`);
  }

  if (typeof params.retry === "number" && Number.isFinite(params.retry)) {
    lines.push(`retry: ${Math.max(0, Math.trunc(params.retry))}`);
  }

  if (params.event) {
    lines.push(`event: ${params.event}`);
  }

  if (params.id) {
    lines.push(`id: ${params.id}`);
  }

  if (params.data !== undefined) {
    const payload =
      typeof params.data === "string" ? params.data : JSON.stringify(params.data);
    for (const line of payload.split(/\r?\n/)) {
      lines.push(`data: ${line}`);
    }
  }

  return `${lines.join("\n")}\n\n`;
}

function createAbortError(): Error {
  return new Error("stream-aborted");
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "stream-aborted")
  );
}

function heartbeatPayload() {
  return { ts: new Date().toISOString() };
}

function eventIdFor(update: LiveUpdateEvent): string {
  return `${update.section}:${update.version}`;
}

export async function GET(request: Request): Promise<Response> {
  const env = getLiveUpdatesEnv();
  const status = getLiveUpdateStatus(env);
  const encoder = new TextEncoder();
  let stopStream: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const streamAbort = new AbortController();
      const sentVersions = new Map<string, string>();

      const shutdown = () => {
        if (closed) {
          return;
        }

        closed = true;
        streamAbort.abort();
        try {
          controller.close();
        } catch {
          // no-op: the stream may already be closed by the runtime.
        }
      };
      stopStream = shutdown;

      const pushFrame = (frame: string) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          shutdown();
        }
      };

      const pushEvent = (event: string, data: unknown, id?: string) => {
        pushFrame(
          encodeSseFrame({
            event,
            id,
            data,
          }),
        );
      };

      const pollLoop = async () => {
        if (status.state !== "enabled") {
          return;
        }

        while (!closed && !request.signal.aborted) {
          try {
            const updates = await fetchLiveUpdateEvents(env, streamAbort.signal);
            for (const update of updates) {
              const previousVersion = sentVersions.get(update.section);
              if (previousVersion === update.version) {
                continue;
              }

              sentVersions.set(update.section, update.version);
              pushEvent(update.section, update, eventIdFor(update));
            }
          } catch (error) {
            if (isAbortLikeError(error) || request.signal.aborted) {
              break;
            }
          }

          try {
            await waitFor(LIVE_UPDATE_POLL_INTERVAL_MS, streamAbort.signal);
          } catch (error) {
            if (isAbortLikeError(error) || streamAbort.signal.aborted) {
              break;
            }
          }
        }
      };

      const heartbeatLoop = async () => {
        while (!closed && !request.signal.aborted) {
          try {
            await waitFor(LIVE_UPDATE_HEARTBEAT_INTERVAL_MS, streamAbort.signal);
          } catch (error) {
            if (isAbortLikeError(error) || streamAbort.signal.aborted) {
              break;
            }
            continue;
          }

          pushEvent("heartbeat", heartbeatPayload());
        }
      };

      request.signal.addEventListener(
        "abort",
        () => {
          shutdown();
        },
        { once: true },
      );

      pushFrame(encodeSseFrame({ comment: "connected", retry: LIVE_UPDATE_POLL_INTERVAL_MS }));
      pushEvent("status", status);
      pushEvent("heartbeat", heartbeatPayload());

      void pollLoop();
      void heartbeatLoop();
    },
    cancel() {
      stopStream?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: STREAM_HEADERS,
  });
}
