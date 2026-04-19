export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseLimitParam(
  raw: string | null | undefined,
  fallback: number,
  max = 100
): number {
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback;
  }

  return clampNumber(parsed, 1, max);
}

export function compactString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseFloatSafe(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntSafe(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDateTimeSafe(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseJsonSafe<T = unknown>(value: string): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Maximum object-graph depth we allow when walking unknown payloads.
 * V8's native `JSON.stringify` is recursive and will overflow the call stack
 * around ~5–10k nested levels. Google APIs error objects (e.g. gspread
 * `APIError`) can easily produce that kind of depth through
 * `error.response.request.response...` chains that we then receive as
 * pipeline log payloads. We sanitize defensively before handing anything to
 * `JSON.stringify` or React Server Components.
 */
const SAFE_WALK_MAX_DEPTH = 20;

/**
 * Depth-bounded, cycle-aware deep walker. Replaces non-serializable values
 * (Date, Error, Map, Set, Function, Symbol, bigint, typed arrays) with safe
 * representations, and returns "[Max depth]" / "[Circular]" sentinels in
 * place of pathological sub-trees. The result is always a plain
 * JSON-serializable value.
 *
 * `ancestors` tracks the current path (not all seen nodes), so shared
 * references that are not actual cycles are preserved as duplicated
 * sub-trees — this matches React Flight's serialization contract, which
 * treats shared refs as distinct sub-trees rather than failures.
 */
function sanitizeForSerialization(
  value: unknown,
  depth: number,
  ancestors: object[]
): unknown {
  if (value == null) {
    return value;
  }

  const t = typeof value;
  if (t === "string") {
    return (value as string).length > 2000
      ? `${(value as string).slice(0, 2000)}…(truncated)`
      : value;
  }
  if (t === "number" || t === "boolean") {
    return value;
  }
  if (t === "bigint") {
    return (value as bigint).toString();
  }
  if (t === "function" || t === "symbol") {
    return "[Function]";
  }
  if (t !== "object") {
    return String(value);
  }

  if (depth > SAFE_WALK_MAX_DEPTH) {
    return "[Max depth]";
  }

  const obj = value as object;
  if (ancestors.includes(obj)) {
    return "[Circular]";
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message:
        typeof obj.message === "string" && obj.message.length > 500
          ? `${obj.message.slice(0, 500)}…(truncated)`
          : obj.message,
    };
  }
  if (obj instanceof Map) {
    return Array.from(obj.entries()).map(([k, v]) => [
      sanitizeForSerialization(k, depth + 1, ancestors),
      sanitizeForSerialization(v, depth + 1, ancestors),
    ]);
  }
  if (obj instanceof Set) {
    return Array.from(obj.values()).map((v) =>
      sanitizeForSerialization(v, depth + 1, ancestors)
    );
  }
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    return "[Binary]";
  }
  if (typeof (obj as { then?: unknown }).then === "function") {
    return "[Promise]";
  }

  ancestors.push(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        sanitizeForSerialization(item, depth + 1, ancestors)
      );
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      try {
        const val = (obj as Record<string, unknown>)[key];
        out[key] = sanitizeForSerialization(val, depth + 1, ancestors);
      } catch {
        out[key] = "[Unreadable]";
      }
    }
    return out;
  } finally {
    ancestors.pop();
  }
}

/**
 * Sanitize an arbitrary value into a shape that is guaranteed to be safe for
 * React Server Components serialization. Use at the boundary where server
 * data crosses to client components. Returns a structural clone with:
 * - cycles replaced by `"[Circular]"`
 * - depth > 20 collapsed to `"[Max depth]"`
 * - Date → ISO string
 * - Error → `{name, message}`
 * - Map/Set → arrays
 * - Function / Symbol → `"[Function]"`
 * - bigint → string
 * - typed arrays / ArrayBuffer → `"[Binary]"`
 * - Promise → `"[Promise]"`
 *
 * Typing: returns `unknown` because the sanitized value may differ
 * structurally from the input. Callers cast as needed.
 */
export function sanitizeForRsc<T>(value: T): T {
  return sanitizeForSerialization(value, 0, []) as T;
}

/**
 * Safely convert any unknown value to a bounded string.
 * Used for data that crosses the RSC server→client boundary, where passing
 * arbitrary deeply-nested or large unknown payloads can crash React Server
 * Components deserialization with RangeError: Maximum call stack size exceeded.
 *
 * Uses a depth-bounded walker to produce a plain, safe value first, then
 * `JSON.stringify` on the result — this guarantees we never call
 * `JSON.stringify` on an object deeper than `SAFE_WALK_MAX_DEPTH`, so V8's
 * recursive serializer cannot overflow the stack.
 *
 * @param value - any value (string, object, null, undefined, number, etc.)
 * @param max   - maximum characters to keep (default 500)
 * @returns bounded string; returns "" for null/undefined/stringify failure
 */
export function safeStringifyBounded(value: unknown, max = 500): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}…(truncated)` : value;
  }
  try {
    const sanitized = sanitizeForSerialization(value, 0, []);
    const s = JSON.stringify(sanitized);
    if (s == null) {
      return "";
    }
    return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
  } catch {
    return "";
  }
}

export function cleanGeneratedBrief(value: string): string {
  return value
    .replace(/[📊🐳⚠️]/gu, "")
    .replace(/\*\*/g, "")
    .replace(/今日/g, "오늘")
    .replace(/دولار/g, "달러")
    .replace(/検出/g, "감지")
    .replace(/교환소/g, "거래소")
    .replace(/CEX 입금_spike/g, "거래소 유입 급증")
    .replace(/CEX 출금_spike/g, "거래소 유출 급증")
    .replace(/\s+/g, " ")
    .trim();
}

export function rowHasContent(row: object): boolean {
  return Object.values(row as Record<string, unknown>).some((value) => compactString(value) !== "");
}

export function columnLabel(index: number): string {
  if (index < 1) {
    throw new Error(`Invalid column index: ${index}`);
  }

  let value = index;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function newestFirst<T>(
  rows: T[],
  getTime: (row: T) => number | null
): T[] {
  return [...rows].sort((left, right) => {
    const leftTime = getTime(left);
    const rightTime = getTime(right);
    if (leftTime == null && rightTime == null) {
      return 0;
    }
    if (leftTime == null) {
      return 1;
    }
    if (rightTime == null) {
      return -1;
    }
    return rightTime - leftTime;
  });
}
