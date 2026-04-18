export type TelegramPublicConfig = {
  username: string | null;
  botUrl: string | null;
  qrUrl: string | null;
};

function sanitizeTelegramUsername(value: string | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/^@+/, "");
  return /^[a-zA-Z0-9_]{5,32}$/.test(normalized) ? normalized : null;
}

export function getTelegramPublicConfig(): TelegramPublicConfig {
  const username = sanitizeTelegramUsername(
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  );
  const botUrl = username ? `https://t.me/${username}` : null;
  const qrUrl = botUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(botUrl)}`
    : null;

  return {
    username,
    botUrl,
    qrUrl,
  };
}
