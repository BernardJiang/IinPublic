import type { UiTranslationKey } from './ui-translations';

type ConversationRecord = {
  otherUserName?: string;
  unread?: boolean;
  respondedByBot?: boolean;
  supportChannel?: boolean;
  lastMessageTime?: string;
  createdAt?: string;
  lastMessage?: string;
  /** Step 9: ISO timestamp when responder changed their mind creating this match. */
  changeOfMindAt?: string;
  /** Step 9: 'ignored' when a match→ignore change-of-mind ended this conversation. */
  status?: string;
  /** Step 9: ISO timestamp when a match→ignore change happened. */
  changedAt?: string;
  /** Step 10: ISO timestamp when the author retracted the talk. */
  retractedAt?: string;
};

type ConversationsViewDeps = {
  getMyConversations: () => Record<string, ConversationRecord>;
  escapeHtml: (text: string) => string;
  formatTimeAgo: (date: Date) => string;
  showConversationDetail: (conversationId: string) => void;
  text: (key: UiTranslationKey) => string;
  formatMessage: (message: string, supportChannel: boolean) => string;
};

export function displayConversationsList(deps: ConversationsViewDeps): void {
  const conversationsList = document.getElementById('conversations-list');
  if (!conversationsList) return;

  const myConversations = deps.getMyConversations();
  const conversationEntries = Object.entries(myConversations).sort(
    ([, a], [, b]) =>
      new Date(b.lastMessageTime || b.createdAt || 0).getTime() -
      new Date(a.lastMessageTime || a.createdAt || 0).getTime(),
  );

  if (conversationEntries.length === 0) {
    conversationsList.innerHTML = `
      <div class="empty-state" style="padding: 60px 20px; text-align: center;">
        <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
        <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">${deps.text('conversationNoConversations')}</p>
        <p style="font-size: 0.9em; color: #999;">${deps.text('conversationFindMatch')}</p>
      </div>
    `;
    return;
  }

  conversationsList.innerHTML = conversationEntries
    .map(
      ([conversationId, conversation]) => {
        const isEnded = conversation.status === 'ignored' || conversation.status === 'withdrawn';
        const changeTs = conversation.changeOfMindAt || conversation.changedAt;
        const retractedTs = conversation.retractedAt;
        return `
        <div class="conversation-list-item ${conversation.unread ? 'unread' : ''} ${isEnded ? 'conversation-ended' : ''}"
             data-conversation-id="${conversationId}"
             data-responded-by-bot="${!!conversation.respondedByBot}"
             data-conversation-status="${deps.escapeHtml(conversation.status || 'active')}"
             ${changeTs ? `data-change-of-mind-at="${deps.escapeHtml(changeTs)}"` : ''}
             ${retractedTs ? `data-retracted-at="${deps.escapeHtml(retractedTs)}"` : ''}>
          <div class="conversation-avatar-wrapper" style="position: relative;">
            <div class="conversation-avatar">
              ${conversation.otherUserName?.charAt(0).toUpperCase() || '?'}
            </div>
            ${conversation.respondedByBot ? `<span class="conversation-bot-badge" title="${deps.escapeHtml(deps.text('conversationBotAnswered'))}">🤖</span>` : ''}
          </div>
          <div class="conversation-content">
            <div class="conversation-header">
              <div class="conversation-name">${deps.escapeHtml(conversation.otherUserName || deps.text('conversationUnknown'))}</div>
              <div class="conversation-time">${deps.formatTimeAgo(new Date(conversation.lastMessageTime || conversation.createdAt || 0))}</div>
            </div>
            <div class="conversation-preview">
              ${conversation.unread ? '<span class="unread-badge"></span>' : ''}
              ${deps.escapeHtml(deps.formatMessage(
                conversation.lastMessage || deps.text('conversationMatchedPreview'),
                conversation.supportChannel === true,
              ))}
            </div>
          </div>
        </div>
        `;
      },
    )
    .join('');

  conversationsList.querySelectorAll('.conversation-list-item').forEach((item) => {
    item.addEventListener('click', () => {
      const conversationId = (item as HTMLElement).dataset.conversationId;
      if (conversationId) {
        deps.showConversationDetail(conversationId);
      }
    });
  });
}
