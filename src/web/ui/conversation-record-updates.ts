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
