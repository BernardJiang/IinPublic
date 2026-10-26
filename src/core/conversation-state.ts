/**
 * How a conversation's state changes (OPEN-91 P4), moved out of `src/web/ui/conversation-record-updates.ts`:
 * the author retracted the Talk (withdrawn), the other person changed their answer (ended), or a
 * deal was confirmed with someone else (superseded). Each changes the given conversations map in
 * place and says whether anything changed; the caller saves it and redraws.
 */
type Conversations = Record<string, any>;

function findConversation(conversations: Conversations, otherUserId: string, talkId: string, fallback: (c: any) => boolean): string | undefined {
  return Object.keys(conversations).find((id) => conversations[id]?.otherUserId === otherUserId && conversations[id]?.talkId === talkId)
    ?? Object.keys(conversations).find((id) => fallback(conversations[id]));
}

/** The author retracted the Talk: the match is gone. Falls back to the Talk alone (author-side teardown). */
export function withdrawConversation(conversations: Conversations, otherUserId: string, talkId: string, retractedAt: number): boolean {
  const id = findConversation(conversations, otherUserId, talkId, (c) => c?.talkId === talkId);
  if (!id) return false;
  const at = new Date(retractedAt).toISOString();
  Object.assign(conversations[id], {
    status: 'withdrawn',
    retractedAt: at,
    lastMessage: `Author removed this talk — the match is gone · ${new Date(retractedAt).toLocaleString()}`,
    lastMessageTime: at,
  });
  return true;
}

/** Step 9: the other person changed their answer from a match (a durable "answer changed" label). */
export function endConversation(conversations: Conversations, otherUserId: string, talkId: string, changedAt: string): boolean {
  const id = findConversation(conversations, otherUserId, talkId, (c) => c?.otherUserId === otherUserId);
  if (!id) return false;
  Object.assign(conversations[id], {
    status: 'ignored',
    changedAt,
    lastMessage: `Answer changed · ${new Date(changedAt).toLocaleString()}`,
    lastMessageTime: changedAt,
  });
  return true;
}

/** A deal was confirmed elsewhere for the same need: these open conversations end. */
export function supersedeConversations(conversations: Conversations, conversationIds: string[], changedAt: string): boolean {
  let changed = false;
  for (const id of conversationIds) {
    const c = conversations[id];
    if (!c || c.status === 'ignored' || c.status === 'withdrawn') continue;
    Object.assign(c, {
      status: 'ignored',
      changedAt,
      lastMessage: `No longer available — the deal was confirmed with someone else · ${new Date(changedAt).toLocaleString()}`,
      lastMessageTime: changedAt,
    });
    changed = true;
  }
  return changed;
}

/** My other conversations through the same Talk of mine — several responders matched it. */
export function otherDealConversationIds(conversations: Conversations, talkId: string, keepOtherUserId: string): string[] {
  return Object.keys(conversations).filter((id) => conversations[id]?.talkId === talkId && conversations[id]?.otherUserId !== keepOtherUserId);
}

/** What a new or re-synced conversation record carries (`addNewConversation`'s input). */
export type ConversationRecordInput = {
  conversationId: string;
  otherUserId: string;
  otherUserName: string;
  talkId?: string;
  relatedTalkIds?: string[];
  relatedTalkIdsJson?: string;
  respondedByBot?: boolean;
  supportChannel?: boolean;
  transportMode?: string;
  transportFallbackReason?: string | null;
  changeOfMindAt?: string;
  dealEligible?: boolean;
  matchScore?: number;
  matchTotal?: number;
};

/**
 * A conversation record after a new match or a re-sync: what a sync must never drop is kept (bot
 * and deal flags, thread previews, unread counts, status, the change-of-mind and retraction
 * times), the better name wins, and the Talks it formed through are unioned.
 */
export function mergeConversationRecord(
  existing: any,
  conversationData: ConversationRecordInput,
  getPeerName: (userId: string, fallback?: string) => string,
  nowIso: string,
): Record<string, any> {
  const isNew = !existing;

  // Keep bot provenance sticky once true; some sync paths can emit records without this field.
  const respondedByBot = !!existing?.respondedByBot || conversationData.respondedByBot === true;
  // Sticky like respondedByBot — the ingest/sync path may re-emit without this field.
  const dealEligible = !!existing?.dealEligible || conversationData.dealEligible === true;
  const matchScore = conversationData.matchScore ?? existing?.matchScore;
  const matchTotal = conversationData.matchTotal ?? existing?.matchTotal;
  const incomingName = conversationData.otherUserName?.trim() || '';
  const existingName = existing?.otherUserName?.trim() || '';
  const preferredOtherUserName =
    incomingName && incomingName !== 'Unknown' && incomingName !== 'Someone'
      ? incomingName
      : existingName && existingName !== 'Unknown' && existingName !== 'Someone'
        ? existingName
        : incomingName || existingName || 'Unknown';
  const resolvedOtherUserName = getPeerName(
    conversationData.otherUserId,
    preferredOtherUserName,
  );

  const isSupportChannel = !!existing?.supportChannel || conversationData.supportChannel === true;
  const relatedTalkIds = new Set<string>();
  const addRelatedTalkId = (talkId: unknown) => {
    const value = String(talkId ?? '').trim();
    if (!value || value === 'direct') return;
    relatedTalkIds.add(value);
  };
  if (Array.isArray(existing?.relatedTalkIds)) {
    for (const talkId of existing.relatedTalkIds) addRelatedTalkId(talkId);
  }
  if (typeof existing?.relatedTalkIdsJson === 'string') {
    try {
      const parsed = JSON.parse(existing.relatedTalkIdsJson);
      if (Array.isArray(parsed)) {
        for (const talkId of parsed) addRelatedTalkId(talkId);
      }
    } catch {
      /* keep existing valid metadata only */
    }
  }
  if (Array.isArray(conversationData.relatedTalkIds)) {
    for (const talkId of conversationData.relatedTalkIds) addRelatedTalkId(talkId);
  }
  if (typeof conversationData.relatedTalkIdsJson === 'string') {
    try {
      const parsed = JSON.parse(conversationData.relatedTalkIdsJson);
      if (Array.isArray(parsed)) {
        for (const talkId of parsed) addRelatedTalkId(talkId);
      }
    } catch {
      /* ignore malformed incoming metadata */
    }
  }
  addRelatedTalkId(existing?.talkId);
  addRelatedTalkId(conversationData.talkId);
  const relatedTalkIdList = Array.from(relatedTalkIds);
  const displayTalkId =
    conversationData.talkId && conversationData.talkId !== 'direct'
      ? conversationData.talkId
      : existing?.talkId || conversationData.talkId;

  return {
    conversationId: conversationData.conversationId,
    otherUserId: conversationData.otherUserId,
    otherUserName: resolvedOtherUserName,
    ...(isSupportChannel ? {} : { talkId: displayTalkId }),
    ...(isSupportChannel || relatedTalkIdList.length === 0
      ? {}
      : {
          relatedTalkIds: relatedTalkIdList,
          relatedTalkIdsJson: JSON.stringify(relatedTalkIdList),
        }),
    createdAt: existing?.createdAt ?? nowIso,
    lastMessage: existing?.lastMessage ?? null,
    lastMessageTime: existing?.lastMessageTime ?? null,
    // Per-thread previews and unread counts are local (syncConversationMessageSummary); a re-sync
    // of the record must not drop them, or a Thread row falls back to "Start chatting..." (stage2/69).
    ...(existing?.threadSummaries ? { threadSummaries: existing.threadSummaries } : {}),
    ...(existing?.unreadCount !== undefined ? { unreadCount: existing.unreadCount } : {}),
    unread: isSupportChannel ? false : isNew ? true : (existing?.unread ?? false),
    respondedByBot,
    dealEligible,
    ...(matchScore !== undefined ? { matchScore } : {}),
    ...(matchTotal !== undefined ? { matchTotal } : {}),
    supportChannel: isSupportChannel,
    transportMode: conversationData.transportMode ?? existing?.transportMode ?? 'star-gun',
    transportFallbackReason:
      existing?.transportFallbackReason ?? conversationData.transportFallbackReason ?? null,
    ...(existing?.status ? { status: existing.status } : {}),
    ...(existing?.changedAt ? { changedAt: existing.changedAt } : {}),
    // Step 10: a re-sync after the author retracted keeps the retraction time with the status.
    ...(existing?.retractedAt ? { retractedAt: existing.retractedAt } : {}),
    // Step 9: record change-of-mind timestamp for durable UI assertion
    ...(conversationData.changeOfMindAt || existing?.changeOfMindAt
      ? { changeOfMindAt: conversationData.changeOfMindAt ?? existing?.changeOfMindAt }
      : {}),
  };
}
