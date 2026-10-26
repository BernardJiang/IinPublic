import { broadcastableTalkIds, resolveExpiresAtMs } from '../../core/broadcast-selection';
import { getMyTalks } from './my-talks-storage';

export { resolveExpiresAtMs };

export type BroadcastAudiencePreview = {
  talkId: string;
  title: string;
  totalCandidates: number;
  eligibleReceivers: number;
  /** Server preview ids (P0 mesh uses this instead of registering on hub). */
  eligibleReceiverIds?: string[];
  rejectedByCounts: Record<string, number>;
  eligibleReceiverNames?: string[];
  rejectedReceiverDetails?: Array<{ name: string; rejectedBy: string[] }>;
  supportExcludedCount?: number;
  previewUnavailable?: boolean;
  /** Sender-side omission: talk cannot be broadcast or peer-sent (expired/disabled). */
  senderOmittedBy?: string[];
};

/** Talks eligible for broadcast or direct peer send from the local OUT-talk store. */
export function getBroadcastableTalkIds(): string[] {
  return broadcastableTalkIds(getMyTalks(), Date.now());
}

/** Full local payload used when the network lookup is slow during a broadcast. */
export function getBroadcastTalkPayload(talkId: string): any | null {
  const row = getMyTalks()[talkId];
  // docs/TODO.md §Y1: broadcasting a copied-but-unedited talk keeps the original sender as
  // authorId — copying isn't authorship.
  const full = row?.fullTalk;
  if (!full) return null;
  // Tag talks have no questions; non-tag talks require at least one question.
  if (full.type !== 'tag' && (!Array.isArray(full.questions) || full.questions.length === 0)) {
    return null;
  }
  return full;
}

/** OUT talks omitted from broadcast/peer send because they are disabled or expired. */
export function getSenderOmittedBroadcastPreviews(): BroadcastAudiencePreview[] {
  const myTalks = getMyTalks();
  const now = Date.now();
  const previews: BroadcastAudiencePreview[] = [];
  for (const [talkId, talk] of Object.entries(myTalks)) {
    if (talk?.role !== 'created' && talk?.role !== 'copied') continue;
    const omittedBy: string[] = [];
    if (talk?.disabled) omittedBy.push('broadcast_disabled');
    const expiresAt = talk?.expiresAt ?? talk?.fullTalk?.expiresAt;
    const expiresAtMs = resolveExpiresAtMs(expiresAt);
    if (Number.isFinite(expiresAtMs) && now > expiresAtMs) omittedBy.push('talk_expired');
    if (omittedBy.length === 0) continue;
    previews.push({
      talkId,
      title: String(talk?.title || talk?.fullTalk?.title || talkId),
      totalCandidates: 0,
      eligibleReceivers: 0,
      rejectedByCounts: Object.fromEntries(omittedBy.map((reason) => [reason, 1])),
      senderOmittedBy: omittedBy,
    });
  }
  return previews.sort((a, b) => a.title.localeCompare(b.title));
}
