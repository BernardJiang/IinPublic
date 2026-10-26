/** The state changes are the device core's (src/core/conversation-state.ts); this saves and redraws. */
import { endConversation, otherDealConversationIds, supersedeConversations, withdrawConversation } from '../../core/conversation-state';
import { setMyConversations } from './my-conversations-storage';

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
export function markConversationWithdrawn(otherUserId: string, talkId: string, retractedAt: number, deps: ConversationRecordUpdateDeps): void {
  const conversations = deps.getMyConversations();
  if (!withdrawConversation(conversations, otherUserId, talkId, retractedAt)) return;
  setMyConversations(conversations);
  refreshAfterConversationRecordChange(deps);
}

/** Step 9: mark a conversation as ended (match→ignore change-of-mind). */
export function markConversationEnded(otherUserId: string, talkId: string, changedAt: string, deps: ConversationRecordUpdateDeps): void {
  const conversations = deps.getMyConversations();
  if (!endConversation(conversations, otherUserId, talkId, changedAt)) return;
  setMyConversations(conversations);
  refreshAfterConversationRecordChange(deps);
}

function markConversationsSuperseded(conversationIds: string[], changedAt: string, deps: ConversationRecordUpdateDeps): void {
  const conversations = deps.getMyConversations();
  if (!supersedeConversations(conversations, conversationIds, changedAt)) return;
  setMyConversations(conversations);
  refreshAfterConversationRecordChange(deps);
}

/** Once a deal is confirmed with one peer, every OTHER conversation through the same Talk ends. */
export function markOtherDealConversationsEnded(talkId: string, keepOtherUserId: string, changedAt: string, deps: ConversationRecordUpdateDeps): void {
  markConversationsSuperseded(otherDealConversationIds(deps.getMyConversations(), talkId, keepOtherUserId), changedAt, deps);
}

/** The cross-Talk case (TODO §JJ): conversations the caller grouped by their content-hash need. */
export function markConversationsSupersededByIds(conversationIds: string[], changedAt: string, deps: ConversationRecordUpdateDeps): void {
  markConversationsSuperseded(conversationIds, changedAt, deps);
}
