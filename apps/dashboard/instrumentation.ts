/**
 * Next.js instrumentation hook. Runs once per server process at boot, before
 * any request is served.
 *
 * Why this file exists
 * --------------------
 * In dev, we surface unhandled rejections / uncaught exceptions with the
 * error name, message, stack, and the full `cause` chain. The default Node
 * logger truncates these, which hid the root of a long investigation:
 *
 *   "RangeError: Maximum call stack size exceeded at Set.add"
 *
 * The true source was Next.js 15's dev-only React 19 async debug emitter
 * (`visitAsyncNode` in `app-page.runtime.dev.js`) recursing over the async
 * op tree deeply enough to exhaust V8's default ~1 MB stack. The workaround
 * is a larger stack size, applied in `apps/dashboard/package.json`'s `dev`
 * script via `node --stack-size=8000 ./node_modules/next/dist/bin/next dev`.
 * Production uses `app-page.runtime.prod.js` which does not emit debug
 * chunks, so no runtime change is needed there.
 *
 * The diagnostic logging below is intentionally kept so any future
 * rejection surfaces with a full error identity — inexpensive in dev,
 * inactive in production.
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    // Default is 10; our async call graphs benefit from deeper traces
    // even though V8 truncates the stack for stack-overflow errors.
    Error.stackTraceLimit = 200;

    if (typeof process !== "undefined" && typeof process.on === "function") {
      process.on("unhandledRejection", (reason) => {
        const tag = "[instrumentation] unhandledRejection";
        if (reason instanceof Error) {
          console.error(tag, reason.name, "::", reason.message);
          if (reason.stack) console.error(tag, "stack:\n" + reason.stack);

          // Walk cause chain (AggregateError / wrapped SDK errors).
          let cur: unknown = (reason as { cause?: unknown }).cause;
          let depth = 0;
          while (cur && depth < 8) {
            if (cur instanceof Error) {
              console.error(tag, "cause[" + depth + "]:", cur.name, "::", cur.message);
            } else {
              console.error(tag, "cause[" + depth + "]:", String(cur));
            }
            cur = (cur as { cause?: unknown })?.cause;
            depth += 1;
          }
        } else {
          console.error(tag, "non-Error reason:", String(reason));
        }
      });

      process.on("uncaughtException", (error) => {
        const tag = "[instrumentation] uncaughtException";
        console.error(tag, error.name, "::", error.message);
        if (error.stack) console.error(tag, "stack:\n" + error.stack);
      });
    }
  }
}
