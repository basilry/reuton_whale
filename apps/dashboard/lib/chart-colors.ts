function normalizeColorValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseRgbChannels(color: string): [number, number, number] | null {
  const matches = color.match(/[\d.]+/g);
  if (!matches || matches.length < 3) {
    return null;
  }

  const [r, g, b] = matches
    .slice(0, 3)
    .map((value) => Number.parseFloat(value));
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return null;
  }

  return [r, g, b];
}

function parseOklchChannel(raw: string, scale = 1): number | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return (parsed / 100) * scale;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function linearToSrgb(channel: number): number {
  const clamped = clamp(channel, 0, 1);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * (clamped ** (1 / 2.4)) - 0.055;
}

function oklchToRgb(value: string): string | null {
  const match = value.match(/^oklch\((.+)\)$/i);
  if (!match) {
    return null;
  }

  const body = match[1]?.trim();
  if (!body) {
    return null;
  }

  const [channelsPart] = body.split("/");
  const channels = channelsPart
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (channels.length < 3) {
    return null;
  }

  const l = parseOklchChannel(channels[0]);
  const c = parseOklchChannel(channels[1]);
  const h = parseOklchChannel(channels[2]);
  if (l == null || c == null || h == null) {
    return null;
  }

  const hue = h * (Math.PI / 180);
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lCube = lPrime ** 3;
  const mCube = mPrime ** 3;
  const sCube = sPrime ** 3;

  const redLinear =
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube;
  const greenLinear =
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube;
  const blueLinear =
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube;

  const red = Math.round(linearToSrgb(redLinear) * 255);
  const green = Math.round(linearToSrgb(greenLinear) * 255);
  const blue = Math.round(linearToSrgb(blueLinear) * 255);

  return `rgb(${red}, ${green}, ${blue})`;
}

function resolveRawTokenValue(
  styles: CSSStyleDeclaration,
  tokenName: string,
  depth = 0,
): string {
  if (depth > 6) {
    return "";
  }

  const raw = normalizeColorValue(styles.getPropertyValue(tokenName));
  if (!raw) {
    return "";
  }

  const varMatch = raw.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (!varMatch) {
    return raw;
  }

  const nestedName = varMatch[1];
  const fallback = varMatch[2] ? normalizeColorValue(varMatch[2]) : "";
  const nestedValue = resolveRawTokenValue(styles, nestedName, depth + 1);
  return nestedValue || fallback;
}

function resolveColorString(
  styles: CSSStyleDeclaration,
  tokenName: string,
  fallback: string,
): string {
  const raw = resolveRawTokenValue(styles, tokenName);
  if (!raw) {
    return fallback;
  }

  if (raw.startsWith("oklch(")) {
    return oklchToRgb(raw) ?? fallback;
  }

  if (
    raw.startsWith("rgb(") ||
    raw.startsWith("rgba(") ||
    raw.startsWith("#") ||
    raw === "transparent"
  ) {
    return raw;
  }

  return fallback;
}

export function resolveTokenColor(
  node: HTMLElement,
  tokenName: string,
  fallback: string,
): string {
  return resolveColorString(getComputedStyle(node), tokenName, fallback);
}

export function toRgba(color: string, alpha: number, fallback: string): string {
  const channels = parseRgbChannels(color);
  if (!channels) {
    return fallback;
  }

  const [r, g, b] = channels;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
