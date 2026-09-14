export type ConversationRecordUpdateDeps = {
  getMyConversations: () => Record<string, any>;
  updateMatchBadge: () => void;
  syncStatusBarMatchCount: () => void;
  refreshConversationsListIfActive: () => void;
};

function refreshAfterConversationRecordChange(deps: ConversationRecordUpdateDeps): void {
  deps.updateMatchBadge();
  deps.syncStatusBarMatchCount();
  const meTab = document.querySelector('.nav-btn[data-view="me"]');
  if (meTab?.classList.contains('active')) {
    deps.refreshConversationsListIfActive();
  }
}

/** Marks a conversation withdrawn after the author retracted its talk — the match is gone. */
export function markConversationWithdrawn(
  otherUserId: string,
  talkId: string,
  retractedAt: number,
  deps: ConversationRecordUpdateDeps,
): void {
  const conversations = deps.getMyConversations();
  const retractedAtStr = new Date(retractedAt).toISOString();
  // Find by otherUserId+talkId; fall back to talkId alone for author side.
  let convId = Object.keys(conversations).find((id) => {
    const c = conversations[id];
    return c?.otherUserId === otherUserId && c?.talkId === talkId;
  });
  if (!convId) {
    // Fallback: author-side teardown or retraction received before conversation was indexed
    convId = Object.keys(conversations).find((id) => {
      const c = conversations[id];
      return c?.talkId === talkId;
    });
  }
  if (!convId) return;
  conversations[convId].status = 'withdrawn';
  conversations[convId].retractedAt = retractedAtStr;
  conversations[convId].lastMessage = `Author removed this talk — the match is gone · ${new Date(retractedAt).toLocaleString()}`;
  conversations[convId].lastMessageTime = retractedAtStr;
  localStorage.setItem('myConversations', JSON.stringify(conversations));
  refreshAfterConversationRecordChange(deps);
}

/**
 * Step 9: Mark a conversation as ended (match→ignore change-of-mind).
 * Finds the conversation by otherUserId+talkId, sets status:'ignored' and
 * records the changedAt timestamp so the conversation-list renders a durable
 * "answer changed" label assertable by E2E tests.
 */
export function markConversationEnded(
  otherUserId: string,
  talkId: string,
  changedAt: string,
  deps: ConversationRecordUpdateDeps,
): void {
  const conversations = deps.getMyConversations();
  // Find the conversation by otherUserId + talkId
  let convId = Object.keys(conversations).find((id) => {
    const c = conversations[id];
    return c?.otherUserId === otherUserId && c?.talkId === talkId;
  });
  if (!convId) {
    convId = Object.keys(conversations).find((id) => conversations[id]?.otherUserId === otherUserId);
  }
  if (!convId) return;
  conversations[convId].status = 'ignored';
  conversations[convId].changedAt = changedAt;
  conversations[convId].lastMessage = `Answer changed · ${new Date(changedAt).toLocaleString()}`;
  conversations[convId].lastMessageTime = changedAt;
  localStorage.setItem('myConversations', JSON.stringify(conversations));
  refreshAfterConversationRecordChange(deps);
}

/**
 * Shared mutation for "a deal was confirmed elsewhere for the same underlying need": marks the
 * given already-open conversations (by id) as ignored, with the same wording regardless of
 * which grouping rule (same talkId, or same content-hash "need") picked them out.
 */
function markConversationsSuperseded(
  conversationIds: string[],
  changedAt: string,
  deps: ConversationRecordUpdateDeps,
): void {
  const conversations = deps.getMyConversations();
  let changed = false;
  for (const id of conversationIds) {
    const c = conversations[id];
    if (!c || c.status === 'ignored' || c.status === 'withdrawn') continue;
    c.status = 'ignored';
    c.changedAt = changedAt;
    c.lastMessage = `No longer available — the deal was confirmed with someone else · ${new Date(changedAt).toLocaleString()}`;
    c.lastMessageTime = changedAt;
    changed = true;
  }
  if (!changed) return;
  localStorage.setItem('myConversations', JSON.stringify(conversations));
  refreshAfterConversationRecordChange(deps);
}

/**
 * Marks every OTHER conversation for the SAME talkId as ignored once a deal is confirmed with
 * one peer — the case where several responders matched the one talk I authored.
 */
export function markOtherDealConversationsEnded(
  talkId: string,
  keepOtherUserId: string,
  changedAt: string,
  deps: ConversationRecordUpdateDeps,
): void {
  const conversations = deps.getMyConversations();
  const otherIds = Object.keys(conversations).filter(
    (id) => conversations[id]?.talkId === talkId && conversations[id]?.otherUserId !== keepOtherUserId,
  );
  markConversationsSuperseded(otherIds, changedAt, deps);
}

/**
 * Marks an explicit list of conversations (by id) as ignored — the cross-talkId case (docs/
 * TODO.md §JJ "known gap"): two DIFFERENT authors' talks (e.g. two drivers) both matched my own
 * request. Those conversations don't share a talkId, so the caller (app.ts's
 * `maybeFinalizeConfirmedDeal`) identifies them itself via a content-hash "need" grouping and
 * just asks this function to apply the same supersede mutation to that explicit id list.
 */
export function markConversationsSupersededByIds(
  conversationIds: string[],
  changedAt: string,
  deps: ConversationRecordUpdateDeps,
): void {
  markConversationsSuperseded(conversationIds, changedAt, deps);
}
