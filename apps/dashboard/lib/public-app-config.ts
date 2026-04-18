export type TelegramPublicConfig = {
  channelQrUrl: string | null;
  channelUrl: string | null;
  channelUsername: string | null;
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
  const channelUsername = sanitizeTelegramUsername(
    process.env.NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL,
  );
  const botUrl = username ? `https://t.me/${username}` : null;
  const channelUrl = channelUsername ? `https://t.me/${channelUsername}` : null;
  const qrUrl = botUrl ? `/api/qr?data=${encodeURIComponent(botUrl)}` : null;
  const channelQrUrl = channelUrl
    ? `/api/qr?data=${encodeURIComponent(channelUrl)}`
    : null;

  return {
    channelQrUrl,
    channelUrl,
    channelUsername,
    username,
    botUrl,
    qrUrl,
  };
}
