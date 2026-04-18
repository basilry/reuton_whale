export type TelegramPublicConfig = {
  channelQrUrl: string | null;
  channelUrl: string | null;
  channelUsername: string | null;
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
  const explicitChannelUsername = sanitizeTelegramUsername(
    process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_USERNAME,
  );
  const legacyBroadcastChannel = sanitizeTelegramUsername(
    process.env.NEXT_PUBLIC_TELEGRAM_BROADCAST_CHANNEL,
  );
  const channelUsername = explicitChannelUsername ?? legacyBroadcastChannel;
  const channelUrl = channelUsername ? `https://t.me/${channelUsername}` : null;
  const channelQrUrl = channelUrl
    ? `/api/qr?data=${encodeURIComponent(channelUrl)}`
    : null;

  return {
    channelQrUrl,
    channelUrl,
    channelUsername,
  };
}
