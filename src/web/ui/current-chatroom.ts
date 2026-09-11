import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';

export type SetCurrentChatroomIdDeps = {
  setCurrentChatroom: (chatroomId: string) => void;
  renderChatroomList: () => void;
  resolveChatroomTitle: (chatroomId: string) => string;
  t: (key: UiTranslationKey) => string;
  syncReturnHomeButton: () => void;
};

export function setCurrentChatroomId(chatroomId: string, deps: SetCurrentChatroomIdDeps): void {
  if (!chatroomId) return;
  deps.setCurrentChatroom(chatroomId);
  deps.renderChatroomList();
  const detailContainer = document.getElementById('chatroom-detail-container');
  if (detailContainer && detailContainer.style.display !== 'none') {
    const roomName = deps.resolveChatroomTitle(chatroomId);
    const chatroomTitle = document.getElementById('current-chatroom-title');
    const chatroomStatus = document.getElementById('current-chatroom-status');
    if (chatroomTitle) chatroomTitle.textContent = roomName;
    if (chatroomStatus) chatroomStatus.textContent = deps.t('chatroomLoadingMembers');
    const membersList = document.getElementById('chatroom-members-list');
    if (membersList) {
      membersList.innerHTML =
        `<div style="padding: 20px; text-align: center; color: #999;">${escapeHtml(deps.t('chatroomLoadingOnlineUsers'))}</div>`;
    }
  }
  deps.syncReturnHomeButton();
}
