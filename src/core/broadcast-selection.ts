/**
 * Who is still owed which of my Talks (OPEN-91 P4), moved out of `src/web/ui/`: the broadcast's
 * target selection. Pure over the lookups it is given (My Talks, and whether a Talk is owed to a
 * person, from the device graph's exchange index); the GUI module supplies its own.
 */

export type BroadcastDeliverySelectionDeps = {
  getMyTalks: () => Record<string, any>;
  getBroadcastableTalkIds: () => string[];
  /** A version of the Talk they do not have, or parts of it that never passed between us. */
  owedTo: (receiverId: string, talkId: string, talk: any) => boolean;
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
 * True when this Talk is still owed to the receiver. What was exchanged is per person, not per
 * room: delivery in one room suppresses the same content in another, while an edit (a new
 * version) is owed again. A tag Talk stays owed while any of its tags has not passed between us.
 */
export function isBroadcastUnsentForReceiver(receiverId: string, talkId: string, deps: BroadcastDeliverySelectionDeps): boolean {
  const talk = deps.getMyTalks()[talkId];
  const fullTalk = talk?.fullTalk || talk;
  if (!fullTalk) return true;
  return deps.owedTo(receiverId, talkId, fullTalk);
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
