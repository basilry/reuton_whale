function normalizeColorValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseRgbChannels(color: string): [number, number, number] | null {
  const matches = color.match(/[\d.]+/g);
  if (!matches || matches.length < 3) {
    return null;
  }

  const [r, g, b] = matches.slice(0, 3).map((value) => Number.parseFloat(value));
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return null;
  }

  return [r, g, b];
}

function resolveColorThroughProbe(
  node: HTMLElement,
  value: string,
  fallback: string,
): string {
  if (typeof document === "undefined") {
    return fallback;
  }

  const probe = document.createElement("span");
  probe.style.color = fallback;
  probe.style.position = "absolute";
  probe.style.pointerEvents = "none";
  probe.style.opacity = "0";
  probe.style.inset = "0";
  probe.style.color = value;

  node.appendChild(probe);
  const resolved = normalizeColorValue(getComputedStyle(probe).color || "");
  probe.remove();

  return resolved || fallback;
}

export function resolveTokenColor(
  node: HTMLElement,
  tokenName: string,
  fallback: string,
): string {
  return resolveColorThroughProbe(node, `var(${tokenName})`, fallback);
}

export function toRgba(color: string, alpha: number, fallback: string): string {
  const channels = parseRgbChannels(color);
  if (!channels) {
    return fallback;
  }

  const [r, g, b] = channels;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
