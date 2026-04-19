import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { LiveUpdatesController } from "@/components/live-updates-controller";

import { TEST_SURFACE_STYLE } from "./dashboard-accessibility.harness";

function createTestRouter(): AppRouterInstance {
  return {
    back() {},
    forward() {},
    prefetch() {},
    push() {},
    replace() {},
    refresh() {
      window.__liveRefreshCount = (window.__liveRefreshCount ?? 0) + 1;
    },
  };
}

declare global {
  interface Window {
    __liveRefreshCount?: number;
  }
}

type LiveUpdatesControllerHarnessProps = {
  language: "ko" | "en";
};

export function LiveUpdatesControllerHarness({
  language,
}: LiveUpdatesControllerHarnessProps) {
  return (
    <AppRouterContext.Provider value={createTestRouter()}>
      <div style={TEST_SURFACE_STYLE}>
        <LiveUpdatesController
          chipClassName="live-chip"
          dotClassName="live-dot"
          language={language}
        />
      </div>
    </AppRouterContext.Provider>
  );
}
