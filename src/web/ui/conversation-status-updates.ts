import type { UiTranslationKey } from './ui-translations';

export type UpdateConversationTransportModeDeps = {
  getMyConversations: () => Record<string, any>;
  getCurrentConversationId: () => string | undefined;
  t: (key: UiTranslationKey) => string;
  formatTransportMode: (mode: string) => string;
  formatTransportFallback: (mode: string, reason?: string | null) => string;
};

/** Records a conversation's current transport mode/fallback reason and, if it's the currently open conversation, patches the visible status line. */
export function updateConversationTransportMode(
  conversationId: string,
  transportMode: string,
  transportFallbackReason: string | null | undefined,
  deps: UpdateConversationTransportModeDeps,
): void {
  const conversations = deps.getMyConversations();
  const conversation = conversations[conversationId];
  if (!conversation) return;
  conversation.transportMode = transportMode;
  if (transportFallbackReason !== undefined) {
    conversation.transportFallbackReason = transportFallbackReason;
  }
  localStorage.setItem('myConversations', JSON.stringify(conversations));
  if (deps.getCurrentConversationId() === conversationId) {
    const transportStatus = document.getElementById('conversation-transport-status');
    if (transportStatus) {
      transportStatus.dataset.transportMode = transportMode;
      transportStatus.textContent = `${deps.t('conversationTransport')}: ${deps.formatTransportMode(transportMode)}`;
    }
    const fallbackStatus = document.getElementById('conversation-fallback-status');
    if (fallbackStatus) {
      fallbackStatus.textContent = deps.formatTransportFallback(
        transportMode,
        conversation.transportFallbackReason,
      );
    }
  }
}

export type SetConversationOnlineStatusDeps = {
  getMyConversations: () => Record<string, any>;
  refreshConversationsListIfActive: () => void;
  setOnlineUserIds: (ids: Set<string>) => void;
  refreshContactsListIfActive: () => void;
  patchPresenceIndicators: () => void;
};

/**
 * Same real-presence signal used everywhere a person can appear: conversations, ordinary
 * contact rows (`contacts-view.ts`), and chatroom member rows (`chatrooms-view.ts`) all show
 * the same online/away dot. The chatroom roster is patched in place rather than re-rendered —
 * see `patchTechSupportPresenceIndicators`'s own comment for why.
 */
export function setConversationOnlineStatus(otherUserIds: Set<string>, deps: SetConversationOnlineStatusDeps): void {
  const conversations = deps.getMyConversations();
  let changed = false;
  for (const conversation of Object.values(conversations)) {
    const online = otherUserIds.has(String((conversation as any).otherUserId || ''));
    if ((conversation as any).online !== online) {
      (conversation as any).online = online;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    const meTab = document.querySelector('.nav-btn[data-view="me"]');
    if (meTab?.classList.contains('active')) deps.refreshConversationsListIfActive();
  }

  deps.setOnlineUserIds(otherUserIds);
  const contactsTab = document.querySelector('.nav-btn[data-view="contacts"]');
  // getMyConversations()/deriveLocalPeers() read live localStorage, never a stale snapshot,
  // so a full re-render here is safe (same reasoning as setTechSupportOnlineStatus above).
  if (contactsTab?.classList.contains('active')) deps.refreshContactsListIfActive();
  deps.patchPresenceIndicators();
}
