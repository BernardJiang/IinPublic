/**
 * Bounded, hub-paged Place chat (OPEN-80).
 *
 * Place membership is a personal Nearby-v3 list, so there is no one shared roster to shard a
 * feed by. The old `chatrooms/<placeId>/messages` Gun map made every participant replicate the
 * complete lifetime history. Place chat now uses a recent HTTP page with an opaque cursor: the
 * hub retains a bounded window and each client receives at most one small page per poll.
 */
export const PLACE_CHAT_PAGE_SIZE = 50;
export const PLACE_CHAT_MAX_TEXT = 2_000;
export const PLACE_CHAT_MAX_ID = 160;
export const PLACE_CHAT_MAX_SENDER_NAME = 120;

export type PlaceChatMessage = {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: string;
};

export type PlaceChatPage = {
  messages: PlaceChatMessage[];
  cursor: string;
  /** More messages arrived than fit in this page; the omitted middle is deliberately not synced. */
  dropped: boolean;
};

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** Strict wire validation shared by the route, client and tests. */
export function parsePlaceChatMessage(value: unknown): PlaceChatMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = boundedString(row.id, PLACE_CHAT_MAX_ID);
  const text = boundedString(row.text, PLACE_CHAT_MAX_TEXT);
  const senderId = boundedString(row.senderId, PLACE_CHAT_MAX_ID);
  const senderName = boundedString(row.senderName, PLACE_CHAT_MAX_SENDER_NAME);
  const timestamp = boundedString(row.timestamp, 64);
  if (!id || !text || !senderId || !senderName || !timestamp) return null;
  if (!Number.isFinite(Date.parse(timestamp))) return null;
  return { id, text, senderId, senderName, timestamp };
}

export function clampPlaceChatPageLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(parsed)
    ? Math.max(1, Math.min(PLACE_CHAT_PAGE_SIZE, parsed))
    : PLACE_CHAT_PAGE_SIZE;
}
