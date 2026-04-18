const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return SAFE_PROTOCOLS.has(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}
