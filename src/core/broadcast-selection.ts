/**
 * Who is still owed which of my Talks (OPEN-91 P4), moved out of `src/web/ui/`: the broadcast's
 * target selection. Pure over the lookups it is given (My Talks, the delivery ledger's
 * suppression, the revision each peer last took); the GUI module supplies its own.
 */
import { computeTalkIdFromTalkData } from '../shared/cid';
import { computeTalkRevisionHash } from '../shared/talk-revision';
import { buildTagIdentityKeys } from '../shared/talk-ledger';

export type BroadcastDeliverySelectionDeps = {
  getMyTalks: () => Record<string, any>;
  getBroadcastableTalkIds: () => string[];
  shouldSuppressForPeer: (receiverId: string, identityKey: string) => boolean;
  /** OPEN-45: peer has this content but an older title/routing revision (read-only check). */
  revisionOwedToPeer?: (receiverId: string, talkId: string, revision: string) => boolean;
};

export function resolveExpiresAtMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return new Date(value).getTime();
  return Number.NaN;
}

/** My Talks I can broadcast or send: created or copied, not disabled, not expired. */
export function broadcastableTalkIds(myTalks: Record<string, any>, nowMs: number): string[] {
  return Object.entries(myTalks)
    .filter(([, talk]) => {
      if (talk?.disabled) return false;
      if (talk?.role !== 'created' && talk?.role !== 'copied') return false;
      const expiresAt = resolveExpiresAtMs(talk?.expiresAt ?? talk?.fullTalk?.expiresAt);
      return !(Number.isFinite(expiresAt) && nowMs > expiresAt);
    })
    .map(([id]) => id);
}

/**
 * True when this talk's current content identity is still owed to the receiver.
 * Suppression is peer+identity scoped, not room-scoped: delivery in one room suppresses the
 * same content in another, while a genuine content edit produces a new identity and remains
 * eligible. Tag talks use the same per-tag identities as the delivery ledger, and remain owed
 * while any independently deliverable tag has not been sent.
 */
export function isBroadcastUnsentForReceiver(receiverId: string, talkId: string, deps: BroadcastDeliverySelectionDeps): boolean {
  const talk = deps.getMyTalks()[talkId];
  const fullTalk = talk?.fullTalk || talk;
  if (!fullTalk) return true;
  const wholeTalkIdentityKey = computeTalkIdFromTalkData(fullTalk);
  const identityKeys = buildTagIdentityKeys(fullTalk, wholeTalkIdentityKey);
  if (identityKeys.some((identityKey) => !deps.shouldSuppressForPeer(receiverId, identityKey))) return true;
  return deps.revisionOwedToPeer?.(receiverId, talkId, computeTalkRevisionHash(fullTalk)) ?? false;
}

/** Broadcastable talk ids still owed to at least one receiver. */
export function getUnsentBroadcastTalkIds(receiverIds: string[], deps: BroadcastDeliverySelectionDeps): string[] {
  return deps.getBroadcastableTalkIds().filter((talkId) => receiverIds.some((receiverId) =>
    isBroadcastUnsentForReceiver(receiverId, talkId, deps)));
}

/** Broadcastable talk ids still owed to one receiver. */
export function getUnsentBroadcastTalkIdsForReceiver(receiverId: string, deps: BroadcastDeliverySelectionDeps): string[] {
  return deps.getBroadcastableTalkIds().filter((talkId) => isBroadcastUnsentForReceiver(receiverId, talkId, deps));
}

/** Per-talk receiver lists, avoiding re-sends to peers who already have that identity. */
export function getUnsentBroadcastTalkReceiverIds(talkIds: string[], receiverIds: string[], deps: BroadcastDeliverySelectionDeps): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const talkId of talkIds) result[talkId] = receiverIds.filter((receiverId) => isBroadcastUnsentForReceiver(receiverId, talkId, deps));
  return result;
}
