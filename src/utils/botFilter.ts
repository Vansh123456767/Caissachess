export interface BotCheckCandidate {
  name?: string | null;
  username?: string | null;
  title?: string | null;
  isBot?: boolean | null;
}

const BOT_NAME_PATTERN =
  /(^bot[_-]|[_-]bot$|\bbot\b|caissa\s*bot|\bstockfish\b|\bmaia\d*\b|\blc0\b|\bkomodo\b|\bai[_-]?player\b)/i;

export function isBotAccount(entry?: BotCheckCandidate | null): boolean {
  if (!entry) return false;
  if (entry.isBot === true) return true;
  if (entry.title && entry.title.trim().toUpperCase() === 'BOT') return true;
  const handle = (entry.name || entry.username || '').trim();
  if (!handle) return false;
  return BOT_NAME_PATTERN.test(handle);
}
