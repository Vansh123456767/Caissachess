export interface BotCheckCandidate {
  name?: string | null;
  username?: string | null;
  title?: string | null;
  isBot?: boolean | null;
}

const BOT_NAME_PATTERN =
  /(?:^|[_\s-])bot(?:[_\s-]|\d|$)|caissa\s*(?:bot|engine)|\b(?:stockfish\d*|maia\d*|lc0|leela\w*|komodo\w*|alphazero|houdini|torch\d*|berserkbot)\b|\b(?:ai|chess)[_-]?(?:player|engine|bot)\b/i;
const CAMEL_CASE_BOT_SUFFIX = /[a-z0-9]Bot(?:\d*$|[_\s-])/;

export function isBotAccount(entry?: BotCheckCandidate | null): boolean {
  if (!entry) return false;
  if (entry.isBot === true) return true;
  if (entry.title && entry.title.trim().toUpperCase() === 'BOT') return true;
  const handle = (entry.name || entry.username || '').trim();
  if (!handle) return false;
  return BOT_NAME_PATTERN.test(handle) || CAMEL_CASE_BOT_SUFFIX.test(handle);
}
