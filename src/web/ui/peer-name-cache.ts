const PEER_NAME_CACHE_KEY = 'peerNameCache';

export function getPeerNameCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PEER_NAME_CACHE_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

/**
 * Caches a peer's latest known stage name and self-heals stored conversation records: a
 * conversation embeds the peer name captured at match time, so when a fresher name resolves
 * (e.g. a rename observed via the live roster), sync it into stored conversations too — the
 * conversation list, contact derivation, and anything else reading `myConversations` from
 * localStorage all converge on the current name.
 */
export function rememberPeerName(
  userId: string,
  stageName: string,
  getMyConversations: () => Record<string, any>,
): void {
  const trimmedId = String(userId || '').trim();
  const trimmedName = String(stageName || '').trim();
  if (!trimmedId || !trimmedName) return;
  const cache = getPeerNameCache();
  if (cache[trimmedId] === trimmedName) return;
  cache[trimmedId] = trimmedName;
  localStorage.setItem(PEER_NAME_CACHE_KEY, JSON.stringify(cache));
  try {
    const conversations = getMyConversations();
    let changed = false;
    for (const conversation of Object.values(conversations)) {
      if (
        conversation &&
        conversation.otherUserId === trimmedId &&
        conversation.supportChannel !== true &&
        conversation.otherUserName !== trimmedName
      ) {
        conversation.otherUserName = trimmedName;
        changed = true;
      }
    }
    if (changed) localStorage.setItem('myConversations', JSON.stringify(conversations));
  } catch {
    /* name sync is best-effort — never break the caller's render */
  }
}
