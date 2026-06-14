/**
 * Pair-conversation reconciliation — peer↔peer Gun convergence without the hub.
 *
 * P2P-messaging Phase 5 (spec §19.3 step 5 / §19.4): once a WebRTC DataChannel is up
 * between two matched peers, each side exchanges a digest of the message ids it holds
 * for the conversation and backfills whatever the other is missing. Both peers' local
 * Gun graphs (`conversations/<id>/messages`, `pairConversations/...`) then converge
 * directly — the hub is not a data path even as an in-memory relay.
 *
 * This module is the pure, single source of truth for "what to send / what to keep":
 * no DOM, no Gun, no WebRTC, so the convergence logic is fully unit-tested. The
 * transport (P2PConversationSession) and the store (GunMessageStore) only move bytes
 * and apply results.
 */

/** The wire a reconciliation backfill carries — identical shape to a live DM wire. */
export type ReconcileMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  channel: string;
  transport: string;
  encryption?: 'sea-ecdh-v1';
  prevSeen?: string;
  isFromChatbot?: boolean;
};

/** "Here are the message ids I already hold for this conversation." */
export type ConversationDigest = {
  conversationId: string;
  messageIds: string[];
};

/**
 * Default cap on how many of the most-recent messages a single reconciliation pass
 * considers. Very long conversations have effectively converged for their old history;
 * bounding the digest/backfill to a recent window keeps the digest frame small and the
 * `listLocalWires` enumeration cheap, while still closing any recent gap. Older messages
 * are assumed already replicated (they were reconciled when they were recent).
 */
export const DEFAULT_RECONCILE_WINDOW = 500;

/**
 * Keep only the most-recent `limit` messages (by ISO `timestamp`, ties broken by id for
 * determinism), returned in ascending chronological order. Pure: no Gun/DOM/WebRTC.
 * `limit <= 0` means "no bound" (return all, still chronologically sorted).
 */
export function boundRecentWires<T extends { id: string; timestamp: string }>(
  messages: ReadonlyArray<T>,
  limit: number = DEFAULT_RECONCILE_WINDOW,
): T[] {
  const sorted = [...messages].sort((a, b) => {
    const ta = String(a?.timestamp ?? '');
    const tb = String(b?.timestamp ?? '');
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a?.id ?? '') < String(b?.id ?? '') ? -1 : 1;
  });
  if (!Number.isFinite(limit) || limit <= 0 || sorted.length <= limit) return sorted;
  return sorted.slice(sorted.length - limit);
}

/** Build the local digest for a conversation (ids only — never message bodies). */
export function buildConversationDigest(
  conversationId: string,
  localMessages: ReadonlyArray<{ id: string }>,
): ConversationDigest {
  const seen = new Set<string>();
  for (const m of localMessages) {
    const id = String(m?.id ?? '').trim();
    if (id) seen.add(id);
  }
  return { conversationId, messageIds: [...seen] };
}

/**
 * Given the remote peer's digest, return the local messages the remote is missing
 * (local holds them, the remote's digest doesn't list them). These are sent as
 * backfill. Matches only the same conversation; foreign-conversation digests yield [].
 */
export function computeMissingForPeer(
  conversationId: string,
  localMessages: ReadonlyArray<ReconcileMessage>,
  remoteDigest: ConversationDigest,
): ReconcileMessage[] {
  if (!remoteDigest || remoteDigest.conversationId !== conversationId) return [];
  const remoteHas = new Set(remoteDigest.messageIds.map((id) => String(id)));
  const out: ReconcileMessage[] = [];
  const emitted = new Set<string>();
  for (const m of localMessages) {
    const id = String(m?.id ?? '').trim();
    if (!id || remoteHas.has(id) || emitted.has(id)) continue;
    emitted.add(id);
    out.push(m);
  }
  return out;
}

/**
 * Phase 5 gap detection (pure): does an inbound message imply we're missing earlier
 * history? True when the message comes from the *other* peer and names a `prevSeen`
 * predecessor that we don't already hold — i.e. the thread skipped ahead and we should
 * ask the peer to re-send its digest so it can backfill the middle. Our own echoes and
 * messages with no/known predecessor never trigger a re-digest.
 */
export function messageIntroducesGap(
  localIds: ReadonlyArray<string> | ReadonlySet<string>,
  wire: { senderId?: string; prevSeen?: string },
  localUserId: string,
): boolean {
  if (!wire || wire.senderId === localUserId) return false;
  const prev = String(wire.prevSeen ?? '').trim();
  if (!prev) return false;
  const have = localIds instanceof Set ? localIds : new Set([...localIds].map((id) => String(id)));
  return !have.has(prev);
}

/**
 * Given received backfill, return only the messages not already held locally, so the
 * caller writes each exactly once (writes are idempotent by id anyway, but this keeps
 * the apply set minimal). Order is preserved.
 */
export function selectNewBackfill(
  localIds: ReadonlyArray<string> | ReadonlySet<string>,
  backfill: ReadonlyArray<ReconcileMessage>,
): ReconcileMessage[] {
  const have = localIds instanceof Set ? localIds : new Set([...localIds].map((id) => String(id)));
  const out: ReconcileMessage[] = [];
  const emitted = new Set<string>();
  for (const m of backfill) {
    const id = String(m?.id ?? '').trim();
    if (!id || have.has(id) || emitted.has(id)) continue;
    emitted.add(id);
    out.push(m);
  }
  return out;
}
