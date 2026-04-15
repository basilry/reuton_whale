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
