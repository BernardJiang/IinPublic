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
