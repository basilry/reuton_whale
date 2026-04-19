import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "playwright";

import {
  getLiveUpdateStreamStatus,
  type LiveUpdateSection,
} from "@/lib/live-updates";

import {
  applyDashboardTestDocument,
} from "./dashboard-accessibility.harness";
import { LiveUpdatesControllerHarness } from "./live-updates-controller.harness";

declare global {
  interface Window {
    __liveRefreshCount?: number;
    __mockEventSource?: {
      emit: (type: string, data: string, lastEventId?: string) => void;
      error: () => void;
      instanceCount: () => number;
      open: () => void;
    };
  }
}

type ParsedSseFrame = {
  comment?: string;
  data?: string;
  event?: string;
  id?: string;
  retry?: number;
};

function parseSseFrame(frame: string): ParsedSseFrame {
  const parsed: ParsedSseFrame = {};

  for (const line of frame.split("\n")) {
    if (!line) {
      continue;
    }

    if (line.startsWith(":")) {
      parsed.comment = line.slice(1).trim();
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const value =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trimStart();

    if (field === "data") {
      parsed.data = parsed.data ? `${parsed.data}\n${value}` : value;
      continue;
    }

    if (field === "retry") {
      parsed.retry = Number(value);
      continue;
    }

    if (field === "event") {
      parsed.event = value;
      continue;
    }

    if (field === "id") {
      parsed.id = value;
    }
  }

  return parsed;
}

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms while reading SSE frames.`));
      }, timeoutMs);
    }),
  ]);
}

async function collectSseFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  until: (frames: ParsedSseFrame[]) => boolean,
  timeoutMs = 2_000,
): Promise<ParsedSseFrame[]> {
  const decoder = new TextDecoder();
  const frames: ParsedSseFrame[] = [];
  const deadline = Date.now() + timeoutMs;
  let buffer = "";

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await readChunkWithTimeout(reader, remaining);
    if (result.done) {
      break;
    }

    buffer += decoder.decode(result.value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawFrame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      if (rawFrame.trim()) {
        frames.push(parseSseFrame(rawFrame));
        if (until(frames)) {
          return frames;
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  throw new Error(`Expected SSE frames were not received within ${timeoutMs}ms.`);
}

async function importStreamRouteGet() {
  const moduleApi = await import("node:module");
  const moduleLoader = moduleApi.default as unknown as {
    _load: (
      request: string,
      parent: unknown,
      isMain: boolean,
    ) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const routePath =
    "/Users/basilry/Projects/02015_reuton_whale/apps/dashboard/app/api/stream/route.ts";
  const requireFromDashboard = moduleApi.createRequire(routePath);

  moduleLoader._load = (request: string, parent: unknown, isMain: boolean) => {
    if (request === "server-only") {
      return {};
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    const route = requireFromDashboard(routePath) as {
      GET: (request: Request) => Promise<Response>;
    };
    return route.GET;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

function withEnv(overrides: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function installEventSourceMock(page: Page) {
  await page.evaluate(() => {
    type MockListener = (event: MessageEvent<string>) => void;

    class MockEventSource {
      static instances: MockEventSource[] = [];

      readonly listeners = new Map<string, Set<MockListener>>();
      readonly url: string;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      readyState = 0;
      withCredentials = false;

      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const callback =
          typeof listener === "function"
            ? (listener as MockListener)
            : ((event: MessageEvent<string>) => listener.handleEvent(event));
        const existing = this.listeners.get(type) ?? new Set<MockListener>();
        existing.add(callback);
        this.listeners.set(type, existing);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const existing = this.listeners.get(type);
        if (!existing) {
          return;
        }

        if (typeof listener === "function") {
          existing.delete(listener as MockListener);
        }
      }

      close() {
        this.readyState = 2;
      }

      emit(type: string, data: string, lastEventId = "") {
        const event = new MessageEvent(type, {
          data,
          lastEventId,
        });

        if (type === "message") {
          this.onmessage?.(event as MessageEvent<string>);
        }

        for (const listener of this.listeners.get(type) ?? []) {
          listener(event as MessageEvent<string>);
        }
      }

      fail() {
        this.readyState = 0;
        this.onerror?.(new Event("error"));
      }

      open() {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      }
    }

    window.__liveRefreshCount = 0;
    window.__mockEventSource = {
      emit(type: string, data: string, lastEventId = "") {
        MockEventSource.instances.at(-1)?.emit(type, data, lastEventId);
      },
      error() {
        MockEventSource.instances.at(-1)?.fail();
      },
      instanceCount() {
        return MockEventSource.instances.length;
      },
      open() {
        MockEventSource.instances.at(-1)?.open();
      },
    };
    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
}

test.describe("live updates stream", () => {
  test.describe.configure({ mode: "serial" });

  test("stream status helper distinguishes missing Redis URL and token", () => {
    expect(
      getLiveUpdateStreamStatus({
        enabled: false,
        configured: false,
      }),
    ).toMatchObject({
      state: "disabled",
      reason: "feature_disabled",
    });

    expect(
      getLiveUpdateStreamStatus({
        enabled: true,
        configured: false,
        restToken: "redis-token",
      }),
    ).toMatchObject({
      state: "disabled",
      reason: "redis_missing",
    });

    expect(
      getLiveUpdateStreamStatus({
        enabled: true,
        configured: false,
        restUrl: "https://redis.example.test",
      }),
    ).toMatchObject({
      state: "disabled",
      reason: "token_missing",
    });

    expect(
      getLiveUpdateStreamStatus({
        enabled: true,
        configured: true,
        restUrl: "https://redis.example.test",
        restToken: "redis-token",
      }),
    ).toMatchObject({
      state: "enabled",
    });
  });

  test("stream route emits eventId and publishedAt in SSE payloads", async () => {
    const restoreEnv = withEnv({
      WHALESCOPE_SSE_ENABLED: "true",
      WHALESCOPE_REDIS_REST_URL: "https://redis.example.test",
      WHALESCOPE_REDIS_REST_TOKEN: "redis-token",
    });
    const originalFetch = globalThis.fetch;
    const publishedAt = "2026-04-19T00:00:00.000Z";
    const updateByKey: Partial<Record<LiveUpdateSection, unknown>> = {
      brief: {
        ts: publishedAt,
        version: "brief-v1",
      },
    };
    const sectionKeyMap: Record<LiveUpdateSection, string> = {
      brief: "whalescope:updates:brief",
      news: "whalescope:updates:news",
      watchlist: "whalescope:updates:watchlist",
      stories: "whalescope:updates:stories",
    };

    globalThis.fetch = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const key = decodeURIComponent(url.split("/get/")[1] ?? "");
      const section = (Object.entries(sectionKeyMap).find(
        ([, value]) => value === key,
      )?.[0] ?? null) as LiveUpdateSection | null;

      return new Response(
        JSON.stringify({
          result: section ? updateByKey[section] ?? null : null,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    const abortController = new AbortController();

    try {
      const GET = await importStreamRouteGet();
      const response = await GET(
        new Request("http://localhost/api/stream", {
          signal: abortController.signal,
        }),
      );

      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeTruthy();
      if (!reader) {
        throw new Error("Expected a readable stream body from /api/stream.");
      }

      try {
        const frames = await collectSseFrames(
          reader,
          (items) =>
            items.some((item) => item.event === "status") &&
            items.some((item) => item.event === "brief"),
        );
        const statusFrame = frames.find((frame) => frame.event === "status");
        const briefFrame = frames.find((frame) => frame.event === "brief");

        expect(statusFrame).toBeTruthy();
        expect(briefFrame).toBeTruthy();

        const statusPayload = JSON.parse(statusFrame?.data ?? "{}") as {
          eventId?: string;
          publishedAt?: string;
          state?: string;
        };
        const briefPayload = JSON.parse(briefFrame?.data ?? "{}") as {
          eventId?: string;
          publishedAt?: string;
          section?: string;
          ts?: string;
          version?: string;
        };

        expect(statusPayload.state).toBe("enabled");
        expect(statusPayload.eventId).toBe(statusFrame?.id);
        expect(Date.parse(statusPayload.publishedAt ?? "")).not.toBeNaN();

        expect(briefPayload).toMatchObject({
          eventId: briefFrame?.id,
          publishedAt,
          section: "brief",
          ts: publishedAt,
          version: "brief-v1",
        });
      } finally {
        abortController.abort();
        await reader.cancel().catch(() => {});
      }
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  test("live updates controller preserves refresh behavior and reconnects after errors", async ({
    mount,
    page,
  }) => {
    await page.evaluate(applyDashboardTestDocument, "en");
    await installEventSourceMock(page);

    const component = await mount(
      <LiveUpdatesControllerHarness language="en" />,
    );
    const status = component.getByRole("status", {
      name: /live update connection status/i,
    });

    await expect
      .poll(async () => page.evaluate(() => window.__mockEventSource?.instanceCount() ?? 0))
      .toBe(1);
    await page.evaluate(() => {
      window.__mockEventSource?.open();
    });

    await expect(status).toContainText("Live connected");

    await page.evaluate(() => {
      window.__mockEventSource?.emit(
        "brief",
        JSON.stringify({
          kind: "brief",
          eventId: "brief:brief-v1",
          publishedAt: new Date(Date.now() - 250).toISOString(),
        }),
        "brief:brief-v1",
      );
    });

    await expect(status).toHaveAttribute("title", /Brief event received/);
    await page.waitForTimeout(1_700);
    await expect
      .poll(async () => page.evaluate(() => window.__liveRefreshCount ?? 0))
      .toBe(1);

    await page.evaluate(() => {
      window.__mockEventSource?.error();
    });

    await expect(status).toContainText("Reconnecting");
    await expect(status).toHaveAttribute("title", /Retrying the stream in 1s\./);
    await expect
      .poll(async () => page.evaluate(() => window.__mockEventSource?.instanceCount() ?? 0))
      .toBe(2);
  });

  test("live updates controller surfaces refined disabled reasons from status events", async ({
    mount,
    page,
  }) => {
    await page.evaluate(applyDashboardTestDocument, "en");
    await installEventSourceMock(page);

    const component = await mount(
      <LiveUpdatesControllerHarness language="en" />,
    );
    const status = component.getByRole("status", {
      name: /live update connection status/i,
    });

    await expect
      .poll(async () => page.evaluate(() => window.__mockEventSource?.instanceCount() ?? 0))
      .toBe(1);
    await page.evaluate(() => {
      window.__mockEventSource?.open();
      window.__mockEventSource?.emit(
        "status",
        JSON.stringify({
          state: "disabled",
          reason: "redis_missing",
          eventId: "status:redis",
          publishedAt: "2026-04-19T00:00:00.000Z",
        }),
        "status:redis",
      );
    });

    await expect(status).toContainText("Offline");
    await expect(status).toHaveAttribute(
      "title",
      "Live auto-refresh is missing the Redis REST URL.",
    );

    await page.evaluate(() => {
      window.__mockEventSource?.emit(
        "status",
        JSON.stringify({
          state: "disabled",
          reason: "token_missing",
          eventId: "status:token",
          publishedAt: "2026-04-19T00:01:00.000Z",
        }),
        "status:token",
      );
    });

    await expect(status).toHaveAttribute(
      "title",
      "Live auto-refresh is missing the Redis REST token.",
    );
  });
});
