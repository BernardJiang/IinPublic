import { User } from '../../shared/types';
import { EventEmitter } from 'events';

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;

  initialize(): void {
    const container = document.getElementById('app');
    if (!container) {
      throw new Error('App container not found');
    }
    this.appContainer = container;
    this.setupBaseUI();
  }

  private setupBaseUI(): void {
    if (!this.appContainer) return;

    this.appContainer.innerHTML = `
      <div class="app-container">
        <div class="sidebar">
          <div class="header">
            <div class="user-info" id="user-info"></div>
          </div>
          <div class="conversation-list" id="conversation-list">
            <p>Loading conversations...</p>
          </div>
        </div>
        <div class="main-content">
          <div class="chatroom-info" id="chatroom-info">
            <div class="chatroom-title">Loading...</div>
            <div class="chatroom-status">Connecting...</div>
          </div>
          <div class="chat-area">
            <div class="messages-container" id="messages-container">
              <div class="text-center p-20">
                <p>Welcome to IinPublic! Select a conversation or start a new talk.</p>
              </div>
            </div>
            <div class="message-input-area">
              <div class="message-input-container">
                <textarea 
                  class="message-input" 
                  id="message-input" 
                  placeholder="Type a message or create a talk..."
                  rows="1"
                ></textarea>
                <button class="send-button" id="send-button">
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;

    if (sendButton && messageInput) {
      sendButton.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message) {
          this.emit('sendMessage', { conversationId: 'default', message });
          messageInput.value = '';
        }
      });

      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendButton.click();
        }
      });

      // Auto-resize textarea
      messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      });
    }
  }

  showMainInterface(user: User): void {
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">${user.stageName.charAt(0).toUpperCase()}</div>
        <div>
          <div><strong>${user.stageName}</strong></div>
          <div style="font-size: 0.8em; color: #666;">Online</div>
        </div>
      `;
    }

    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">Global Chatroom</div>
        <div class="chatroom-status">Connected • Ready to meet people nearby</div>
      `;
    }
  }

  async showUserCreationDialog(): Promise<any> {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Welcome to IinPublic!</h2>
            <p>Let's set up your profile to get started.</p>
          </div>
          <form id="user-creation-form">
            <div class="form-group">
              <label class="form-label">Stage Name (required)</label>
              <input type="text" class="form-input" id="stage-name" name="stage-name" required 
                     placeholder="Choose a name others will see">
            </div>
            <div class="form-group">
              <label class="form-label">Languages you understand</label>
              <select class="form-input" id="languages" name="languages" multiple>
                <option value="en" selected>English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
              </select>
            </div>
            <div class="modal-actions">
              <button type="submit" class="btn">Get Started</button>
            </div>
          </form>
        </div>
      `;

      document.body.appendChild(modal);

      const form = document.getElementById('user-creation-form') as HTMLFormElement;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const stageName = formData.get('stage-name') as string | null;

        if (stageName && stageName.trim()) {
          document.body.removeChild(modal);
          resolve({
            stageName: stageName.trim(),
            languages: ['en'], // Simplified for now
            interests: [],
          });
        }
      });
    });
  }

  displayNewMessage(message: any): void {
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
      const messageElement = document.createElement('div');
      messageElement.className = `message ${message.senderId === 'current_user' ? 'sent' : 'received'}`;
      messageElement.innerHTML = `
        <div class="message-bubble">
          ${message.text || message.message}
          <div class="message-time">${new Date().toLocaleTimeString()}</div>
        </div>
      `;
      messagesContainer.appendChild(messageElement);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  displayIncomingTalk(_conversation: any): void {
    this.showNotification('New talk received!', 'info');
  }

  updateConversation(_conversationId: string, result: any): void {
    console.log('Conversation updated:', result);
  }

  updateChatroomInfo(info: { id: string; name: string } | any): void {
    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo && info.id && info.name) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">${info.name}</div>
        <div class="chatroom-status">Connected</div>
      `;
    } else {
      console.log('Chatroom updated:', info);
    }
  }

  updateUserInfo(user: User): void {
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">${user.stageName.charAt(0).toUpperCase()}</div>
        <div>
          <div><strong>${user.stageName}</strong></div>
          <div style="font-size: 0.8em; color: #666;">Online</div>
        </div>
      `;
    }
  }

  showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 3000);
  }

  showTalkCompletion(_conversationId: string, outcome: string): void {
    this.showNotification(`Talk completed with outcome: ${outcome}`, 'success');
  }

  showLinearCaptureInterface(_conversationId: string, _capture: any): void {
    this.showNotification('Auto-talk captured! You can reuse this later.', 'info');
  }

  refreshTalksList(): void {
    // Placeholder for refreshing talks list
  }

  updateChatroomMembers(
    members: Array<{ userId: string; stageName: string }>,
    currentUserId: string,
  ): void {
    const conversationList = document.getElementById('conversation-list');
    if (!conversationList) return;

    const otherMembers = members.filter((member) => member.userId !== currentUserId);

    if (otherMembers.length === 0) {
      conversationList.innerHTML = `
        <div class="empty-state">
          <p>No other users in this chatroom yet.</p>
          <p style="font-size: 0.9em; color: #666;">Waiting for others to join...</p>
        </div>
      `;
    } else {
      conversationList.innerHTML = `
        <h3 style="padding: 10px; color: #666; font-size: 0.9em;">Online Users (${otherMembers.length})</h3>
        ${otherMembers
          .map(
            (member) => `
          <div class="user-item" data-user-id="${member.userId}">
            <div class="user-avatar">${member.stageName.charAt(0).toUpperCase()}</div>
            <div class="user-details">
              <div class="user-name">${member.stageName}</div>
              <div class="user-status">Online</div>
            </div>
            <button class="btn-send-talk" data-user-id="${member.userId}">Send Talk</button>
          </div>
        `,
          )
          .join('')}
      `;

      // Add click handlers for send talk buttons
      conversationList.querySelectorAll('.btn-send-talk').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const targetUserId = (e.target as HTMLElement).getAttribute('data-user-id');
          if (targetUserId) {
            this.emit('sendTalkToUser', { userId: targetUserId });
          }
        });
      });
    }
  }
}
