type ConversationRecord = {
  otherUserName?: string;
  unread?: boolean;
  respondedByBot?: boolean;
  lastMessageTime?: string;
  createdAt?: string;
  lastMessage?: string;
};

type ConversationsViewDeps = {
  getMyConversations: () => Record<string, ConversationRecord>;
  escapeHtml: (text: string) => string;
  formatTimeAgo: (date: Date) => string;
  showConversationDetail: (conversationId: string) => void;
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
        <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">No conversations yet</p>
        <p style="font-size: 0.9em; color: #999;">Match with someone through talks to start chatting!</p>
      </div>
    `;
    return;
  }

  conversationsList.innerHTML = conversationEntries
    .map(
      ([conversationId, conversation]) => `
        <div class="conversation-list-item ${conversation.unread ? 'unread' : ''}" data-conversation-id="${conversationId}" data-responded-by-bot="${!!conversation.respondedByBot}">
          <div class="conversation-avatar-wrapper" style="position: relative;">
            <div class="conversation-avatar">
              ${conversation.otherUserName?.charAt(0).toUpperCase() || '?'}
            </div>
            ${conversation.respondedByBot ? '<span class="conversation-bot-badge" title="Answered by chatbot">🤖</span>' : ''}
          </div>
          <div class="conversation-content">
            <div class="conversation-header">
              <div class="conversation-name">${deps.escapeHtml(conversation.otherUserName || 'Unknown')}</div>
              <div class="conversation-time">${deps.formatTimeAgo(new Date(conversation.lastMessageTime || conversation.createdAt || 0))}</div>
            </div>
            <div class="conversation-preview">
              ${conversation.unread ? '<span class="unread-badge"></span>' : ''}
              ${deps.escapeHtml(conversation.lastMessage || 'Matched! Start a conversation...')}
            </div>
          </div>
        </div>
      `,
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
