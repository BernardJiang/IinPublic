import { User } from '../../shared/types';
import { EventEmitter } from 'events';
import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;
  private currentChatroom: string = 'global';
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];
  private currentConversationId: string | undefined = undefined;
  private chatroomMemberCounts: Map<string, number> = new Map(); // Track member count per chatroom
  private expandedChatrooms: Set<string> = new Set(['global']); // Track which chatrooms are expanded (default: global expanded)
  // private newMatchesCount: number = 0; // TODO: implement match count tracking

  // Callback for stage name changes
  public onStageNameChange?: (userId: string, newStageName: string) => Promise<void>;

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
        <!-- Top Header -->
        <div class="top-header" id="top-header">
          <div class="header-title" id="header-title">Chatrooms</div>
          <div class="header-user-info" id="header-user-info" style="display: none;"></div>
          <div class="header-actions" id="header-actions">
            <button class="header-btn" id="create-talk-btn">➕</button>
          </div>
        </div>

        <!-- Main View Container -->
        <div class="view-container">
          
          <!-- Chatrooms View (Default) -->
          <div class="view-panel active" id="chatrooms-view">
            <!-- Chatroom List -->
            <div class="chatroom-list-container" id="chatroom-list-container">
              <div class="chatroom-list" id="chatroom-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading chatrooms...</p>
              </div>
            </div>

            <!-- Chatroom Detail (Hidden by default) -->
            <div class="chatroom-detail-container" id="chatroom-detail-container" style="display: none;">
              <div class="chatroom-detail-header">
                <button class="back-btn" id="back-to-chatrooms">‹ Back</button>
                <div class="chatroom-detail-info" id="chatroom-detail-info">
                  <div class="chatroom-detail-title" id="current-chatroom-title">Global Chatroom</div>
                  <div class="chatroom-detail-status" id="current-chatroom-status">Loading...</div>
                </div>
              </div>
              <div class="chatroom-members-list" id="chatroom-members-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading members...</p>
              </div>
              <div class="chatroom-actions">
                <button class="btn broadcast-btn" id="broadcast-talk-btn">
                  📢 Broadcast Talk to All Users
                </button>
              </div>
            </div>
          </div>

          <!-- Talks View -->
          <div class="view-panel" id="talks-view">
            <div class="view-content">
              <div class="talks-header">
                <button class="btn create-talk-btn" id="create-talk-btn-talks">
                  ➕ Create New Talk
                </button>
              </div>
              <div class="talks-list" id="talks-list">
                <p style="text-align: center; padding: 40px 20px; color: #999;">No talks yet. Create your first talk!</p>
              </div>
            </div>
          </div>

          <!-- Conversations View (Hidden overlay, opened when clicking on a user) -->
          <div class="conversation-detail-overlay" id="conversation-detail-overlay" style="display: none;">
            <div class="conversation-detail-container">
              <div class="conversation-detail-header">
                <button class="back-btn" id="back-from-conversation">‹ Back</button>
                <div class="conversation-detail-info" id="conversation-detail-info">
                  <div class="conversation-detail-name" id="conversation-user-name">User</div>
                  <div class="conversation-detail-status" id="conversation-status">Online</div>
                </div>
              </div>
              <div class="conversation-messages" id="conversation-messages">
                <p style="text-align: center; padding: 20px; color: #999;">Start your conversation!</p>
              </div>
              <div class="conversation-input-container">
                <textarea id="conversation-message-input" placeholder="Type a message..." rows="2"></textarea>
                <button class="btn send-btn" id="send-conversation-message">Send</button>
              </div>
            </div>
          </div>

          <!-- Answers View -->
          <div class="view-panel" id="answers-view">
            <div class="view-content" id="answers-content">
              <div style="padding: 20px; text-align: center; color: #999;">
                <p>Your answered questions will appear here.</p>
                <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">
                  View My Answers
                </button>
              </div>
            </div>
          </div>

          <!-- Me View -->
          <div class="view-panel" id="me-view">
            <div class="view-content">
              <div class="user-profile">
                <div class="user-info" id="user-info-me"></div>
                <div class="profile-actions">
                  <button class="profile-btn" id="view-my-talks-btn">
                    📋 My Talks
                  </button>
                  <button class="profile-btn" id="my-answers-btn">
                    📝 My Answers
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Bottom Navigation Bar -->
        <div class="bottom-nav">
          <button class="nav-btn active" data-view="chatrooms">
            <div class="nav-icon">🌍</div>
            <div class="nav-label">Chatrooms</div>
          </button>
          <button class="nav-btn" data-view="talks">
            <div class="nav-icon">📢</div>
            <div class="nav-label">Talks</div>
          </button>
          <button class="nav-btn" data-view="answers">
            <div class="nav-icon">📝</div>
            <div class="nav-label">Answers</div>
          </button>
          <button class="nav-btn" data-view="me">
            <div class="nav-icon">👤</div>
            <div class="nav-label">Me</div>
          </button>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.setupBottomNavigation();
  }

  private setupEventListeners(): void {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
    const createTalkBtn = document.getElementById('create-talk-btn');

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

    if (createTalkBtn) {
      createTalkBtn.addEventListener('click', () => {
        this.showTalkEditorDialog();
      });
    }

    // Create talk button in Talks view
    const createTalkBtnTalks = document.getElementById('create-talk-btn-talks');
    if (createTalkBtnTalks) {
      createTalkBtnTalks.addEventListener('click', () => {
        this.showTalkEditorDialog();
      });
    }

    const viewMyTalksBtn = document.getElementById('view-my-talks-btn');
    if (viewMyTalksBtn) {
      viewMyTalksBtn.addEventListener('click', () => {
        this.showMyTalksDialog();
      });
    }

    const viewPreferencesBtn = document.getElementById('view-preferences-btn');
    if (viewPreferencesBtn) {
      viewPreferencesBtn.addEventListener('click', () => {
        this.showPreferencesDialog();
      });
    }

    const myAnswersBtn = document.getElementById('my-answers-btn');
    if (myAnswersBtn) {
      myAnswersBtn.addEventListener('click', () => {
        this.showPreferencesDialog();
      });
    }

    // Back to chatrooms button
    const backToChatroomsBtn = document.getElementById('back-to-chatrooms');
    if (backToChatroomsBtn) {
      backToChatroomsBtn.addEventListener('click', () => {
        this.showChatroomList();
      });
    }

    // Broadcast talk button
    const broadcastTalkBtn = document.getElementById('broadcast-talk-btn');
    if (broadcastTalkBtn) {
      broadcastTalkBtn.addEventListener('click', () => {
        this.emit('broadcastTalk', {
          chatroomId: this.currentChatroom,
          members: this.currentChatroomMembers,
        });
        this.showTalkEditorDialog();
      });
    }
  }

  private setupBottomNavigation(): void {
    const navButtons = document.querySelectorAll('.nav-btn');
    const viewPanels = document.querySelectorAll('.view-panel');
    const headerTitle = document.getElementById('header-title');
    const headerActions = document.getElementById('header-actions');

    navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetView = (button as HTMLElement).dataset.view;
        if (!targetView) return;

        // Update active nav button
        navButtons.forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');

        // Update active view panel
        viewPanels.forEach((panel) => panel.classList.remove('active'));
        const targetPanel = document.getElementById(`${targetView}-view`);
        if (targetPanel) {
          targetPanel.classList.add('active');
        }

        // Update header title and actions
        if (headerTitle) {
          const titles: Record<string, string> = {
            chatrooms: 'Chatrooms',
            talks: 'Talks',
            answers: 'My Answers',
            me: 'Me',
          };
          headerTitle.textContent = titles[targetView] || 'IinPublic';
        }

        // Show/hide create talk button based on view
        if (headerActions) {
          if (targetView === 'chatrooms' || targetView === 'talks') {
            headerActions.style.display = 'block';
          } else {
            headerActions.style.display = 'none';
          }
        }

        // Special handling for chatrooms view
        if (targetView === 'chatrooms') {
          this.showChatroomList();
        }

        // Special handling for talks view
        if (targetView === 'talks') {
          this.displayTalksList();
        }
      });
    });
  }

  showMainInterface(user: User): void {
    // Update header with user's stageName
    const headerUserInfo = document.getElementById('header-user-info');
    if (headerUserInfo) {
      headerUserInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="user-avatar" style="width: 32px; height: 32px; font-size: 0.9em;">
            ${user.stageName.charAt(0).toUpperCase()}
          </div>
          <div style="font-size: 0.95em; font-weight: 500; color: white;">${user.stageName}</div>
        </div>
      `;
      headerUserInfo.style.display = 'block';
    }

    // Update user info in Me view
    const userInfoMe = document.getElementById('user-info-me');
    if (userInfoMe) {
      userInfoMe.innerHTML = `
        <div class="user-avatar" style="width: 80px; height: 80px; font-size: 2em; margin: 20px auto;">
          ${user.stageName.charAt(0).toUpperCase()}
        </div>
        <div style="text-align: center; margin-top: 10px;">
          <div style="font-size: 1.2em; font-weight: 600;">${user.stageName}</div>
          <div style="font-size: 0.9em; color: #999; margin-top: 5px;">Online</div>
          <button class="btn" id="edit-stagename-btn" style="margin-top: 10px;">Edit Stage Name</button>
        </div>
      `;

      // Add event listener for edit stage name button
      const editBtn = document.getElementById('edit-stagename-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => this.showEditStageNameDialog(user));
      }
    }

    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">Global Chatroom</div>
        <div class="chatroom-status">Connected • Ready to meet people nearby</div>
      `;
    }

    // Initialize chatroom list view (default view)
    this.showChatroomList();
  }

  showChatroomList(): void {
    // Hide chatroom detail view, show chatroom list
    const listContainer = document.getElementById('chatroom-list-container');
    const detailContainer = document.getElementById('chatroom-detail-container');

    if (listContainer) listContainer.style.display = 'block';
    if (detailContainer) detailContainer.style.display = 'none';

    // Update header
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = 'Chatrooms';

    // Render the chatroom list
    this.renderChatroomList();
  }

  private renderChatroomList(): void {
    // Get flat list of all chatrooms from hierarchy
    const allChatrooms = getFlatChatroomList();

    // Add current location-based chatroom if it's not in the list
    if (this.currentChatroom && !allChatrooms.find((r) => r.id === this.currentChatroom)) {
      allChatrooms.unshift({
        id: this.currentChatroom,
        name: 'My Location',
        icon: '📍',
        level: 0,
        description: 'Your current location chatroom',
        hasChildren: false,
      });
    }

    // Filter chatrooms based on expanded state
    const visibleChatrooms = allChatrooms.filter((room) => {
      // Root level (global and location) are always visible
      if (room.level === 0) return true;

      // For child nodes, check if parent is expanded
      if (room.parentId) {
        return this.expandedChatrooms.has(room.parentId);
      }

      return true;
    });

    // Populate chatroom list
    const chatroomList = document.getElementById('chatroom-list');
    if (chatroomList) {
      chatroomList.innerHTML = visibleChatrooms
        .map((room) => {
          const memberCount = this.chatroomMemberCounts.get(room.id) || 0;
          const isCurrentRoom = this.currentChatroom === room.id;
          const isExpanded = this.expandedChatrooms.has(room.id);
          const expandIcon = room.hasChildren ? (isExpanded ? '▼' : '▶') : '';

          return `
        <div class="chatroom-item ${isCurrentRoom ? 'current-room' : ''}" 
             data-chatroom-id="${room.id}" 
             data-level="${room.level}"
             data-has-children="${room.hasChildren}"
             style="padding-left: ${room.level * 20 + 16}px;">
          ${room.hasChildren ? `<div class="chatroom-expand-icon" data-chatroom-id="${room.id}">${expandIcon}</div>` : '<div class="chatroom-expand-icon-placeholder"></div>'}
          <div class="chatroom-icon">${room.icon}</div>
          <div class="chatroom-info">
            <div class="chatroom-name">
              ${room.name}
              ${isCurrentRoom ? '<span class="current-room-badge">Current</span>' : ''}
              <span class="chatroom-headcount">${memberCount > 0 ? `👥 ${memberCount}` : '👥 0'}</span>
            </div>
          </div>
          <div class="chatroom-arrow">›</div>
        </div>
      `;
        })
        .join('');

      // Add click handlers for expand/collapse icons
      const expandIcons = chatroomList.querySelectorAll('.chatroom-expand-icon');
      expandIcons.forEach((icon) => {
        icon.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent triggering the chatroom click
          const chatroomId = icon.getAttribute('data-chatroom-id');
          if (chatroomId) {
            this.toggleChatroomExpanded(chatroomId);
          }
        });
      });

      // Add click handlers to each chatroom item
      const chatroomItems = chatroomList.querySelectorAll('.chatroom-item');
      chatroomItems.forEach((item) => {
        item.addEventListener('click', () => {
          const chatroomId = item.getAttribute('data-chatroom-id');
          if (chatroomId) {
            this.showChatroomDetail(chatroomId);
          }
        });
      });
    }
  }

  /**
   * Toggle expand/collapse state of a chatroom node
   */
  private toggleChatroomExpanded(chatroomId: string): void {
    if (this.expandedChatrooms.has(chatroomId)) {
      this.expandedChatrooms.delete(chatroomId);
    } else {
      this.expandedChatrooms.add(chatroomId);
    }
    // Re-render the chatroom list
    this.renderChatroomList();
  }

  showChatroomDetail(chatroomId: string): void {
    // Hide chatroom list, show detail view
    const listContainer = document.getElementById('chatroom-list-container');
    const detailContainer = document.getElementById('chatroom-detail-container');

    if (listContainer) listContainer.style.display = 'none';
    if (detailContainer) detailContainer.style.display = 'block';

    // Get chatroom name from hierarchy
    const allChatrooms = getFlatChatroomList();
    const room = allChatrooms.find((r) => r.id === chatroomId);
    const roomName = room ? `${room.icon} ${room.name}` : chatroomId;

    // Update header and chatroom info
    const headerTitle = document.getElementById('header-title');
    const chatroomTitle = document.getElementById('current-chatroom-title');
    const chatroomStatus = document.getElementById('current-chatroom-status');

    if (headerTitle) headerTitle.textContent = roomName;
    if (chatroomTitle) chatroomTitle.textContent = roomName;
    if (chatroomStatus) chatroomStatus.textContent = 'Loading members...';

    // Store current chatroom
    this.currentChatroom = chatroomId;

    // Update members list (for now, show placeholder)
    const membersList = document.getElementById('chatroom-members-list');
    if (membersList) {
      // Initially show loading state
      membersList.innerHTML =
        '<div style="padding: 20px; text-align: center; color: #999;">Loading online users...</div>';

      // Trigger update of chatroom members
      // This will be populated by updateChatroomMembers() when called from the app
      this.emit('chatroomChanged', chatroomId);
    }
  }

  displayTalksList(): void {
    const talksList = document.getElementById('talks-list');
    if (!talksList) return;

    const myTalks = this.getMyTalks();
    const talkEntries = Object.entries(myTalks).sort(
      ([, a]: [string, any], [, b]: [string, any]) =>
        new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime(),
    );

    if (talkEntries.length === 0) {
      talksList.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">No talks yet</p>
          <p style="font-size: 0.9em; color: #999;">Create your first talk to get started!</p>
        </div>
      `;
    } else {
      talksList.innerHTML = talkEntries
        .map(
          ([talkId, talk]) => `
        <div class="talk-list-item" data-talk-id="${talkId}">
          <div class="talk-item-header">
            <div class="talk-item-title">${this.escapeHtml(talk.title)}</div>
            <div class="talk-item-badges">
              <span class="talk-badge talk-badge-${talk.role === 'created' ? 'created' : 'answered'}">
                ${talk.role === 'created' ? '📝 Created' : '✅ Answered'}
              </span>
              <span class="talk-badge talk-badge-type">${talk.type}</span>
            </div>
          </div>
          <div class="talk-item-meta">
            <span class="talk-item-time">${this.formatTimeAgo(new Date(talk.lastInteraction))}</span>
          </div>
        </div>
      `,
        )
        .join('');

      // Add click handlers to talk items
      talksList.querySelectorAll('.talk-list-item').forEach((item) => {
        item.addEventListener('click', () => {
          const talkId = (item as HTMLElement).dataset.talkId;
          if (talkId) {
            this.showTalkDetail(talkId);
          }
        });
      });
    }
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  private showTalkDetail(talkId: string): void {
    const myTalks = this.getMyTalks();
    const talk = myTalks[talkId];
    if (!talk) return;

    // If this is a received talk (role === 'answered') and has fullTalk data, show the response dialog
    if (talk.role === 'answered' && talk.fullTalk) {
      this.showTalkResponseDialog(talk.fullTalk);
    } else if (talk.role === 'created') {
      // For created talks, show a notification (later can show responses/stats)
      this.showNotification(`Your talk: ${talk.title}`, 'info');
    } else {
      // Fallback notification
      this.showNotification(`Talk: ${talk.title}`, 'info');
    }
  }

  displayConversationsList(): void {
    const conversationsList = document.getElementById('conversations-list');
    if (!conversationsList) return;

    // Get conversations from localStorage
    const myConversations = this.getMyConversations();
    const conversationEntries = Object.entries(myConversations).sort(
      ([, a]: [string, any], [, b]: [string, any]) =>
        new Date(b.lastMessageTime || b.createdAt).getTime() -
        new Date(a.lastMessageTime || a.createdAt).getTime(),
    );

    if (conversationEntries.length === 0) {
      conversationsList.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">No conversations yet</p>
          <p style="font-size: 0.9em; color: #999;">Match with someone through talks to start chatting!</p>
        </div>
      `;
    } else {
      conversationsList.innerHTML = conversationEntries
        .map(
          ([conversationId, conversation]) => `
        <div class="conversation-list-item ${conversation.unread ? 'unread' : ''}" data-conversation-id="${conversationId}">
          <div class="conversation-avatar">
            ${conversation.otherUserName?.charAt(0).toUpperCase() || '?'}
          </div>
          <div class="conversation-content">
            <div class="conversation-header">
              <div class="conversation-name">${this.escapeHtml(conversation.otherUserName || 'Unknown')}</div>
              <div class="conversation-time">${this.formatTimeAgo(new Date(conversation.lastMessageTime || conversation.createdAt))}</div>
            </div>
            <div class="conversation-preview">
              ${conversation.unread ? '<span class="unread-badge"></span>' : ''}
              ${this.escapeHtml(conversation.lastMessage || 'Matched! Start a conversation...')}
            </div>
          </div>
        </div>
      `,
        )
        .join('');

      // Add click handlers to conversation items
      conversationsList.querySelectorAll('.conversation-list-item').forEach((item) => {
        item.addEventListener('click', () => {
          const conversationId = (item as HTMLElement).dataset.conversationId;
          if (conversationId) {
            this.showConversationDetail(conversationId);
          }
        });
      });
    }
  }

  private getMyConversations(): Record<string, any> {
    const conversationsJson = localStorage.getItem('myConversations');
    return conversationsJson ? JSON.parse(conversationsJson) : {};
  }

  showConversationDetail(conversationId: string): void {
    const overlay = document.getElementById('conversation-detail-overlay');

    if (overlay) overlay.style.display = 'flex';

    this.currentConversationId = conversationId;

    // Get conversation data
    const conversations = this.getMyConversations();
    const conversation = conversations[conversationId];

    if (!conversation) return;

    // Update header with user name
    const userName = document.getElementById('conversation-user-name');
    if (userName) userName.textContent = conversation.otherUserName || 'Unknown';

    // Mark conversation as read
    conversation.unread = false;
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    this.updateMatchBadge();

    // Load messages
    this.emit('loadConversation', { conversationId });

    // Setup back button
    const backBtn = document.getElementById('back-from-conversation');
    if (backBtn) {
      backBtn.replaceWith(backBtn.cloneNode(true)); // Remove old listeners
      const newBackBtn = document.getElementById('back-from-conversation');
      newBackBtn?.addEventListener('click', () => {
        if (overlay) overlay.style.display = 'none';
        this.currentConversationId = undefined;
      });
    }

    // Setup send message button
    const sendBtn = document.getElementById('send-conversation-message');
    const messageInput = document.getElementById(
      'conversation-message-input',
    ) as HTMLTextAreaElement;

    if (sendBtn && messageInput) {
      sendBtn.replaceWith(sendBtn.cloneNode(true)); // Remove old listeners
      const newSendBtn = document.getElementById('send-conversation-message');

      const sendMessage = () => {
        const message = messageInput.value.trim();
        if (message) {
          this.emit('sendConversationMessage', { conversationId, message });
          messageInput.value = '';
        }
      };

      newSendBtn?.addEventListener('click', sendMessage);
      messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
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
            <p>Your account is being set up with a random stage name.</p>
            <p>You can change your stage name anytime in your profile settings.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="get-started-btn">Get Started</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const getStartedBtn = document.getElementById('get-started-btn') as HTMLButtonElement;
      getStartedBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve({
          languages: ['en'],
          interests: [],
        });
      });
    });
  }

  async showEditStageNameDialog(user: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Edit Stage Name</h2>
            <p>Current: ${user.stageName}</p>
          </div>
          <form id="edit-stagename-form">
            <div class="form-group">
              <label class="form-label">New Stage Name</label>
              <input type="text" class="form-input" id="new-stage-name" name="new-stage-name" 
                     required minlength="3" maxlength="50"
                     placeholder="Enter your new stage name"
                     value="${user.stageName}">
              <small style="color: #666; font-size: 0.85em;">3-50 characters</small>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-edit-btn" style="background: #6c757d;">Cancel</button>
              <button type="submit" class="btn">Save</button>
            </div>
          </form>
        </div>
      `;

      document.body.appendChild(modal);

      const form = document.getElementById('edit-stagename-form') as HTMLFormElement;
      const cancelBtn = document.getElementById('cancel-edit-btn') as HTMLButtonElement;

      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const newStageName = formData.get('new-stage-name') as string | null;

        if (newStageName && newStageName.trim() && newStageName.trim().length >= 3) {
          try {
            // Update the user's stage name
            await this.onStageNameChange?.(user.id, newStageName.trim());
            document.body.removeChild(modal);
            resolve();
          } catch (error) {
            alert('Failed to update stage name. Please try again.');
            reject(error);
          }
        } else {
          alert('Stage name must be at least 3 characters long.');
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

  updateConversation(_conversationId: string, result: any): void {
    console.log('Conversation updated:', result);
  }

  updateChatroomInfo(info: { id: string; name: string } | any): void {
    // Update current chatroom tracking
    if (info.id) {
      this.currentChatroom = info.id;
    }

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

  displayIncomingTalk(talk: {
    id: string;
    title: string;
    authorName: string;
    type: string;
    questionCount: number;
    timestamp: string;
    isOwnTalk: boolean;
    fullTalk: any;
  }): void {
    // Check if talk already exists to avoid duplicates
    const myTalks = this.getMyTalks();
    if (myTalks[talk.id]) {
      console.log('⏭️  Talk already saved, skipping:', talk.id);
      return;
    }

    // Save to My Talks history
    this.saveMyTalk({
      talkId: talk.id,
      title: talk.title,
      type: talk.type,
      timestamp: talk.timestamp,
      role: talk.isOwnTalk ? 'created' : 'answered',
      fullTalk: talk.fullTalk,
    });

    // Show a notification for received talks
    if (!talk.isOwnTalk) {
      this.showNotification(`📥 New talk from ${talk.authorName}: ${talk.title}`, 'info');
    }

    // Refresh the talks list if the Talks tab is currently active
    const talksTab = document.getElementById('tab-talks');
    if (talksTab?.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  showTalkResponseDialog(talk: any): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talk-response-modal';

    // Start with first question
    let currentQuestion = talk.questions[0];
    const answers: { questionId: string; answerId: string; answerText: string }[] = [];

    const renderQuestion = () => {
      if (!currentQuestion) {
        // No more questions - complete the talk
        this.completeTalk(talk, answers);
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        return;
      }

      // Check if there's a saved preference for this question
      const savedPreference = this.getAnswerPreference(talk.id, currentQuestion.id);
      if (savedPreference && savedPreference.mode === 'auto') {
        // Auto-answer with saved preference
        console.log('🤖 Auto-answering with saved preference:', savedPreference.answerText);

        // Find the answer object
        const answer = currentQuestion.answers.find((a: any) => a.id === savedPreference.answerId);
        if (answer) {
          // Record the answer
          answers.push({
            questionId: currentQuestion.id,
            answerId: savedPreference.answerId,
            answerText: savedPreference.answerText,
          });

          // Handle the answer (same logic as manual click)
          if (answer.isIgnore) {
            this.showNotification('Talk ignored - no match (auto)', 'info');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            return;
          } else if (answer.isMatch) {
            this.completeTalk(talk, answers);
            this.showNotification('Match! You both noticed each other. (auto)', 'success');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            return;
          } else if (answer.isTerminal) {
            this.completeTalk(talk, answers);
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            return;
          } else if (answer.nextQuestionId) {
            currentQuestion = talk.questions.find((q: any) => q.id === answer.nextQuestionId);
            if (currentQuestion) {
              renderQuestion();
            } else {
              console.warn('Next question not found:', answer.nextQuestionId);
              this.completeTalk(talk, answers);
              if (document.body.contains(modal)) {
                document.body.removeChild(modal);
              }
            }
            return;
          } else {
            this.completeTalk(talk, answers);
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            return;
          }
        }
      }

      const currentQuestionIndex = talk.questions.findIndex(
        (q: any) => q.id === currentQuestion.id,
      );

      modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
          <div class="modal-header">
            <h2 class="modal-title">${this.escapeHtml(talk.title)}</h2>
            <p>Question ${currentQuestionIndex + 1} of ${talk.questions.length}</p>
          </div>
          <div style="padding: 20px;">
            <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 20px;">
              ${this.escapeHtml(currentQuestion.text)}
            </div>
            <div id="answer-options">
              ${currentQuestion.answers
                .map(
                  (answer: any) => `
                <div style="margin-bottom: 20px;">
                  <div style="
                    padding: 12px;
                    background: #f8f9fa;
                    border: 2px solid #e0e0e0;
                    border-radius: 8px;
                    font-size: 1.1em;
                    font-weight: 500;
                    color: #333;
                    margin-bottom: 8px;
                  ">
                    ${this.escapeHtml(answer.text)}
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button 
                      class="answer-option-btn answer-auto-btn"
                      data-answer-id="${answer.id}"
                      data-answer-text="${this.escapeHtml(answer.text)}"
                      data-answer-mode="auto"
                      data-is-terminal="${answer.isTerminal || false}"
                      data-is-ignore="${answer.isIgnore || false}"
                      data-is-match="${answer.isMatch || false}"
                      data-next-question-id="${answer.nextQuestionId || ''}"
                      style="
                        flex: 1;
                        padding: 10px 16px;
                        background: #10b981;
                        border: 2px solid #059669;
                        border-radius: 6px;
                        cursor: pointer;
                        text-align: center;
                        font-size: 0.9em;
                        font-weight: 600;
                        color: white;
                        transition: all 0.2s;
                      "
                      onmouseover="this.style.background='#059669'; this.style.transform='scale(1.02)';"
                      onmouseout="this.style.background='#10b981'; this.style.transform='scale(1)';"
                    >
                      AUTO
                    </button>
                    <button 
                      class="answer-option-btn answer-manual-btn"
                      data-answer-id="${answer.id}"
                      data-answer-text="${this.escapeHtml(answer.text)}"
                      data-answer-mode="manual"
                      data-is-terminal="${answer.isTerminal || false}"
                      data-is-ignore="${answer.isIgnore || false}"
                      data-is-match="${answer.isMatch || false}"
                      data-next-question-id="${answer.nextQuestionId || ''}"
                      style="
                        flex: 1;
                        padding: 10px 16px;
                        background: #dc2626;
                        border: 2px solid #b91c1c;
                        border-radius: 6px;
                        cursor: pointer;
                        text-align: center;
                        font-size: 0.9em;
                        font-weight: 600;
                        color: white;
                        transition: all 0.2s;
                      "
                      onmouseover="this.style.background='#b91c1c'; this.style.transform='scale(1.02)';"
                      onmouseout="this.style.background='#dc2626'; this.style.transform='scale(1)';"
                    >
                      MANUAL
                    </button>
                  </div>
                </div>
              `,
                )
                .join('')}
              <button 
                class="answer-option-btn ignore-btn"
                data-answer-id="ignore"
                data-is-terminal="false"
                data-is-ignore="true"
                data-is-match="false"
                data-next-question-id=""
                style="
                  display: block;
                  width: 100%;
                  padding: 12px;
                  margin-top: 10px;
                  background: #f5f5f5;
                  border: 2px solid #999;
                  border-radius: 8px;
                  cursor: pointer;
                  text-align: center;
                  font-size: 1em;
                  color: #666;
                  transition: all 0.2s;
                "
                onmouseover="this.style.background='#e0e0e0'; this.style.borderColor='#666';"
                onmouseout="this.style.background='#f5f5f5'; this.style.borderColor='#999';"
              >
                Ignore this talk
              </button>
            </div>
          </div>
        </div>
      `;

      // Add event listeners to answer buttons
      modal.querySelectorAll('.answer-option-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLElement;
          const answerId = target.dataset.answerId!;
          const answerText = target.dataset.answerText || target.textContent!.trim(); // Get from data attribute or fallback to text
          const isTerminal = target.dataset.isTerminal === 'true';
          const isIgnore = target.dataset.isIgnore === 'true';
          const isMatch = target.dataset.isMatch === 'true';
          const nextQuestionId = target.dataset.nextQuestionId;

          // Get the answer mode from the button itself
          const answerMode = target.dataset.answerMode || 'manual'; // default to manual

          // Record answer
          answers.push({
            questionId: currentQuestion.id,
            answerId,
            answerText,
          });

          // Save answer to preferences (for both auto and manual mode)
          this.saveAnswerPreference(
            talk.id,
            currentQuestion.id,
            answerId,
            answerText,
            currentQuestion.text,
            currentQuestion.answers,
          );

          // Update mode in preferences based on button clicked
          const preferences = this.getAnswerPreferences();
          const key = currentQuestion.id;
          if (preferences[key]) {
            preferences[key].mode = answerMode;
            localStorage.setItem('answerPreferences', JSON.stringify(preferences));
          }

          if (isIgnore) {
            // User chose to ignore
            this.showNotification('Talk ignored - no match', 'info');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          } else if (isMatch) {
            // User chose a matching answer - this is a match!
            this.completeTalk(talk, answers);
            this.showNotification('Match! You both noticed each other.', 'success');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          } else if (isTerminal) {
            // Talk complete (other terminal reasons)
            this.completeTalk(talk, answers);
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          } else if (nextQuestionId) {
            // Find next question by ID
            currentQuestion = talk.questions.find((q: any) => q.id === nextQuestionId);
            if (currentQuestion) {
              renderQuestion();
            } else {
              // Question not found - end talk
              console.warn('Next question not found:', nextQuestionId);
              this.completeTalk(talk, answers);
              if (document.body.contains(modal)) {
                document.body.removeChild(modal);
              }
            }
          } else {
            // No next question specified - end talk
            this.completeTalk(talk, answers);
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
          }
        });
      });
    };

    document.body.appendChild(modal);
    renderQuestion();
  }

  private completeTalk(talk: any, answers: any[]): void {
    console.log('✅ Talk completed:', talk.id, answers);

    // Update My Talks history to mark as answered
    this.saveMyTalk({
      talkId: talk.id,
      title: talk.title,
      type: talk.type,
      timestamp: talk.createdAt || new Date().toISOString(),
      role: 'answered',
      fullTalk: talk,
    });

    // Emit event for app to handle
    this.emit('talkCompleted', {
      talkId: talk.id,
      answers,
      talkData: talk,
    });

    this.showNotification(
      talk.type === 'matching'
        ? "Response submitted! We'll notify you of matches."
        : 'Survey response submitted! Thank you.',
      'success',
    );
  }

  private saveAnswerPreference(
    talkId: string,
    questionId: string,
    answerId: string,
    answerText: string,
    questionText?: string,
    allAnswers?: any[],
  ): void {
    const preferences = this.getAnswerPreferences();
    // Use question text as key instead of talkId+questionId so preferences work across different talks
    const key = `${questionId}`;
    preferences[key] = {
      answerId,
      answerText,
      mode: 'auto',
      talkId,
      questionText: questionText || '',
      allAnswers: allAnswers || [],
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem('answerPreferences', JSON.stringify(preferences));
    console.log('💾 Saved answer preference:', key, answerText);
  }

  private getAnswerPreferences(): Record<
    string,
    {
      answerId: string;
      answerText: string;
      mode: string;
      talkId?: string;
      questionText?: string;
      allAnswers?: any[];
      timestamp?: string;
    }
  > {
    const stored = localStorage.getItem('answerPreferences');
    return stored ? JSON.parse(stored) : {};
  }

  private getAnswerPreference(
    _talkId: string,
    questionId: string,
  ): {
    answerId: string;
    answerText: string;
    mode: string;
    questionText?: string;
    allAnswers?: any[];
  } | null {
    const preferences = this.getAnswerPreferences();
    // Try question ID only first (works across different talks with same question)
    const key = `${questionId}`;
    return preferences[key] || null;
  }

  showPreferencesDialog(): void {
    const preferences = this.getAnswerPreferences();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'preferences-modal';

    const preferenceEntries = Object.entries(preferences);

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="modal-title">My Answers</h2>
          <button class="close-button" id="close-preferences-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
        </div>
        <div style="padding: 20px;">
          ${
            preferenceEntries.length === 0
              ? '<p style="text-align: center; color: #666;">No answered questions yet. When you answer a question, it will appear here and you can manage your preferences.</p>'
              : `
            <p style="margin-bottom: 20px; color: #666;">You have answered ${preferenceEntries.length} question(s). You can change your answers or toggle between Auto/Manual mode for future use.</p>
            <div style="max-height: 500px; overflow-y: auto;">
              ${preferenceEntries
                .map(
                  ([key, pref]) => `
                  <div class="preference-item" style="background: #f9f9f9; border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div style="margin-bottom: 15px;">
                      <div style="font-weight: 600; font-size: 1.1em; color: #333; margin-bottom: 8px;">
                        ${this.escapeHtml(pref.questionText || 'Question')}
                      </div>
                      <div style="font-size: 0.8em; color: #999; margin-bottom: 12px;">
                        Last answered: ${pref.timestamp ? new Date(pref.timestamp).toLocaleString() : 'N/A'}
                      </div>
                    </div>
                    
                    <!-- Answer selection -->
                    <div style="margin-bottom: 15px;">
                      <label style="display: block; font-size: 0.9em; font-weight: 600; color: #666; margin-bottom: 8px;">
                        Your Answer:
                      </label>
                      ${
                        pref.allAnswers && pref.allAnswers.length > 0
                          ? `<select 
                        class="answer-select" 
                        data-pref-key="${key}"
                        style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 1em; background: white; cursor: pointer;"
                      >
                        ${pref.allAnswers
                          .map(
                            (ans: any) => `
                            <option value="${ans.id}" ${ans.id === pref.answerId ? 'selected' : ''}>
                              ${this.escapeHtml(ans.text)}
                            </option>
                          `,
                          )
                          .join('')}
                      </select>`
                          : `<div style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 1em; background: #f5f5f5; color: #666;">
                        ${this.escapeHtml(pref.answerText)}
                        <div style="font-size: 0.75em; margin-top: 4px; color: #999;">
                          (Other options not available - answer this question again to enable editing)
                        </div>
                      </div>`
                      }
                    </div>
                    
                    <!-- Auto/Manual toggle -->
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                      <div>
                        <label style="font-size: 0.9em; font-weight: 600; color: #666;">
                          Mode:
                        </label>
                        <div style="font-size: 0.85em; color: #999; margin-top: 4px;">
                          Auto mode will use this answer automatically next time
                        </div>
                      </div>
                      <label class="toggle-switch" style="position: relative; display: inline-block; width: 60px; height: 34px;">
                        <input 
                          type="checkbox" 
                          class="mode-toggle" 
                          data-pref-key="${key}"
                          ${pref.mode === 'auto' ? 'checked' : ''}
                          style="opacity: 0; width: 0; height: 0;"
                        >
                        <span style="
                          position: absolute;
                          cursor: pointer;
                          top: 0;
                          left: 0;
                          right: 0;
                          bottom: 0;
                          background-color: ${pref.mode === 'auto' ? '#10b981' : '#dc2626'};
                          transition: 0.4s;
                          border-radius: 34px;
                        ">
                          <span style="
                            position: absolute;
                            content: '';
                            height: 26px;
                            width: 26px;
                            left: 4px;
                            bottom: 4px;
                            background-color: white;
                            transition: 0.4s;
                            border-radius: 50%;
                            transform: translateX(${pref.mode === 'auto' ? '26px' : '0'});
                          "></span>
                        </span>
                      </label>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div class="mode-badge-${key}" style="font-size: 0.85em; padding: 6px 12px; border-radius: 6px; font-weight: 600; ${
                        pref.mode === 'auto'
                          ? 'background: #d1fae5; color: #065f46;'
                          : 'background: #fee2e2; color: #991b1b;'
                      }">
                        ${pref.mode === 'auto' ? '🟢 AUTO' : '🔴 MANUAL'}
                      </div>
                      <button 
                        class="delete-pref-btn" 
                        data-pref-key="${key}"
                        style="background: #e53e3e; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                `,
                )
                .join('')}
            </div>
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
              <button 
                id="clear-all-prefs-btn"
                style="background: #e53e3e; color: white; border: none; border-radius: 8px; padding: 12px 24px; cursor: pointer; font-weight: 600; font-size: 1em;"
              >
                🗑️ Clear All Answers
              </button>
            </div>
          `
          }
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button handler
    const closeBtn = document.getElementById('close-preferences-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      });
    }

    // Answer select change handlers
    modal.querySelectorAll('.answer-select').forEach((select) => {
      select.addEventListener('change', (e) => {
        const target = e.currentTarget as HTMLSelectElement;
        const key = target.dataset.prefKey!;
        const newAnswerId = target.value;
        const newAnswerText = target.options[target.selectedIndex].text;

        const prefs = this.getAnswerPreferences();
        if (prefs[key]) {
          prefs[key].answerId = newAnswerId;
          prefs[key].answerText = newAnswerText;
          prefs[key].timestamp = new Date().toISOString();
          localStorage.setItem('answerPreferences', JSON.stringify(prefs));
          this.showNotification('Answer updated', 'success');
        }
      });
    });

    // Mode toggle handlers
    modal.querySelectorAll('.mode-toggle').forEach((toggle) => {
      toggle.addEventListener('change', (e) => {
        const target = e.currentTarget as HTMLInputElement;
        const key = target.dataset.prefKey!;
        const isAuto = target.checked;

        const prefs = this.getAnswerPreferences();
        if (prefs[key]) {
          prefs[key].mode = isAuto ? 'auto' : 'manual';
          prefs[key].timestamp = new Date().toISOString();
          localStorage.setItem('answerPreferences', JSON.stringify(prefs));

          // Update the toggle appearance
          const toggleSpan = target.nextElementSibling as HTMLElement;
          if (toggleSpan) {
            toggleSpan.style.backgroundColor = isAuto ? '#10b981' : '#dc2626';
            const innerSpan = toggleSpan.querySelector('span') as HTMLElement;
            if (innerSpan) {
              innerSpan.style.transform = isAuto ? 'translateX(26px)' : 'translateX(0)';
            }
          }

          // Update the mode badge
          const modeBadge = document.querySelector(`.mode-badge-${key}`) as HTMLElement;
          if (modeBadge) {
            modeBadge.textContent = isAuto ? '🟢 AUTO' : '🔴 MANUAL';
            modeBadge.style.background = isAuto ? '#d1fae5' : '#fee2e2';
            modeBadge.style.color = isAuto ? '#065f46' : '#991b1b';
          }

          this.showNotification(`Mode changed to ${isAuto ? 'AUTO' : 'MANUAL'}`, 'success');
        }
      });
    });

    // Delete individual preference handlers
    modal.querySelectorAll('.delete-pref-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const key = target.dataset.prefKey!;
        this.deleteAnswerPreference(key);
        // Refresh the dialog
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        this.showPreferencesDialog();
        this.showNotification('Answer deleted', 'success');
      });
    });

    // Clear all button handler
    const clearAllBtn = document.getElementById('clear-all-prefs-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all saved answers?')) {
          localStorage.removeItem('answerPreferences');
          if (document.body.contains(modal)) {
            document.body.removeChild(modal);
          }
          this.showPreferencesDialog();
          this.showNotification('All answers cleared', 'success');
        }
      });
    }

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      }
    });
  }

  private deleteAnswerPreference(key: string): void {
    const preferences = this.getAnswerPreferences();
    delete preferences[key];
    localStorage.setItem('answerPreferences', JSON.stringify(preferences));
  }

  // ============================================
  // MY TALKS MANAGEMENT
  // ============================================

  private saveMyTalk(talkData: {
    talkId: string;
    title: string;
    type: string;
    timestamp: string;
    role: 'created' | 'answered';
    fullTalk?: any;
  }): void {
    const myTalks = this.getMyTalks();
    myTalks[talkData.talkId] = {
      ...talkData,
      lastInteraction: new Date().toISOString(),
    };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));

    // Refresh talks list if currently viewing Talks tab
    const talksView = document.getElementById('talks-view');
    if (talksView && talksView.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  private getMyTalks(): Record<string, any> {
    const stored = localStorage.getItem('myTalks');
    return stored ? JSON.parse(stored) : {};
  }

  showMyTalksDialog(): void {
    const myTalks = this.getMyTalks();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'my-talks-modal';

    const talkEntries = Object.entries(myTalks).sort(
      ([, a]: [string, any], [, b]: [string, any]) =>
        new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime(),
    );

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="modal-title">My Talks</h2>
          <button class="close-button" id="close-my-talks-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
        </div>
        <div style="padding: 20px;">
          ${
            talkEntries.length === 0
              ? '<p style="text-align: center; color: #666;">You haven\'t created or answered any talks yet. Create or answer a talk to see it here.</p>'
              : `
            <p style="margin-bottom: 20px; color: #666;">You have ${talkEntries.length} talk(s) in your history.</p>
            <div style="max-height: 500px; overflow-y: auto;">
              ${talkEntries
                .map(
                  ([talkId, talk]) => `
                  <div class="talk-history-item" style="background: #f9f9f9; border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                      <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 1.1em; color: #333; margin-bottom: 6px;">
                          ${this.escapeHtml(talk.title)}
                        </div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                          <span style="display: inline-block; padding: 4px 12px; background: ${talk.role === 'created' ? '#dbeafe' : '#dcfce7'}; color: ${talk.role === 'created' ? '#1e40af' : '#166534'}; border-radius: 12px; font-size: 0.8em; font-weight: 600;">
                            ${talk.role === 'created' ? '📝 Created by me' : '✅ Answered by me'}
                          </span>
                          <span style="display: inline-block; padding: 4px 12px; background: #f3f4f6; color: #6b7280; border-radius: 12px; font-size: 0.8em; font-weight: 600;">
                            ${talk.type}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style="font-size: 0.85em; color: #999; margin-bottom: 12px;">
                      Last interaction: ${new Date(talk.lastInteraction).toLocaleString()}
                    </div>
                    <div style="font-size: 0.85em; color: #999;">
                      Talk ID: <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${talkId}</code>
                    </div>
                    <button 
                      class="delete-talk-btn" 
                      data-talk-id="${talkId}"
                      style="margin-top: 12px; background: #e53e3e; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                    >
                      🗑️ Remove from History
                    </button>
                  </div>
                `,
                )
                .join('')}
            </div>
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
              <button 
                id="clear-all-talks-btn"
                style="background: #e53e3e; color: white; border: none; border-radius: 8px; padding: 12px 24px; cursor: pointer; font-weight: 600; font-size: 1em;"
              >
                🗑️ Clear All History
              </button>
            </div>
          `
          }
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button handler
    const closeBtn = document.getElementById('close-my-talks-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      });
    }

    // Delete individual talk handlers
    modal.querySelectorAll('.delete-talk-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const talkId = target.dataset.talkId!;
        this.deleteMyTalk(talkId);
        // Refresh the dialog
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        this.showMyTalksDialog();
        this.showNotification('Talk removed from history', 'success');
      });
    });

    // Clear all button handler
    const clearAllBtn = document.getElementById('clear-all-talks-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all talk history?')) {
          localStorage.removeItem('myTalks');
          if (document.body.contains(modal)) {
            document.body.removeChild(modal);
          }
          this.showMyTalksDialog();
          this.showNotification('All talk history cleared', 'success');
        }
      });
    }

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
      }
    });
  }

  private deleteMyTalk(talkId: string): void {
    const myTalks = this.getMyTalks();
    delete myTalks[talkId];
    localStorage.setItem('myTalks', JSON.stringify(myTalks));

    // Refresh talks list if currently viewing Talks tab
    const talksView = document.getElementById('talks-view');
    if (talksView && talksView.classList.contains('active')) {
      this.displayTalksList();
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

  displayChatroomMessage(message: {
    id: string;
    text: string;
    senderName: string;
    timestamp: string;
    isOwnMessage: boolean;
  }): void {
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
        ${!message.isOwnMessage ? `<div style="font-weight: bold; font-size: 0.85em; margin-bottom: 4px; color: #667eea;">${this.escapeHtml(message.senderName)}</div>` : ''}
        <div>${this.escapeHtml(message.text)}</div>
        <div class="message-time">${messageTime}</div>
      </div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showTalkEditorDialog(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talk-editor-modal';

    const renderForm = () => {
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h2 class="modal-title">Create a Talk</h2>
            <p>Build a branching conversation flow - each answer can lead to a different question</p>
          </div>
          <form id="talk-editor-form" style="padding: 20px;">
            <div class="form-group">
              <label class="form-label">Talk Title</label>
              <input type="text" class="form-input" id="talk-title" placeholder="e.g., Coffee Meetup, Quick Survey" required>
            </div>
            
            <div class="form-group">
              <label class="form-label">Type</label>
              <select class="form-input" id="talk-type">
                <option value="matching">Matching (find compatible people)</option>
                <option value="survey">Survey (collect responses)</option>
              </select>
            </div>
            
            <div class="form-group">
              <label class="form-label">Questions & Branching</label>
              <div id="questions-container"></div>
              <button type="button" id="add-question-btn" class="btn" style="margin-top: 10px; background: #667eea; color: white;">+ Add Question</button>
            </div>
            
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-talk-btn" style="background: #ccc; color: #333;">Cancel</button>
              <button type="submit" class="btn">Create & Send to Chatroom</button>
            </div>
          </form>
        </div>
      `;

      // Re-render all questions
      const questionsContainer = document.getElementById('questions-container');
      if (questionsContainer) {
        questionsContainer.innerHTML = '';
        this.addQuestionToForm(0, questionsContainer);
      }

      // Setup event handlers
      this.setupTalkFormHandlers(modal);
    };

    document.body.appendChild(modal);
    renderForm();
  }

  private setupTalkFormHandlers(modal: HTMLElement): void {
    const form = document.getElementById('talk-editor-form') as HTMLFormElement;
    const cancelBtn = document.getElementById('cancel-talk-btn');
    const addQuestionBtn = document.getElementById('add-question-btn');
    const questionsContainer = document.getElementById('questions-container');

    // Cancel button
    cancelBtn?.addEventListener('click', () => {
      if (document.body.contains(modal)) {
        document.body.removeChild(modal);
      }
    });

    // Add question button
    addQuestionBtn?.addEventListener('click', () => {
      const questionCount = questionsContainer?.children.length || 0;
      this.addQuestionToForm(questionCount, questionsContainer!);
      this.updateAllAnswerDropdowns();
    });

    // Form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.processTalkForm(form);
      if (document.body.contains(modal)) {
        document.body.removeChild(modal);
      }
    });
  }

  private addQuestionToForm(index: number, container: HTMLElement): void {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    questionDiv.dataset.questionIndex = index.toString();
    questionDiv.style.cssText = `
      background: #f9f9f9;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    `;

    questionDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <strong style="color: #667eea;">Question ${index + 1}</strong>
        ${index > 0 ? '<button type="button" class="btn-remove-question" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">Remove</button>' : ''}
      </div>
      <input 
        type="text" 
        class="form-input question-text" 
        placeholder="Enter your question here (e.g., Do you like coffee?)" 
        required
        style="margin-bottom: 10px;"
      >
      <div class="answers-container" style="margin-left: 15px;"></div>
      <button type="button" class="btn-add-answer" style="margin-top: 8px; font-size: 0.9em; background: #4CAF50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">+ Add Answer</button>
    `;

    container.appendChild(questionDiv);

    // Add 2 default answers
    const answersContainer = questionDiv.querySelector('.answers-container') as HTMLElement;
    this.addAnswerToQuestion(answersContainer, 0);
    this.addAnswerToQuestion(answersContainer, 1);

    // Setup event handlers
    const removeBtn = questionDiv.querySelector('.btn-remove-question');
    removeBtn?.addEventListener('click', () => {
      container.removeChild(questionDiv);
      this.renumberQuestions();
      this.updateAllAnswerDropdowns();
    });

    const addAnswerBtn = questionDiv.querySelector('.btn-add-answer');
    addAnswerBtn?.addEventListener('click', () => {
      const answerCount = answersContainer.children.length;
      this.addAnswerToQuestion(answersContainer, answerCount);
      this.updateAllAnswerDropdowns();
    });
  }

  private addAnswerToQuestion(container: HTMLElement, index: number): void {
    const answerDiv = document.createElement('div');
    answerDiv.className = 'answer-item';
    answerDiv.dataset.answerIndex = index.toString();
    answerDiv.style.cssText = `
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    `;

    answerDiv.innerHTML = `
      <input 
        type="text" 
        class="form-input answer-text" 
        placeholder="Answer ${index + 1}"
        required
        style="flex: 1;"
      >
      <span style="font-size: 0.9em; color: #666;">→</span>
      <select class="form-input answer-next" style="flex: 0 0 180px; font-size: 0.9em;">
        <option value="ignore">Ignore (filter out)</option>
        <option value="noticed">Noticed (match)</option>
      </select>
      ${index > 1 ? '<button type="button" class="btn-remove-answer" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">×</button>' : ''}
    `;

    container.appendChild(answerDiv);

    // Setup remove handler
    const removeBtn = answerDiv.querySelector('.btn-remove-answer');
    removeBtn?.addEventListener('click', () => {
      container.removeChild(answerDiv);
      this.renumberAnswers(container);
      this.updateAllAnswerDropdowns();
    });
  }

  private renumberQuestions(): void {
    const questions = document.querySelectorAll('.question-item');
    questions.forEach((q, idx) => {
      q.setAttribute('data-question-index', idx.toString());
      const header = q.querySelector('strong');
      if (header) {
        header.textContent = `Question ${idx + 1}`;
      }
    });
  }

  private renumberAnswers(container: HTMLElement): void {
    const answers = container.querySelectorAll('.answer-item');
    answers.forEach((a, idx) => {
      a.setAttribute('data-answer-index', idx.toString());
      const input = a.querySelector('.answer-text') as HTMLInputElement;
      if (input && !input.value) {
        input.placeholder = `Answer ${idx + 1}`;
      }
    });
  }

  private updateAllAnswerDropdowns(): void {
    const questions = document.querySelectorAll('.question-item');

    // Update each answer dropdown based on its question's position
    questions.forEach((questionItem, qIdx) => {
      const answersContainer = questionItem.querySelector('.answers-container');
      if (!answersContainer) return;

      const answerSelects = answersContainer.querySelectorAll('.answer-next');

      answerSelects.forEach((select) => {
        const currentValue = (select as HTMLSelectElement).value;

        // Build options: Ignore, Noticed + only later questions (downward branching)
        const options = [
          '<option value="ignore">Ignore (filter out)</option>',
          '<option value="noticed">Noticed (match)</option>',
        ];

        for (let i = qIdx + 1; i < questions.length; i++) {
          options.push(`<option value="q_${i}">Go to Question ${i + 1}</option>`);
        }

        const optionsHtml = options.join('');
        select.innerHTML = optionsHtml;

        // Restore previous selection if still valid
        if (currentValue && currentValue !== '') {
          const optionExists = Array.from(select.children).some(
            (opt) => (opt as HTMLOptionElement).value === currentValue,
          );
          if (optionExists) {
            (select as HTMLSelectElement).value = currentValue;
          }
        }
      });
    });
  }

  private processTalkForm(form: HTMLFormElement): void {
    const title = (document.getElementById('talk-title') as HTMLInputElement).value;
    const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
      | 'matching'
      | 'survey';

    const questions: any[] = [];
    const questionItems = form.querySelectorAll('.question-item');

    questionItems.forEach((item, qIndex) => {
      const questionText = (item.querySelector('.question-text') as HTMLInputElement).value;
      const answerItems = item.querySelectorAll('.answer-item');

      const answers: any[] = [];
      answerItems.forEach((answerItem, aIndex) => {
        const answerText = (
          answerItem.querySelector('.answer-text') as HTMLInputElement
        ).value.trim();
        const nextQuestion = (answerItem.querySelector('.answer-next') as HTMLSelectElement).value;

        if (answerText) {
          const answer: any = {
            id: `a_${qIndex}_${aIndex}`,
            text: answerText,
          };

          // Handle the different action types
          if (nextQuestion === 'ignore') {
            answer.isIgnore = true;
            answer.isTerminal = true;
          } else if (nextQuestion === 'noticed') {
            answer.isMatch = true;
            answer.isTerminal = true;
          } else if (nextQuestion) {
            // It's a question ID (e.g., "q_1")
            answer.nextQuestionId = nextQuestion;
          }

          answers.push(answer);
        }
      });

      questions.push({
        id: `q_${qIndex}`,
        text: questionText,
        answers: answers,
      });
    });

    this.emit('createTalk', {
      title,
      type,
      questions,
      language: 'en',
      tags: [],
    });
  }

  /**
   * Set member count for a specific chatroom (can be called for any chatroom)
   */
  setChatroomMemberCount(chatroomId: string, count: number): void {
    console.log(`📊 Setting member count for ${chatroomId}: ${count} members`);
    this.chatroomMemberCounts.set(chatroomId, count);

    // Refresh chatroom list to show updated counts (without changing view)
    // Only refresh if the DOM element exists (i.e., after initialization)
    const chatroomList = document.getElementById('chatroom-list');
    if (chatroomList) {
      this.renderChatroomList();
    }
  }

  updateChatroomMembers(
    members: Array<{ userId: string; stageName: string }>,
    currentUserId: string,
  ): void {
    const chatroomMembersList = document.getElementById('chatroom-members-list');
    const chatroomStatus = document.getElementById('current-chatroom-status');

    const otherMembers = members.filter((member) => member.userId !== currentUserId);

    // Update member count for current chatroom
    console.log(
      `📊 Updating member count for ${this.currentChatroom}: ${members.length} total members`,
    );
    this.chatroomMemberCounts.set(this.currentChatroom, members.length);

    // Refresh chatroom list to show updated counts (without changing view)
    this.renderChatroomList();

    // Update Chatrooms detail view (chatroom-members-list)
    if (chatroomMembersList) {
      // Update status - show total member count including current user
      if (chatroomStatus) {
        chatroomStatus.textContent = `👥 ${members.length} member${members.length !== 1 ? 's' : ''} total`;
      }

      // Store members for broadcast functionality
      this.currentChatroomMembers = otherMembers;

      if (otherMembers.length === 0) {
        chatroomMembersList.innerHTML = `
          <div class="empty-state" style="padding: 40px 20px; text-align: center;">
            <p style="font-size: 1.2em; margin-bottom: 8px;">No other users here yet</p>
            <p style="font-size: 0.9em; color: #999;">You're the first one in this chatroom!</p>
          </div>
        `;
      } else {
        chatroomMembersList.innerHTML = otherMembers
          .map(
            (member) => `
          <div class="chatroom-member-item" data-user-id="${member.userId}">
            <div class="chatroom-member-avatar">${member.stageName.charAt(0).toUpperCase()}</div>
            <div class="chatroom-member-info">
              <div class="chatroom-member-name">${member.stageName}</div>
              <div class="chatroom-member-status">Online now</div>
            </div>
          </div>
        `,
          )
          .join('');

        // Add click handlers to member items (could send talk to individual)
        chatroomMembersList.querySelectorAll('.chatroom-member-item').forEach((item) => {
          item.addEventListener('click', (e) => {
            const targetUserId = (e.currentTarget as HTMLElement).getAttribute('data-user-id');
            if (targetUserId) {
              this.emit('sendTalkToUser', { userId: targetUserId });
            }
          });
        });
      }
    }
  }

  updateMatchBadge(): void {
    // Count unread conversations
    const conversations = this.getMyConversations();
    const unreadCount = Object.values(conversations).filter((conv: any) => conv.unread).length;

    // Update badge on Me tab
    const meTab = document.querySelector('.nav-btn[data-view="me"] .nav-icon');
    if (meTab) {
      // Remove existing badge
      const existingBadge = meTab.querySelector('.notification-badge');
      if (existingBadge) existingBadge.remove();

      // Add new badge if there are unread conversations
      if (unreadCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'notification-badge';
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
        meTab.appendChild(badge);
      }
    }
  }

  displayConversationMessages(conversationId: string, messages: any[]): void {
    if (this.currentConversationId !== conversationId) return;

    const messagesContainer = document.getElementById('conversation-messages');
    if (!messagesContainer) return;

    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #999;">
          <p>You matched! Start your conversation...</p>
        </div>
      `;
      return;
    }

    messagesContainer.innerHTML = messages
      .map((msg) => {
        const isOwn = msg.isOwnMessage;
        return `
          <div class="message ${isOwn ? 'message-own' : 'message-other'}">
            <div class="message-content">
              <div class="message-text">${this.escapeHtml(msg.text)}</div>
              <div class="message-time">${this.formatTimeAgo(new Date(msg.timestamp))}</div>
            </div>
          </div>
        `;
      })
      .join('');

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  addNewConversation(conversationData: {
    conversationId: string;
    otherUserId: string;
    otherUserName: string;
    talkId?: string;
  }): void {
    const conversations = this.getMyConversations();

    conversations[conversationData.conversationId] = {
      otherUserId: conversationData.otherUserId,
      otherUserName: conversationData.otherUserName,
      talkId: conversationData.talkId,
      createdAt: new Date().toISOString(),
      lastMessage: null,
      lastMessageTime: null,
      unread: true, // New conversations are marked as unread
    };

    localStorage.setItem('myConversations', JSON.stringify(conversations));

    // Update badge
    this.updateMatchBadge();

    // Show notification
    this.showNotification(`🎉 New match with ${conversationData.otherUserName}!`, 'success');
  }

  updateConversationMessage(conversationId: string, message: string, timestamp: string): void {
    const conversations = this.getMyConversations();

    if (conversations[conversationId]) {
      conversations[conversationId].lastMessage = message;
      conversations[conversationId].lastMessageTime = timestamp;

      // If the current conversation is not open, mark as unread
      if (this.currentConversationId !== conversationId) {
        conversations[conversationId].unread = true;
      }

      localStorage.setItem('myConversations', JSON.stringify(conversations));
      this.updateMatchBadge();
    }
  }
}
