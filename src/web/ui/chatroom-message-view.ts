import { escapeHtml } from './ui-formatters';

export type ChatroomMessageInput = {
  id: string;
  text: string;
  senderName: string;
  timestamp: string;
  isOwnMessage: boolean;
};

/**
 * Renders one public chatroom message bubble into `#messages-container`, deduping by
 * `msg-${id}` and clearing the "no messages yet" welcome placeholder on first message.
 * Pure DOM append — no `UIManager` instance state.
 */
export function renderChatroomMessage(message: ChatroomMessageInput): void {
  const messagesContainer = document.getElementById('messages-container');
  if (!messagesContainer) return;

  // Check if message already exists to avoid duplicates
  if (document.getElementById(`msg-${message.id}`)) {
    return;
  }

  // Clear welcome message if it exists
  const welcomeMsg = messagesContainer.querySelector('.text-center.p-20');
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

  const messageTime = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const messageDiv = document.createElement('div');
  messageDiv.id = `msg-${message.id}`;
  messageDiv.className = `message ${message.isOwnMessage ? 'sent' : ''}`;
  messageDiv.innerHTML = `
    <div class="message-bubble">
      ${!message.isOwnMessage ? `<div style="font-weight: bold; font-size: 0.85em; margin-bottom: 4px; color: var(--accent);">${escapeHtml(message.senderName)}</div>` : ''}
      <div>${escapeHtml(message.text)}</div>
      <div class="message-time">${messageTime}</div>
    </div>
  `;

  messagesContainer.appendChild(messageDiv);

  // Auto-scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
