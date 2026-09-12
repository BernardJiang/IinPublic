import { computeTalkIdFromTalkData } from '../../shared/cid';
import { buildTagIdentityKeys } from '../../shared/talk-ledger';
import { shouldSuppressForPeer } from '../services/web-talk-ledger-store';
import { getBroadcastableTalkIds } from './broadcast-audience-preview';
import { getMyTalks } from './my-talks-storage';

export type BroadcastDeliverySelectionDeps = {
  getMyTalks: () => Record<string, any>;
  getBroadcastableTalkIds: () => string[];
  shouldSuppressForPeer: (receiverId: string, identityKey: string) => boolean;
};

const defaultDeps: BroadcastDeliverySelectionDeps = {
  getMyTalks,
  getBroadcastableTalkIds,
  shouldSuppressForPeer,
};

/**
 * True when this talk's current content identity is still owed to the receiver.
 * Suppression is peer+identity scoped, not room-scoped: delivery in one room suppresses the
 * same content in another, while a genuine content edit produces a new identity and remains
 * eligible. Tag talks use the same per-tag identities as the delivery ledger, and remain owed
 * while any independently deliverable tag has not been sent.
 */
export function isBroadcastUnsentForReceiver(
  receiverId: string,
  talkId: string,
  deps: BroadcastDeliverySelectionDeps = defaultDeps,
): boolean {
  const talk = deps.getMyTalks()[talkId];
  const fullTalk = talk?.fullTalk || talk;
  if (!fullTalk) return true;
  const wholeTalkIdentityKey = computeTalkIdFromTalkData(fullTalk);
  const identityKeys = buildTagIdentityKeys(fullTalk, wholeTalkIdentityKey);
  return identityKeys.some((identityKey) => !deps.shouldSuppressForPeer(receiverId, identityKey));
}

/** Broadcastable talk ids still owed to at least one receiver. */
export function getUnsentBroadcastTalkIds(
  receiverIds: string[],
  deps: BroadcastDeliverySelectionDeps = defaultDeps,
): string[] {
  return deps.getBroadcastableTalkIds().filter((talkId) => receiverIds.some((receiverId) =>
    isBroadcastUnsentForReceiver(receiverId, talkId, deps)));
}

/** Broadcastable talk ids still owed to one receiver. */
export function getUnsentBroadcastTalkIdsForReceiver(
  receiverId: string,
  deps: BroadcastDeliverySelectionDeps = defaultDeps,
): string[] {
  return deps.getBroadcastableTalkIds().filter((talkId) =>
    isBroadcastUnsentForReceiver(receiverId, talkId, deps));
}

/** Per-talk receiver lists, avoiding re-sends to peers who already have that identity. */
export function getUnsentBroadcastTalkReceiverIds(
  talkIds: string[],
  receiverIds: string[],
  deps: BroadcastDeliverySelectionDeps = defaultDeps,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const talkId of talkIds) {
    result[talkId] = receiverIds.filter((receiverId) =>
      isBroadcastUnsentForReceiver(receiverId, talkId, deps));
  }
  return result;
}
