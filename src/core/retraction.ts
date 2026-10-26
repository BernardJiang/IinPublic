/**
 * Talk retractions (OPEN-91 P4), moved out of `app.ts`: which conversations a retraction touches,
 * who must hear of mine, and what one I receive changes. Pure; the caller writes the ledger,
 * notifies and marks conversations.
 */
import { retractedKey, type TalkLedgerDoc } from '../shared/talk-ledger';

/** The conversation formed through this Talk — directly, or as one of its related Talks. */
export function conversationReferencesTalk(conversation: any, talkId: string): boolean {
  if (!conversation || !talkId) return false;
  if (String(conversation.talkId || '') === talkId) return true;
  if (Array.isArray(conversation.relatedTalkIds) && conversation.relatedTalkIds.some((id: unknown) => String(id || '') === talkId)) return true;
  if (typeof conversation.relatedTalkIdsJson === 'string') {
    try {
      const parsed = JSON.parse(conversation.relatedTalkIdsJson);
      return Array.isArray(parsed) && parsed.some((id) => String(id || '') === talkId);
    } catch {
      return false;
    }
  }
  return false;
}

/** True once both people have confirmed the deal on this conversation record. */
export function isDealMutuallyConfirmed(conversation: any, userIdA: string, userIdB: string): boolean {
  if (typeof conversation?.dealConfirmedByJson !== 'string') return false;
  try {
    const confirmedBy = JSON.parse(conversation.dealConfirmedByJson);
    return Array.isArray(confirmedBy) && confirmedBy.includes(userIdA) && confirmedBy.includes(userIdB);
  } catch {
    return false;
  }
}

/** The people I matched through this Talk of mine: they hold copies to retract (by mailbox when offline). */
export function retractionRecipients(conversations: Record<string, any>, talkId: string, authorId: string): string[] {
  const recipients = new Set<string>();
  for (const conversation of Object.values(conversations)) {
    const otherId = String(conversation?.otherUserId || '');
    if (otherId && otherId !== authorId && conversationReferencesTalk(conversation, talkId)) recipients.add(otherId);
  }
  return [...recipients];
}

export type RetractionReceipt = {
  /** Not seen before (mesh and mailbox replay the same frame): tell the user once. */
  isNew: boolean;
  /** Withdraw my conversation with the author through this Talk — never a confirmed deal. */
  withdraw: boolean;
};

export function planRetractionReceipt(input: {
  ledger: TalkLedgerDoc;
  talkId: string;
  authorId: string;
  retractedAt: number;
  myId: string;
  conversations: Record<string, any>;
  /** Deals this session saw confirmed (a guard against a stale record). */
  confirmedThisSession: ReadonlySet<string>;
}): RetractionReceipt {
  const existing = input.ledger.retracted[retractedKey(input.talkId, input.authorId)];
  const isNew = !existing || input.retractedAt > existing.retractedAt;
  // The first conversation with the author through this Talk decides; a finalized deal is a
  // successful outcome, never undone by the retraction that followed it.
  for (const [conversationId, conversation] of Object.entries(input.conversations)) {
    if (!conversationReferencesTalk(conversation, input.talkId) || conversation?.otherUserId !== input.authorId) continue;
    const confirmed = input.confirmedThisSession.has(conversationId) || isDealMutuallyConfirmed(conversation, input.myId, input.authorId);
    return { isNew, withdraw: !confirmed };
  }
  return { isNew, withdraw: false };
}
