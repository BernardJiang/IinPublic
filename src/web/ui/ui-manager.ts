import { User } from '../../shared/types';
import { EventEmitter } from 'events';
import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import { pickLatestTalkIdFromIncomingCluster, isValidTalkId } from '../../shared/incoming-talk-ids';

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;
  private currentChatroom: string = 'global';
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];
  private currentConversationId: string | undefined = undefined;
  private chatroomMemberCounts: Map<string, number> = new Map(); // Track member count per chatroom
  private expandedChatrooms: Set<string> = new Set(['global']); // Track which chatrooms are expanded (default: global expanded)
  private matchedUserIds: Set<string> = new Set(); // Users who matched with me (for green indicator)
  // private newMatchesCount: number = 0; // TODO: implement match count tracking
  private talkStatsMap: Record<string, { responses: number; matches: number; ignores: number }> = {};
  private talksListDelegationBound = false;
  private incomingTalkClusters: any[] = [];

  // Callback for stage name changes
  public onStageNameChange?: (userId: string, newStageName: string) => Promise<void>;

  getChatroomMemberCount(chatroomId: string): number {
    return this.chatroomMemberCounts.get(chatroomId) || 0;
  }

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
            <!-- Status Bar (Always visible, shows current user and chatroom info) -->
            <div class="status-bar" id="status-bar">
              <div class="status-bar-content">
                <span id="status-bar-text">Connecting...</span>
              </div>
            </div>
            
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

          <!-- Contacts View (users who have matches with current user) -->
          <div class="view-panel" id="contacts-view">
            <div class="view-content">
              <div class="contacts-list-container" id="contacts-list-container">
                <div class="contacts-list" id="contacts-list">
                  <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Match with others via Talks to see them here.</p>
                </div>
              </div>
              <!-- Contact detail: list of talks with this user (hidden by default) -->
              <div class="contact-detail-container" id="contact-detail-container" style="display: none;">
                <div class="contact-detail-header">
                  <button class="back-btn" id="back-to-contacts-list">‹ Back</button>
                  <div class="contact-detail-info" id="contact-detail-info">
                    <div class="contact-detail-name" id="contact-detail-name">Contact</div>
                    <div class="contact-detail-matches" id="contact-detail-matches">0 matches</div>
                  </div>
                </div>
                <div class="contact-talks-list" id="contact-talks-list">
                  <p style="text-align: center; padding: 20px; color: #999;">Loading...</p>
                </div>
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
              <div class="conversations-section" style="margin-top: 24px;">
                <h3 style="font-size: 1em; margin-bottom: 12px; color: #666;">Conversations</h3>
                <div id="conversations-list"></div>
              </div>
            </div>
          </div>

        </div>

        <!-- Bottom Navigation Bar -->
        <div class="bottom-nav">
          <button class="nav-btn active" data-view="chatrooms" data-testid="bottom-navigation-button-chat">
            <div class="nav-icon">🌍</div>
            <div class="nav-label">Chatrooms</div>
          </button>
          <button class="nav-btn" data-view="contacts" data-testid="bottom-navigation-button-contacts">
            <div class="nav-icon">👥</div>
            <div class="nav-label">Contacts</div>
          </button>
          <button class="nav-btn" data-view="talks">
            <div class="nav-icon">📢</div>
            <div class="nav-label">Talks</div>
          </button>
          <button class="nav-btn" data-view="answers">
            <div class="nav-icon">📝</div>
            <div class="nav-label">Answers</div>
          </button>
          <button class="nav-btn" data-view="me" data-testid="bottom-navigation-button-me">
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

    // Back to contacts list button
    const backToContactsListBtn = document.getElementById('back-to-contacts-list');
    if (backToContactsListBtn) {
      backToContactsListBtn.addEventListener('click', () => {
        this.showContactsList();
      });
    }

    // Broadcast talk button: only open "create new talk" when 0 talks to broadcast
    const broadcastTalkBtn = document.getElementById('broadcast-talk-btn');
    if (broadcastTalkBtn) {
      broadcastTalkBtn.addEventListener('click', () => {
        const broadcastableCount = this.getBroadcastableTalkIds().length;
        this.emit('broadcastTalk', {
          chatroomId: this.currentChatroom,
          members: this.currentChatroomMembers,
        });

        // Highlight members who will receive the broadcast
        const list = document.getElementById('chatroom-members-list');
        if (list) {
          list.querySelectorAll('.chatroom-member-item').forEach((el) => {
            el.classList.add('broadcast-sent-to');
          });
          setTimeout(() => {
            list.querySelectorAll('.chatroom-member-item').forEach((el) => {
              el.classList.remove('broadcast-sent-to');
            });
          }, 2500);
        }

        // Only launch create-talk dialog when user has no talks to broadcast; show notification after modal so it stays on top and is visible to E2E
        if (broadcastableCount === 0) {
          this.showTalkEditorDialog();
          setTimeout(() => {
            this.showNotification('You have no talks to broadcast. Create one first or enable copied talks.', 'info');
          }, 0);
        }
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
            contacts: 'Contacts',
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

        // Special handling for contacts view
        if (targetView === 'contacts') {
          this.showContactsList();
        }

        // Special handling for talks view
        if (targetView === 'talks') {
          this.emit('needIncomingTalkClusters');
          this.displayTalksList();
        }

        // Special handling for answers view: show answered talks with match/mismatch
        if (targetView === 'answers') {
          this.displayAnswersList();
        }

        // Special handling for me view: refresh conversations list
        if (targetView === 'me') {
          this.displayConversationsList();
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
          <div style="font-size: 0.95em; font-weight: 500; color: white;" data-testid="user-stage-name">${user.stageName}</div>
        </div>
      `;
      headerUserInfo.style.display = 'block';
    }

    // Update user info in Me view
    const userInfoMe = document.getElementById('user-info-me');
    if (userInfoMe) {
      const copyTalkChecked = this.getCopyTalkAutoSave();
      userInfoMe.innerHTML = `
        <div class="user-avatar" style="width: 80px; height: 80px; font-size: 2em; margin: 20px auto;">
          ${user.stageName.charAt(0).toUpperCase()}
        </div>
        <div style="text-align: center; margin-top: 10px;">
          <div style="font-size: 1.2em; font-weight: 600;">${user.stageName}</div>
          <div style="font-size: 0.9em; color: #999; margin-top: 5px;">Online</div>
          <button class="btn" id="edit-stagename-btn" data-testid="edit-stage-name-button" style="margin-top: 10px;">Edit Stage Name</button>
        </div>
        <div style="margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 12px; text-align: left;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.95em;">
            <input type="checkbox" id="copy-talk-autosave-checkbox" ${copyTalkChecked ? 'checked' : ''}>
            <span>Auto-save received talks (copy talk)</span>
          </label>
          <p style="margin: 8px 0 0 28px; font-size: 0.85em; color: #6b7280;">When off, received talks are not saved to My Talks.</p>
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.95em; margin-top: 14px;">
            <input type="checkbox" id="chatbot-enabled-checkbox" ${this.getChatbotEnabled() ? 'checked' : ''}>
            <span>Enable chatbot (auto-reply with previous match answers)</span>
          </label>
          <p style="margin: 8px 0 0 28px; font-size: 0.85em; color: #6b7280;">When the same talk is sent to you again, reply automatically with your last match answer. Replies show a bot icon.</p>
        </div>
      `;

      // Add event listener for edit stage name button
      const editBtn = document.getElementById('edit-stagename-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => this.showEditStageNameDialog(user));
      }
      const copyTalkCheckbox = document.getElementById('copy-talk-autosave-checkbox') as HTMLInputElement;
      if (copyTalkCheckbox) {
        copyTalkCheckbox.addEventListener('change', () => {
          this.setCopyTalkAutoSave(copyTalkCheckbox.checked);
        });
      }
      const chatbotCheckbox = document.getElementById('chatbot-enabled-checkbox') as HTMLInputElement;
      if (chatbotCheckbox) {
        chatbotCheckbox.addEventListener('change', () => {
          this.setChatbotEnabled(chatbotCheckbox.checked);
        });
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

  showContactsList(): void {
    const listContainer = document.getElementById('contacts-list-container');
    const detailContainer = document.getElementById('contact-detail-container');
    if (listContainer) listContainer.style.display = 'block';
    if (detailContainer) detailContainer.style.display = 'none';
    this.displayContactsList();
  }

  /** Build list of contacts: users who have at least one match (conversation) with current user. */
  displayContactsList(): void {
    const listEl = document.getElementById('contacts-list');
    if (!listEl) return;

    const conversations = this.getMyConversations();
    const byUser: Record<
      string,
      { otherUserName: string; conversations: Array<{ conversationId: string; talkId?: string }> }
    > = {};
    for (const [convId, conv] of Object.entries(conversations)) {
      const c = conv as any;
      const uid = c.otherUserId;
      if (!uid) continue;
      if (!byUser[uid]) {
        byUser[uid] = { otherUserName: c.otherUserName || 'Unknown', conversations: [] };
      }
      byUser[uid].conversations.push({
        conversationId: convId,
        talkId: c.talkId,
      });
    }

    const contactEntries = Object.entries(byUser).sort(
      ([, a], [, b]) => b.conversations.length - a.conversations.length,
    );

    if (contactEntries.length === 0) {
      listEl.innerHTML = `
        <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Match with others via Talks to see them here.</p>
      `;
      return;
    }

    listEl.innerHTML = contactEntries
      .map(
        ([userId, { otherUserName, conversations: convs }]) => `
        <div class="contact-item" data-contact-user-id="${this.escapeHtml(userId)}" data-contact-name="${this.escapeHtml(otherUserName)}" data-contact-count="${convs.length}" style="display: flex; align-items: center; justify-content: space-between; padding: 16px; margin-bottom: 8px; background: white; border-radius: 12px; border: 1px solid #e0e0e0; cursor: pointer;">
          <div>
            <div class="contact-item-name" style="font-weight: 600;">${this.escapeHtml(otherUserName)}</div>
            <div class="contact-item-meta" style="font-size: 0.85em; color: #666;">${convs.length} match(es)</div>
          </div>
          <span style="color: #999;">›</span>
        </div>
      `,
      )
      .join('');

    listEl.querySelectorAll('.contact-item').forEach((el) => {
      el.addEventListener('click', () => {
        const userId = (el as HTMLElement).dataset.contactUserId;
        const name = (el as HTMLElement).dataset.contactName;
        const count = (el as HTMLElement).dataset.contactCount;
        if (userId && name) {
          this.showContactDetail(userId, name, parseInt(count || '0', 10));
        }
      });
    });
  }

  /** Show list of talks that match the current user and the selected contact. */
  showContactDetail(otherUserId: string, otherUserName: string, matchCount: number): void {
    const listContainer = document.getElementById('contacts-list-container');
    const detailContainer = document.getElementById('contact-detail-container');
    const detailName = document.getElementById('contact-detail-name');
    const detailMatches = document.getElementById('contact-detail-matches');
    const talksList = document.getElementById('contact-talks-list');
    if (!listContainer || !detailContainer || !detailName || !detailMatches || !talksList) return;

    listContainer.style.display = 'none';
    detailContainer.style.display = 'block';
    detailName.textContent = otherUserName;
    detailMatches.textContent = `${matchCount} match(es)`;

    const conversations = this.getMyConversations();
    const myTalks = this.getMyTalks();
    const convsWithThisUser = Object.entries(conversations).filter(
      ([, c]: [string, any]) => c.otherUserId === otherUserId,
    );

    if (convsWithThisUser.length === 0) {
      talksList.innerHTML = '<p style="text-align: center; padding: 20px; color: #999;">No matching talks.</p>';
      return;
    }

    talksList.innerHTML = convsWithThisUser
      .map(([, c]: [string, any]) => {
        const talkId = c.talkId;
        const talk = talkId ? myTalks[talkId] : null;
        const title = talk?.title || (talkId ? `Talk ${talkId}` : 'Unknown talk');
        return `
          <div class="contact-talk-item" data-talk-id="${talkId || ''}" style="padding: 14px 16px; margin-bottom: 8px; background: #f9f9f9; border-radius: 10px; border: 1px solid #e0e0e0; cursor: pointer;">
            <div style="font-weight: 600;">${this.escapeHtml(title)}</div>
          </div>
        `;
      })
      .join('');

    talksList.querySelectorAll('.contact-talk-item').forEach((el) => {
      el.addEventListener('click', () => {
        const talkId = (el as HTMLElement).dataset.talkId;
        if (talkId) this.showTalkDetail(talkId);
      });
    });
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

    // One-time delegation on body: use mousedown so we run before any re-render can replace the DOM (click fires later and target can be gone)
    if (!this.talksListDelegationBound) {
      this.talksListDelegationBound = true;
      document.body.addEventListener(
        'mousedown',
        (e) => {
          if (e.button !== 0) return; // only left button
          const target = e.target as HTMLElement;
          if (!target.closest('#talks-list')) return;
          const removeBtn = target.closest('.remove-talk-btn');
          if (removeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = (removeBtn as HTMLElement).dataset.talkId;
            if (talkId) {
              setTimeout(() => this.deleteMyTalk(talkId), 0);
            }
            return;
          }
          const editBtn = target.closest('.edit-talk-btn');
          if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = (editBtn as HTMLElement).dataset.talkId;
            if (talkId) {
              // Always open the talk editor when Edit is clicked (never open response flow here)
              setTimeout(() => this.emit('loadTalkForEdit', { talkId }), 0);
            }
            return;
          }
          const viewBtn = target.closest('.view-talk-btn');
          if (viewBtn) {
            e.preventDefault();
            e.stopPropagation();
            const el = viewBtn as HTMLElement;
            const talkId = el.dataset.talkId || '';
            const identityKey = el.dataset.identityKey || '';
            if (talkId || identityKey) {
              setTimeout(() => this.showTalkDetail(talkId, identityKey || undefined), 0);
            }
            return;
          }
          const label = target.closest('.talk-disable-broadcast-label');
          const checkbox = target.closest('.talk-disable-broadcast-checkbox') as HTMLInputElement | null;
          const control = checkbox ?? (label ? label.querySelector('.talk-disable-broadcast-checkbox') : null) as HTMLInputElement | null;
          if (control && control.dataset) {
            e.preventDefault();
            e.stopPropagation();
            const talkId = control.dataset.talkId;
            if (talkId) {
              control.checked = !control.checked;
              const disabled = control.checked;
              setTimeout(() => {
                this.setTalkDisabled(talkId, disabled);
                this.showNotification(disabled ? 'Talk disabled for broadcast' : 'Talk enabled for broadcast', 'success');
              }, 0);
            }
            return;
          }
        },
        { capture: true },
      );
    }

    // Sort all talks by last interaction
    const allEntries = Object.entries(myTalks)
      .sort(
        ([, a]: [string, any], [, b]: [string, any]) =>
          new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime(),
      );
    // OUT: talks this user created or copied (can broadcast)
    const outEntries = allEntries.filter(([, t]: [string, any]) => t.role === 'created' || t.role === 'copied');
    // IN: backend-consolidated incoming talks (content-hash merged)
    const backendInEntries = (this.incomingTalkClusters || []).filter((c: any) => c && c.identityKey);
    const inEntries = backendInEntries;

    if (allEntries.length === 0 && inEntries.length === 0) {
      talksList.innerHTML = `
        <div class="empty-state" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 3em; margin-bottom: 16px;">💬</div>
          <p style="font-size: 1.2em; color: #666; margin-bottom: 8px;">No talks yet</p>
          <p style="font-size: 0.9em; color: #999;">Create your first talk or wait for talks from others.</p>
        </div>
      `;
    } else {
      const outHtml =
        outEntries.length > 0
          ? outEntries
              .map(
                ([talkId, talk]) => {
                  const stats = this.talkStatsMap[talkId];
                  const statsLine = stats
                    ? `Responses: ${stats.responses} · Matches: ${stats.matches} · Ignores: ${stats.ignores}`
                    : '—';
                  const conversations = this.getMyConversations();
                  const matchedNames = Object.values(conversations)
                    .filter((c: any) => c.talkId === talkId)
                    .map((c: any) => c.respondedByBot ? `${c.otherUserName} 🤖` : c.otherUserName);
                  const matchedLine =
                    matchedNames.length > 0
                      ? `<div class="talk-item-matched" style="font-size: 0.85em; color: #2e7d32; margin-top: 4px;">Matched with: ${matchedNames.join(', ')}</div>`
                      : '';
                  const disabled = !!talk.disabled;
                  const expText = this.formatExpiration(talk.expiresAt);
                  const locText = this.formatLocationRadius(talk.locationRadiusMiles);
                  const roleBadge = talk.role === 'copied'
                    ? '<span class="talk-badge talk-badge-copied" style="background:#e0e7ff;color:#3730a3;">📋 Copied</span>'
                    : '<span class="talk-badge talk-badge-created" style="background:#dbeafe;color:#1e40af;">📝 Created</span>';
                  return `
        <div class="talk-list-item" data-talk-id="${talkId}" data-role="${talk.role || 'created'}">
          <div class="talk-item-header">
            <div class="talk-item-title">${this.escapeHtml(talk.title)}</div>
            <div class="talk-item-badges">
              ${roleBadge}
              <span class="talk-badge talk-badge-type">${talk.type}</span>
              ${disabled ? '<span class="talk-badge talk-badge-disabled" style="background:#fef3c7;color:#92400e;">🚫 Disabled</span>' : ''}
            </div>
          </div>
          <div class="talk-item-meta">
            <span class="talk-item-time">${this.formatTimeAgo(new Date(talk.lastInteraction))}</span>
          </div>
          <div class="talk-item-meta" style="font-size: 0.85em; color: #666;">
            Expiration: ${expText} · Location: ${locText}
          </div>
          <div class="talk-item-stats" style="font-size: 0.85em; color: #666; margin-top: 6px;">
            ${statsLine}
          </div>
          ${matchedLine}
          <div class="talk-item-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="btn edit-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">✏️ Edit</button>
            <label class="talk-disable-broadcast-label" style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
              <input type="checkbox" class="talk-disable-broadcast-checkbox" data-talk-id="${talkId}" ${disabled ? 'checked' : ''}>
              <span>Disable for broadcast</span>
            </label>
            <button type="button" class="btn remove-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em; background: #dc3545; color: white;">🗑️ Remove</button>
          </div>
        </div>
      `;
                },
              )
              .join('')
          : '';

      const inHtml =
        inEntries.length > 0
          ? backendInEntries
              .map((cluster: any) => {
                const sendersObj = cluster?.senders && typeof cluster.senders === 'object' ? cluster.senders : {};
                const senderNames = Array.from(
                  new Set(
                    Object.values(sendersObj)
                      .map((s: any) => String(s?.senderName || '').trim())
                      .filter(Boolean),
                  ),
                );
                const talkId = this.pickIncomingRowTalkId(cluster);
                const identityKey = String(cluster?.identityKey || '');
                const isAnswered = !!cluster?.isAnswered;
                const titleStyle = isAnswered
                  ? 'font-weight: 500; color: #9ca3af;'
                  : 'font-weight: 700; color: #1d4ed8;';
                const metaStyle = isAnswered ? 'color: #9ca3af;' : 'color: #4b5563;';
                const statusBadge = isAnswered
                  ? '<span class="talk-badge" style="background:#f3f4f6;color:#6b7280;">✅ Answered</span>'
                  : '<span class="talk-badge" style="background:#dbeafe;color:#1d4ed8;font-weight:700;">🆕 New</span>';
                return `
        <div class="talk-list-item" data-talk-id="${talkId}" data-identity-key="${this.escapeHtml(identityKey)}" data-role="incoming" style="${isAnswered ? 'background:#fafafa;' : ''}">
          <div class="talk-item-header">
            <div class="talk-item-title" style="${titleStyle}">${this.escapeHtml(cluster?.title || 'Incoming Talk')}</div>
            <div class="talk-item-badges">
              ${statusBadge}
              <span class="talk-badge talk-badge-type">${this.escapeHtml(cluster?.type || 'matching')}</span>
              <span class="talk-badge" style="background:#eef2ff;color:#3730a3;">👥 ${senderNames.length} sender${senderNames.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="talk-item-meta" style="${metaStyle}">
            <span class="talk-item-time">${this.formatTimeAgo(new Date(cluster?.updatedAt || Date.now()))}</span>
          </div>
          <div class="talk-item-meta" style="font-size: 0.85em; ${metaStyle}">
            From: ${this.escapeHtml(senderNames.join(', ') || 'Unknown')}
          </div>
          <div class="talk-item-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="btn view-talk-btn" data-talk-id="${talkId}" data-identity-key="${this.escapeHtml(identityKey)}" style="padding: 6px 12px; font-size: 0.9em;" ${talkId || identityKey ? '' : 'disabled'}>🔍 View</button>
          </div>
        </div>
      `;
              })
              .join('')
          : '';

      const sectionOut =
        outEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📤</span> OUT <span style="font-size: 0.8em; font-weight: 400; color: #6b7280;">(${outEntries.length} talk${outEntries.length !== 1 ? 's' : ''} · created or copied)</span>
             </div>${outHtml}`
          : '';
      const sectionIn =
        inEntries.length > 0
          ? `<div class="talks-section-header" style="font-size: 1em; font-weight: 700; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 1.2em;">📥</span> IN <span style="font-size: 0.8em; font-weight: 400; color: #6b7280;">(${inEntries.length} talk${inEntries.length !== 1 ? 's' : ''} · consolidated by content)</span>
             </div>${inHtml}`
          : '';

      talksList.innerHTML = sectionIn + sectionOut;

      // Request stats for out talks (created/copied) only
      if (outEntries.length > 0) {
        const talkIds = outEntries.map(([id]) => id);
        this.emit('needTalkStats', { talkIds });
      }

      // Row click opens edit/detail only when not clicking an action button (handled in capture above)
      talksList.querySelectorAll('.talk-list-item').forEach((item) => {
        const el = item as HTMLElement;
        const talkId = el.dataset.talkId || '';
        const identityKey = el.dataset.identityKey || '';
        const role = el.dataset.role;
        if (role === 'incoming' && !talkId && !identityKey) return;
        if (role !== 'incoming' && !talkId) return;
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.talk-item-actions')) return;
          if (role === 'created' || role === 'copied') {
            this.emit('loadTalkForEdit', { talkId });
          } else {
            this.showTalkDetail(talkId, identityKey || undefined);
          }
        });
      });
    }
  }

  setTalkStats(statsMap: Record<string, { responses: number; matches: number; ignores: number }>): void {
    this.talkStatsMap = { ...this.talkStatsMap, ...statsMap };
  }

  setIncomingTalkClusters(clusters: any[]): void {
    this.incomingTalkClusters = Array.isArray(clusters) ? clusters : [];
  }

  displayAnswersList(): void {
    const container = document.getElementById('answers-content');
    if (!container) return;
    const myTalks = this.getMyTalks();
    const answeredEntries = Object.entries(myTalks)
      .filter(([, t]: [string, any]) => t?.role === 'answered' || t?.role === 'copied')
      .sort(
        ([, a]: [string, any], [, b]: [string, any]) =>
          new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime(),
      );
    const deduped: Array<[string, any]> = [];
    const seenContent = new Set<string>();
    for (const [talkId, talk] of answeredEntries) {
      const full = talk.fullTalk;
      const contentKey = full ? UIManager.getTalkContentKey(full) : talkId;
      if (seenContent.has(contentKey)) continue;
      seenContent.add(contentKey);
      deduped.push([talkId, talk]);
    }
    if (deduped.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #999;">
          <p>Talks you've received and answered will appear here.</p>
          <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">View My Answers (preferences)</button>
        </div>
      `;
      const prefsBtn = document.getElementById('view-preferences-btn');
      if (prefsBtn) prefsBtn.addEventListener('click', () => this.showPreferencesDialog());
      return;
    }
    container.innerHTML = `
      <div class="answers-view-inner" style="padding: 16px; max-width: min(900px, 95%); margin: 0 auto;">
        <p style="margin-bottom: 12px; color: #666;">Talks you've received and answered (same question set = one entry, multiple senders):</p>
        <div id="answers-list" class="answers-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
        <button class="btn primary-btn" id="view-preferences-btn" style="margin-top: 20px;">View My Answers (preferences)</button>
      </div>
    `;
    const listEl = document.getElementById('answers-list');
    if (listEl) {
      deduped.forEach(([talkId, talk]) => {
        const outcome = talk.outcome === 'match' ? 'match' : 'mismatch';
        const senders = talk.senders && talk.senders.length > 0
          ? talk.senders.length === 1
            ? `From 1 sender`
            : `From ${talk.senders.length} senders`
          : '';
        const item = document.createElement('div');
        item.className = 'answer-talk-item';
        item.dataset.talkId = talkId;
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 8px; background: ' + (outcome === 'match' ? '#e8f5e9' : '#fff3e0') + '; border: 1px solid ' + (outcome === 'match' ? '#c8e6c9' : '#ffe0b2') + '; flex-wrap: wrap;';
        item.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600;">${this.escapeHtml(talk.title)}</div>
            <div style="font-size: 0.85em; color: #666;">${senders} · ${outcome === 'match' ? '✓ Match' : '✗ Mismatch'}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn answer-copy-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Copy</button>
            <button type="button" class="btn answer-edit-talk-btn" data-talk-id="${talkId}" style="padding: 6px 12px; font-size: 0.9em;">Edit</button>
          </div>
        `;
        listEl.appendChild(item);
      });
    }
    listEl?.querySelectorAll('.answer-copy-talk-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
        if (!talkId) return;
        this.copyAnsweredTalkToTalks(talkId);
      });
    });
    listEl?.querySelectorAll('.answer-edit-talk-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const talkId = (e.currentTarget as HTMLElement).dataset.talkId;
        if (!talkId) return;
        this.showTalkDetail(talkId);
      });
    });
    const prefsBtn = document.getElementById('view-preferences-btn');
    if (prefsBtn) prefsBtn.addEventListener('click', () => this.showPreferencesDialog());
  }

  private copyAnsweredTalkToTalks(talkId: string): void {
    const myTalks = this.getMyTalks();
    const talk = myTalks[talkId];
    if (!talk?.fullTalk) {
      this.showNotification('Talk data not found', 'error');
      return;
    }
    if (talk.role === 'copied') {
      this.showNotification('Already in your Talks list', 'info');
      return;
    }
    this.saveMyTalk({
      talkId,
      title: talk.title,
      type: talk.type,
      timestamp: talk.lastInteraction || new Date().toISOString(),
      role: 'copied',
      fullTalk: talk.fullTalk,
      outcome: talk.outcome,
      senders: talk.senders,
    });
    this.showNotification('Copied to Talks tab', 'success');
    this.displayTalksList();
    this.displayAnswersList();
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

  private formatExpiration(expiresAt: number | null | undefined): string {
    if (expiresAt == null) return 'Forever';
    const now = Date.now();
    if (now > expiresAt) return 'Expired';
    const oneDay = 24 * 60 * 60 * 1000;
    const left = expiresAt - now;
    if (left <= oneDay) return 'Expires in &lt;1d';
    if (left <= 7 * oneDay) return `Expires in ${Math.floor(left / oneDay)}d`;
    if (left <= 30 * oneDay) return `Expires in ${Math.floor(left / (7 * oneDay))}w`;
    if (left <= 365 * oneDay) return `Expires in ${Math.floor(left / (30 * oneDay))}mo`;
    return `Expires in ${Math.floor(left / (365 * oneDay))}y`;
  }

  private formatLocationRadius(radiusMiles: number | null | undefined): string {
    if (radiusMiles == null) return 'Anywhere';
    return `${radiusMiles} mi`;
  }

  /** Resolve a concrete talk UUID for an incoming cluster (Gun may reshape talkIds). */
  private pickIncomingRowTalkId(cluster: any): string {
    return pickLatestTalkIdFromIncomingCluster(cluster || {});
  }

  private showTalkDetail(talkId: string, identityKeyFallback?: string): void {
    const raw = (talkId || '').trim();
    const tid = isValidTalkId(raw) ? raw : '';
    if (!tid && identityKeyFallback) {
      this.emit('demandFullTalkByIdentity', {
        identityKey: identityKeyFallback,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true });
          else this.showNotification('Could not load talk.', 'error');
        },
      });
      return;
    }
    if (!tid) {
      this.showNotification('Could not open talk.', 'error');
      return;
    }

    const myTalks = this.getMyTalks();
    const talk = myTalks[tid];

    if (talk) {
      if (talk.role === 'created') {
        // Open editor for editing
        this.emit('loadTalkForEdit', { talkId: tid });
      } else if ((talk.role === 'answered' || talk.role === 'copied') && talk.fullTalk) {
        // Open response view without auto-answering (avoid instant "Match!" toast when just viewing)
        this.showTalkResponseDialog(talk.fullTalk, { skipAutoAnswer: true });
      } else {
        this.showNotification(`Talk: ${talk.title}`, 'info');
      }
    } else {
      // Incoming: load by id; if Gun gave a bad id, app retries via identityKey from server API.
      this.emit('demandFullTalk', {
        talkId: tid,
        identityKeyFallback: identityKeyFallback || undefined,
        callback: (fullTalk: any) => {
          if (fullTalk) this.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true });
          else
            this.showNotification(
              'Could not load this talk yet. Check your connection and try again.',
              'error',
            );
        },
      });
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
        <div class="conversation-list-item ${conversation.unread ? 'unread' : ''}" data-conversation-id="${conversationId}" data-responded-by-bot="${!!conversation.respondedByBot}">
          <div class="conversation-avatar-wrapper" style="position: relative;">
            <div class="conversation-avatar">
              ${conversation.otherUserName?.charAt(0).toUpperCase() || '?'}
            </div>
            ${conversation.respondedByBot ? '<span class="conversation-bot-badge" title="Answered by chatbot">🤖</span>' : ''}
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
    // No modal needed - user creation is automatic
    // Welcome banner will be shown on chatrooms tab after joining
    return Promise.resolve({
      languages: ['en'],
      interests: [],
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
                     data-testid="stage-name-input"
                     required minlength="3" maxlength="50"
                     placeholder="Enter your new stage name"
                     value="${user.stageName}">
              <small style="color: #666; font-size: 0.85em;">3-50 characters</small>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-edit-btn" style="background: #6c757d;">Cancel</button>
              <button type="submit" class="btn" data-testid="save-stage-name-button">Save</button>
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

  updateStatusBar(
    stageName: string,
    chatroomName: string,
    memberCount: number,
    totalMatches?: number,
  ): void {
    const statusBar = document.getElementById('status-bar');
    const statusBarText = document.getElementById('status-bar-text');

    if (statusBar && statusBarText) {
      let text = `${stageName} in ${chatroomName} with ${memberCount} ${memberCount === 1 ? 'user' : 'users'}`;
      if (totalMatches !== undefined && totalMatches > 0) {
        text += ` · ${totalMatches} match${totalMatches !== 1 ? 'es' : ''}`;
      }
      statusBarText.textContent = text;
    }
  }

  getTotalMatches(): number {
    return Object.values(this.talkStatsMap).reduce((sum, s) => sum + s.matches, 0);
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
    // Do not auto-save to myTalks. Rely on the backend incomingTalkClusters instead.

    // Show a notification for received talks and flash the author's icon in member list
    if (!talk.isOwnTalk) {
      this.showNotification(`📥 New talk from ${talk.authorName}: ${talk.title}`, 'info');
      const authorId = talk.fullTalk?.authorId;
      if (authorId) this.flashMemberForNewTalk(authorId);
    }

    // Refresh the talks list if the Talks tab is currently active
    const talksTab = document.getElementById('tab-talks');
    if (talksTab?.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  showTalkResponseDialog(talk: any, options?: { skipAutoAnswer?: boolean }): void {
    const skipAutoAnswer = options?.skipAutoAnswer ?? false;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talk-response-modal';

    // Tag: single checkbox (match / ignore)
    if (talk.type === 'tag') {
      const q = talk.questions?.[0];
      if (!q || !q.answers?.length) {
        this.showNotification('Invalid tag', 'error');
        return;
      }
      const matchAnswer = q.answers.find((a: any) => a.isMatch);
      const ignoreAnswer = q.answers.find((a: any) => a.isIgnore);
      const savedTagPreference = this.getAnswerPreference(talk.id, q.id);
      const isSavedMatch =
        !!savedTagPreference &&
        !!matchAnswer &&
        (savedTagPreference.answerId === matchAnswer.id ||
          savedTagPreference.answerText?.toLowerCase() === (matchAnswer.text || '').toLowerCase());
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
          <div class="modal-header">
            <h2 class="modal-title">${this.escapeHtml(talk.title)}</h2>
            <p>Tag — check to match, leave unchecked to ignore</p>
          </div>
          <div style="padding: 20px;">
            <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 20px;">
              ${this.escapeHtml(q.text)}
            </div>
            <label class="tag-checkbox-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 1.1em;">
              <input type="checkbox" id="tag-match-checkbox" class="tag-match-checkbox" ${isSavedMatch ? 'checked' : ''}>
              <span>Match (I'm interested)</span>
            </label>
            <button type="button" id="tag-submit-btn" class="btn" style="margin-top: 20px; width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 1em; cursor: pointer;">
              Submit
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const checkbox = document.getElementById('tag-match-checkbox') as HTMLInputElement;
      const submitBtn = document.getElementById('tag-submit-btn');
      const answers: { questionId: string; answerId: string; answerText: string }[] = [];
      submitBtn?.addEventListener('click', () => {
        const checked = checkbox?.checked;
        const answer = checked && matchAnswer ? matchAnswer : ignoreAnswer;
        if (!answer) {
          this.completeTalk(talk, [], 'mismatch');
        } else {
          answers.push({
            questionId: q.id,
            answerId: answer.id,
            answerText: answer.text || (checked ? 'Match.' : 'Ignore.'),
          });
          this.saveAnswerPreference(
            talk.id,
            q.id,
            answer.id,
            answer.text || (checked ? 'Match.' : 'Ignore.'),
            q.text,
            q.answers,
          );
          if (checked && matchAnswer) {
            this.showNotification('Match! You both noticed each other.', 'success');
            this.completeTalk(talk, answers, 'match');
          } else {
            this.showNotification('Tag ignored - no match', 'info');
            this.completeTalk(talk, answers, 'mismatch');
          }
        }
        if (document.body.contains(modal)) document.body.removeChild(modal);
      });
      return;
    }

    if (!Array.isArray(talk.questions) || talk.questions.length === 0) {
      this.showNotification('Could not load talk (missing questions).', 'error');
      return;
    }

    // Start with first question
    let currentQuestion = talk.questions[0];
    const answers: { questionId: string; answerId: string; answerText: string; mode?: 'auto' | 'manual' }[] = [];

    const renderQuestion = () => {
      if (!currentQuestion) {
        // No more questions - complete the talk
        this.completeTalk(talk, answers, 'mismatch');
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        return;
      }

      // Check if there's a saved preference for this question (skip when opening from list to avoid instant match toast)
      const savedPreference = skipAutoAnswer ? null : this.getAnswerPreference(talk.id, currentQuestion.id);
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
            mode: (savedPreference.mode as 'auto' | 'manual') || 'auto',
          });

          // Handle the answer (same logic as manual click)
          if (answer.isIgnore) {
            this.showNotification('Talk ignored - no match (auto)', 'info');
            this.completeTalk(talk, answers, 'mismatch');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            return;
          } else if (answer.isMatch) {
            this.completeTalk(talk, answers, 'match');
            this.showNotification('Match! You both noticed each other. (auto)', 'success');
            if (document.body.contains(modal)) {
              document.body.removeChild(modal);
            }
            return;
          } else if (answer.isTerminal) {
            this.completeTalk(talk, answers, 'mismatch');
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
              this.completeTalk(talk, answers, 'mismatch');
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
      const choiceRadioName = `choice-${currentQuestion.id}`;
      const showBackButton = currentQuestionIndex > 0;
      const previousChoiceFromSession = answers.find((a) => a.questionId === currentQuestion.id);
      const savedPreferenceForDisplay = this.getAnswerPreference(talk.id, currentQuestion.id);
      const previousChoice =
        previousChoiceFromSession ||
        (savedPreferenceForDisplay
          ? {
              answerId: savedPreferenceForDisplay.answerId,
              answerText: savedPreferenceForDisplay.answerText,
              mode: (savedPreferenceForDisplay.mode as 'auto' | 'manual') || 'manual',
            }
          : undefined);

      modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
          <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div>
              <h2 class="modal-title">${this.escapeHtml(talk.title)}</h2>
              <p>Question ${currentQuestionIndex + 1} of ${talk.questions.length}</p>
            </div>
            ${showBackButton ? `<button type="button" class="btn btn-back-question" data-testid="back-question-btn">← Previous question</button>` : ''}
          </div>
          <div style="padding: 20px;">
            <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 16px;">
              ${this.escapeHtml(currentQuestion.text)}
            </div>
            <div class="answer-radio-grid" role="radiogroup" aria-label="Choose answer and mode">
              <div class="answer-grid-header">
                <span>Auto</span><span>Manual</span><span></span>
              </div>
              ${currentQuestion.answers
                .map(
                  (answer: any) => {
                    const prevMode = previousChoice?.answerId === answer.id ? (previousChoice?.mode ?? 'manual') : '';
                    return `
                <div class="answer-grid-row">
                  <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="${answer.id}_auto" class="choice-radio"
                    data-answer-id="${answer.id}"
                    data-answer-text="${this.escapeHtml(answer.text)}"
                    data-mode="auto"
                    data-is-terminal="${answer.isTerminal || false}"
                    data-is-ignore="${answer.isIgnore || false}"
                    data-is-match="${answer.isMatch || false}"
                    data-next-question-id="${answer.nextQuestionId || ''}"
                    ${prevMode === 'auto' ? 'checked' : ''}></label>
                  <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="${answer.id}_manual" class="choice-radio"
                    data-answer-id="${answer.id}"
                    data-answer-text="${this.escapeHtml(answer.text)}"
                    data-mode="manual"
                    data-is-terminal="${answer.isTerminal || false}"
                    data-is-ignore="${answer.isIgnore || false}"
                    data-is-match="${answer.isMatch || false}"
                    data-next-question-id="${answer.nextQuestionId || ''}"
                    ${prevMode === 'manual' ? 'checked' : ''}></label>
                  <span class="answer-grid-label">${this.escapeHtml(answer.text)}</span>
                </div>
              `;
                  },
                )
                .join('')}
              <div class="answer-grid-row answer-grid-row-ignore">
                <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="ignore" class="choice-radio ignore-radio"
                  data-answer-id="ignore"
                  data-answer-text="ignore"
                  data-mode="manual"
                  data-is-terminal="false"
                  data-is-ignore="true"
                  data-is-match="false"
                  data-next-question-id=""
                  ${previousChoice?.answerId === 'ignore' ? 'checked' : ''}></label>
                <span class="answer-grid-cell"></span>
                <span class="answer-grid-label">Ignore</span>
              </div>
            </div>
          </div>
        </div>
      `;

      const applyChoice = (radio: HTMLInputElement) => {
        const answerId = radio.dataset.answerId!;
        const isIgnore = radio.dataset.isIgnore === 'true';
        const answerText = radio.dataset.answerText || '';
        const answerMode = (radio.dataset.mode || 'manual') as 'auto' | 'manual';
        const isTerminal = radio.dataset.isTerminal === 'true';
        const isMatch = radio.dataset.isMatch === 'true';
        const nextQuestionId = radio.dataset.nextQuestionId || '';

        answers.push({
          questionId: currentQuestion.id,
          answerId,
          answerText: isIgnore ? 'ignore' : answerText,
          mode: answerMode,
        });

        if (!isIgnore) {
          this.saveAnswerPreference(
            talk.id,
            currentQuestion.id,
            answerId,
            answerText,
            currentQuestion.text,
            currentQuestion.answers,
          );
          const preferences = this.getAnswerPreferences();
          const key = `${talk.id}_${currentQuestion.id}`;
          if (preferences[key]) {
            preferences[key].mode = answerMode;
            localStorage.setItem('answerPreferences', JSON.stringify(preferences));
          }
        }

        if (isIgnore) {
          this.showNotification('Talk ignored - no match', 'info');
          this.completeTalk(talk, answers, 'mismatch');
          if (document.body.contains(modal)) document.body.removeChild(modal);
        } else if (isMatch) {
          this.completeTalk(talk, answers, 'match');
          this.showNotification('Match! You both noticed each other.', 'success');
          if (document.body.contains(modal)) document.body.removeChild(modal);
        } else if (isTerminal) {
          this.completeTalk(talk, answers, 'mismatch');
          if (document.body.contains(modal)) document.body.removeChild(modal);
        } else if (nextQuestionId) {
          const nextQ = talk.questions.find((q: any) => q.id === nextQuestionId);
          if (nextQ) {
            currentQuestion = nextQ;
            renderQuestion();
          } else {
            this.completeTalk(talk, answers, 'mismatch');
            if (document.body.contains(modal)) document.body.removeChild(modal);
          }
        } else {
          this.completeTalk(talk, answers, 'mismatch');
          if (document.body.contains(modal)) document.body.removeChild(modal);
        }
      };

      modal.querySelectorAll('.choice-radio').forEach((radioEl) => {
        radioEl.addEventListener('change', (e) => {
          const radio = e.target as HTMLInputElement;
          if (radio.checked) applyChoice(radio);
        });
      });

      const backBtn = modal.querySelector('[data-testid="back-question-btn"]');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          answers.pop();
          currentQuestion = talk.questions[currentQuestionIndex - 1];
          renderQuestion();
        });
      }
    };

    document.body.appendChild(modal);
    renderQuestion();
  }

  private static getTalkContentKey(talk: any): string {
    const q = (talk.questions || []).map((qu: any) => ({
      text: qu.text,
      answers: (qu.answers || []).map((a: any) => a.text),
    }));
    const title = talk.type === 'tag' ? talk.title : '';
    const loc = talk.locationRadiusMiles != null ? String(talk.locationRadiusMiles) : '';
    return JSON.stringify({ q, loc, title, type: talk.type });
  }

  private getAnsweredByContent(): Record<string, string> {
    const raw = localStorage.getItem('answeredTalkByContent');
    return raw ? JSON.parse(raw) : {};
  }

  private setAnsweredByContent(map: Record<string, string>): void {
    localStorage.setItem('answeredTalkByContent', JSON.stringify(map));
  }

  private completeTalk(talk: any, answers: any[], outcome?: 'match' | 'mismatch'): void {
    console.log('✅ Talk completed:', talk.id, answers, outcome);

    const contentKey = UIManager.getTalkContentKey(talk);
    const answeredByContent = this.getAnsweredByContent();
    const existingTalkId = answeredByContent[contentKey];
    const myTalks = this.getMyTalks();
    const authorId = talk.authorId || (talk as any).authorId;

    let talkIdToUse: string;
    let senders: string[];

    if (existingTalkId && myTalks[existingTalkId]) {
      talkIdToUse = existingTalkId;
      const existing = myTalks[existingTalkId];
      const prevSenders = existing.senders || (existing.fullTalk?.authorId ? [existing.fullTalk.authorId] : []);
      senders = [...new Set([...prevSenders, authorId].filter(Boolean))];
    } else {
      talkIdToUse = talk.id;
      senders = authorId ? [authorId] : [];
      answeredByContent[contentKey] = talk.id;
      this.setAnsweredByContent(answeredByContent);
    }

    const existingEntry = myTalks[talkIdToUse];
    const role = existingEntry?.role === 'copied' ? 'copied' : 'answered';

    this.saveMyTalk({
      talkId: talkIdToUse,
      title: talk.title,
      type: talk.type,
      timestamp: talk.createdAt || new Date().toISOString(),
      role,
      fullTalk: existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk,
      outcome: outcome ?? existingEntry?.outcome ?? 'mismatch',
      senders,
    });

    this.emit('talkCompleted', {
      talkId: talk.id,
      answers,
      talkData: talk,
    });

    this.showNotification(
      talk.type === 'matching'
        ? "Response submitted! We'll notify you of matches."
        : talk.type === 'tag'
          ? "Tag response submitted!"
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
    const key = `${talkId}_${questionId}`;
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
    console.log('💾 Saved answer to my list:', key, answerText);
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
    talkId: string,
    questionId: string,
  ): {
    answerId: string;
    answerText: string;
    mode: string;
    questionText?: string;
    allAnswers?: any[];
  } | null {
    const preferences = this.getAnswerPreferences();
    const key = `${talkId}_${questionId}`;
    return preferences[key] || null;
  }

  private static normalizeQuestionKey(questionText: string): string {
    return questionText.trim().toLowerCase();
  }

  private getMyQuestionAnswers(): Record<
    string,
    { questionText: string; answerId: string; answerText: string; isIgnored: boolean; timestamp: string; location?: string }
  > {
    const stored = localStorage.getItem('myQuestionAnswers');
    return stored ? JSON.parse(stored) : {};
  }

  private setMyQuestionAnswer(
    key: string,
    value: { questionText: string; answerId: string; answerText: string; isIgnored: boolean; timestamp: string; location?: string },
  ): void {
    const all = this.getMyQuestionAnswers();
    all[key] = value;
    localStorage.setItem('myQuestionAnswers', JSON.stringify(all));
  }

  /**
   * Called by app when user completes a talk: save each question-answer to myQuestionAnswers (keyed by question text; last wins).
   */
  saveQuestionAnswersFromCompletion(
    talkData: { questions?: Array<{ id: string; text?: string }> },
    answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
    location?: { latitude: number; longitude: number },
  ): void {
    const locationStr = location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : undefined;
    const timestamp = new Date().toISOString();
    const questions = talkData.questions || [];
    for (const a of answers) {
      const q = questions.find((qu: any) => qu.id === a.questionId);
      const questionText = q?.text?.trim() || '';
      if (!questionText) continue;
      const key = UIManager.normalizeQuestionKey(questionText);
      const isIgnored = a.answerText === 'ignore' || !a.answerText;
      const entry: {
        questionText: string;
        answerId: string;
        answerText: string;
        isIgnored: boolean;
        timestamp: string;
        location?: string;
      } = {
        questionText,
        answerId: a.answerId,
        answerText: isIgnored ? '' : (a.answerText || ''),
        isIgnored,
        timestamp,
      };
      if (locationStr != null) entry.location = locationStr;
      this.setMyQuestionAnswer(key, entry);
    }
    const answersView = document.getElementById('answers-view');
    if (answersView?.classList.contains('active')) {
      this.displayAnswersList();
    }
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
    role: 'created' | 'answered' | 'copied';
    fullTalk?: any;
    outcome?: 'match' | 'mismatch';
    disabled?: boolean;
    senders?: string[];
  }): void {
    const myTalks = this.getMyTalks();
    const existing = myTalks[talkData.talkId];
    const full = talkData.fullTalk;
    myTalks[talkData.talkId] = {
      ...existing,
      ...talkData,
      disabled: talkData.disabled ?? existing?.disabled ?? false,
      expiresAt: existing?.expiresAt ?? full?.expiresAt ?? undefined,
      locationRadiusMiles: existing?.locationRadiusMiles ?? full?.locationRadiusMiles ?? undefined,
      senders: talkData.senders ?? existing?.senders ?? undefined,
      lastInteraction: new Date().toISOString(),
    };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));

    // Refresh talks list if currently viewing Talks tab
    const talksView = document.getElementById('talks-view');
    if (talksView && talksView.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  /** Talks that can be included in broadcast: created or copied, not disabled, and not expired */
  getBroadcastableTalkIds(): string[] {
    const myTalks = this.getMyTalks();
    const now = Date.now();
    return Object.entries(myTalks)
      .filter(([, t]: [string, any]) => {
        if (t?.disabled) return false;
        if (t?.role !== 'created' && t?.role !== 'copied') return false;
        if (t?.expiresAt != null && typeof t.expiresAt === 'number' && now > t.expiresAt) return false;
        return true;
      })
      .map(([id]) => id);
  }

  /**
   * Called by app after a talk is created: saves to myTalks and user's answer list (answerPreferences).
   */
  saveCreatedTalk(
    talk: { id: string; title: string; type: string; questions: any[]; expiresAt?: number | null; locationRadiusMiles?: number | null },
    options: { selfAnswers: { questionId: string; answerId: string }[] },
  ): void {
    const myTalks = this.getMyTalks();
    myTalks[talk.id] = {
      ...myTalks[talk.id],
      talkId: talk.id,
      title: talk.title,
      type: talk.type,
      timestamp: new Date().toISOString(),
      role: 'created',
      fullTalk: talk,
      disabled: false,
      expiresAt: talk.expiresAt ?? undefined,
      locationRadiusMiles: talk.locationRadiusMiles ?? undefined,
      lastInteraction: new Date().toISOString(),
    };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));

    // Save self-answers to answer preferences (user's answer list) for chatbot/auto-reply
    const preferences = this.getAnswerPreferences();
    for (const { questionId, answerId } of options.selfAnswers) {
      const q = talk.questions?.find((qu: any) => qu.id === questionId);
      if (!q) continue;
      const a = q.answers?.find((an: any) => an.id === answerId);
      if (!a) continue;
      const key = `${talk.id}_${questionId}`;
      preferences[key] = {
        answerId: a.id,
        answerText: a.text,
        mode: 'auto',
        talkId: talk.id,
        questionText: q.text || '',
        allAnswers: q.answers || [],
        timestamp: new Date().toISOString(),
      };
    }
    localStorage.setItem('answerPreferences', JSON.stringify(preferences));

    const talksView = document.getElementById('talks-view');
    if (talksView?.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  getCopyTalkAutoSave(): boolean {
    const v = localStorage.getItem('copyTalkAutoSave');
    return v === null || v === 'true';
  }

  setCopyTalkAutoSave(enabled: boolean): void {
    localStorage.setItem('copyTalkAutoSave', String(enabled));
  }

  getChatbotEnabled(): boolean {
    return localStorage.getItem('chatbotEnabled') === 'true';
  }

  setChatbotEnabled(enabled: boolean): void {
    localStorage.setItem('chatbotEnabled', String(enabled));
  }

  getChatbotTemplate(talkId: string): { answers: any[]; talkData: any } | null {
    try {
      const raw = localStorage.getItem('chatbotTemplates');
      if (!raw) return null;
      const templates: Record<string, { answers: any[]; talkData: any }> = JSON.parse(raw);
      return templates[talkId] || null;
    } catch {
      return null;
    }
  }

  saveChatbotTemplate(talkId: string, data: { answers: any[]; talkData: any }): void {
    try {
      const raw = localStorage.getItem('chatbotTemplates');
      const templates: Record<string, { answers: any[]; talkData: any }> = raw ? JSON.parse(raw) : {};
      templates[talkId] = data;
      localStorage.setItem('chatbotTemplates', JSON.stringify(templates));
    } catch (e) {
      console.warn('Failed to save chatbot template:', e);
    }
  }

  /**
   * Sets whether a talk is disabled for broadcast.
   * When disabled (checkbox checked), the talk is excluded from getBroadcastableTalkIds()
   * and will not be sent to anyone when broadcasting.
   */
  setTalkDisabled(talkId: string, disabled: boolean): void {
    const myTalks = this.getMyTalks();
    if (!myTalks[talkId]) return;
    myTalks[talkId].disabled = !!disabled;
    localStorage.setItem('myTalks', JSON.stringify(myTalks));
    // Patch visible rows so checkboxes stay in DOM and keep responding (no full list re-render)
    const talksList = document.getElementById('talks-list');
    const rows = talksList?.querySelectorAll(`.talk-list-item[data-talk-id="${talkId}"]`);
    if (rows && rows.length > 0) {
      rows.forEach((row) => {
        const cb = row.querySelector('.talk-disable-broadcast-checkbox') as HTMLInputElement | null;
        if (cb) cb.checked = !!disabled;
        const badges = row.querySelector('.talk-item-badges');
        const existingBadge = row.querySelector('.talk-badge-disabled');
        if (!!disabled && !existingBadge && badges) {
          const badge = document.createElement('span');
          badge.className = 'talk-badge talk-badge-disabled';
          badge.setAttribute('style', 'background:#fef3c7;color:#92400e;');
          badge.textContent = '🚫 Disabled';
          badges.appendChild(badge);
        } else if (!disabled && existingBadge) {
          existingBadge.remove();
        }
      });
    } else {
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
                  <div class="talk-history-item" data-talk-id="${talkId}" style="background: #f9f9f9; border: 2px solid #e0e0e0; border-radius: 12px; padding: 20px; margin-bottom: 15px; cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                      <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 1.1em; color: #333; margin-bottom: 6px;">
                          ${this.escapeHtml(talk.title)}
                        </div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                          <span style="display: inline-block; padding: 4px 12px; background: ${talk.role === 'created' ? '#dbeafe' : talk.role === 'copied' ? '#e0e7ff' : '#dcfce7'}; color: ${talk.role === 'created' ? '#1e40af' : talk.role === 'copied' ? '#3730a3' : '#166534'}; border-radius: 12px; font-size: 0.8em; font-weight: 600;">
                            ${talk.role === 'created' ? '📝 Created by me' : talk.role === 'copied' ? '📥 Copied' : '✅ Answered by me'}
                          </span>
                          <span style="display: inline-block; padding: 4px 12px; background: #f3f4f6; color: #6b7280; border-radius: 12px; font-size: 0.8em; font-weight: 600;">
                            ${talk.type}
                          </span>
                          ${talk.disabled ? '<span style="display: inline-block; padding: 4px 12px; background: #fef3c7; color: #92400e; border-radius: 12px; font-size: 0.8em; font-weight: 600;">🚫 Disabled</span>' : ''}
                        </div>
                      </div>
                    </div>
                    <div style="font-size: 0.85em; color: #999; margin-bottom: 12px;">
                      Last interaction: ${new Date(talk.lastInteraction).toLocaleString()}
                    </div>
                    <div style="font-size: 0.85em; color: #999;">
                      Talk ID: <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${talkId}</code>
                    </div>
                    <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
                    <button 
                      class="toggle-broadcast-my-talks-btn" 
                      data-talk-id="${talkId}"
                      style="background: ${talk.disabled ? '#22c55e' : '#f59e0b'}; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                    >
                      ${talk.disabled ? '✅ Enable for broadcast' : '🚫 Disable for broadcast'}
                    </button>
                    <button 
                      class="delete-talk-btn" 
                      data-talk-id="${talkId}"
                      style="background: #e53e3e; color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 0.85em; font-weight: 600;"
                    >
                      🗑️ Remove from History
                    </button>
                    </div>
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
        e.stopPropagation();
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
    modal.querySelectorAll('.toggle-broadcast-my-talks-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const talkId = target.dataset.talkId!;
        const myTalks = this.getMyTalks();
        const current = !!myTalks[talkId]?.disabled;
        this.setTalkDisabled(talkId, !current);
        if (document.body.contains(modal)) {
          document.body.removeChild(modal);
        }
        this.showMyTalksDialog();
      });
    });

    // Click on talk card to open (edit for created, response view for answered/copied)
    modal.querySelectorAll('.talk-history-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.delete-talk-btn')) return;
        const talkId = (item as HTMLElement).dataset.talkId;
        if (talkId) {
          if (document.body.contains(modal)) {
            document.body.removeChild(modal);
          }
          this.showTalkDetail(talkId);
        }
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
    if (!(talkId in myTalks)) return;
    delete myTalks[talkId];
    localStorage.setItem('myTalks', JSON.stringify(myTalks));
    const answeredByContent = this.getAnsweredByContent();
    for (const [key, id] of Object.entries(answeredByContent)) {
      if (id === talkId) {
        delete answeredByContent[key];
        this.setAnsweredByContent(answeredByContent);
        break;
      }
    }
    this.displayTalksList();
    this.displayAnswersList();
    this.showNotification('Talk removed from list', 'success');
  }

  showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    const hideAfter =
      message.includes('You have no talks to broadcast') ? 10000 : 3000;
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, hideAfter);
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

  showTalkEditorDialog(existingTalk?: any): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talk-editor-modal';
    if (existingTalk?.id) {
      (modal as HTMLElement).dataset.editingTalkId = existingTalk.id;
    }

    const renderForm = () => {
      const isEdit = !!(existingTalk && existingTalk.id);
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h2 class="modal-title">${isEdit ? 'Edit Talk' : 'Create a Talk'}</h2>
            <p class="talk-editor-description">Build a branching conversation flow - each answer can lead to a different question</p>
          </div>
          <form id="talk-editor-form" style="padding: 20px;" data-editing-talk-id="${existingTalk?.id || ''}">
            <div class="form-group">
              <label class="form-label">Talk Title</label>
              <input type="text" class="form-input" id="talk-title" placeholder="e.g., Coffee Meetup, Quick Survey" required value="${existingTalk ? this.escapeHtml(existingTalk.title) : ''}">
            </div>

            <div class="form-group" id="tag-like-group" style="display: none;">
              <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="checkbox" id="tag-like-checkbox" checked aria-label="I like this tag">
                <span>I like this tag</span>
              </label>
            </div>
            
            <div class="form-group">
              <label class="form-label">Type</label>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                  <input type="radio" name="talk-type-radio" value="matching" ${existingTalk?.type !== 'tag' && existingTalk?.type !== 'survey' ? 'checked' : ''}>
                  <span>Talk (matching – find compatible people)</span>
                </label>
                <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                  <input type="radio" name="talk-type-radio" value="survey" ${existingTalk?.type === 'survey' ? 'checked' : ''}>
                  <span>Survey (collect responses)</span>
                </label>
                <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                  <input type="radio" name="talk-type-radio" value="tag" ${existingTalk?.type === 'tag' ? 'checked' : ''}>
                  <span>Tag (single keyword, answer with one checkbox: match or ignore)</span>
                </label>
              </div>
              <select class="form-input" id="talk-type" aria-hidden="true" style="position: absolute; left: -9999px;" tabindex="-1">
                <option value="matching">Matching</option>
                <option value="survey">Survey</option>
                <option value="tag">Tag</option>
              </select>
            </div>
            
            <div class="form-group" id="questions-form-group">
              <label class="form-label">Questions & Branching</label>
              <div id="questions-container"></div>
              <button type="button" id="add-question-btn" class="btn" style="margin-top: 10px; background: #667eea; color: white;">+ Add Question</button>
            </div>
            
            <div class="form-group" id="talk-options-group">
              <label class="form-label">Expiration</label>
              <select class="form-input" id="talk-expires" aria-label="Talk expiration">
                <option value="">Forever</option>
                <option value="1y">One year</option>
                <option value="1M">One month</option>
                <option value="1w">One week</option>
                <option value="1d">One day</option>
              </select>
            </div>
            <div class="form-group" id="talk-location-group">
              <label class="form-label">Location</label>
              <select class="form-input" id="talk-location-radius" aria-label="Location radius">
                <option value="">Anywhere</option>
                <option value="10">10 miles</option>
                <option value="100">100 miles</option>
                <option value="1000">1000 miles</option>
              </select>
            </div>
            <div class="form-group" id="talk-send-chatroom-group" style="display: ${isEdit ? 'none' : 'block'};">
              <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="checkbox" id="talk-send-to-chatroom" checked aria-label="Send to Chatroom">
                <span>Send to Chatroom</span>
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" id="cancel-talk-btn" style="background: #ccc; color: #333;">Cancel</button>
              <button type="submit" class="btn" id="talk-submit-btn">${isEdit ? 'Save changes' : 'Create'}</button>
            </div>
          </form>
        </div>
      `;

      const questionsContainer = document.getElementById('questions-container');
      if (questionsContainer) {
        questionsContainer.innerHTML = '';
        if (existingTalk && Array.isArray(existingTalk.questions) && existingTalk.questions.length > 0) {
          existingTalk.questions.forEach((q: any, qIndex: number) => {
            this.addQuestionToForm(qIndex, questionsContainer);
            const questionItem = questionsContainer.querySelector(`[data-question-index="${qIndex}"]`);
            if (questionItem) {
              const textInput = questionItem.querySelector('.question-text') as HTMLInputElement;
              if (textInput) textInput.value = q.text || '';
              const answersContainer = questionItem.querySelector('.answers-container') as HTMLElement;
              if (answersContainer && Array.isArray(q.answers)) {
                answersContainer.innerHTML = '';
                q.answers.forEach((a: any, aIndex: number) => {
                  this.addAnswerToQuestion(answersContainer, aIndex);
                  const answerItem = answersContainer.querySelector(`[data-answer-index="${aIndex}"]`);
                  if (answerItem) {
                    const answerInput = answerItem.querySelector('.answer-text') as HTMLInputElement;
                    if (answerInput) answerInput.value = a.text || '';
                  }
                });
                this.appendIgnoreRow(answersContainer, qIndex);
              }
            }
          });
          this.updateAllAnswerDropdowns();
          // Set "next" dropdown values after options are built
          existingTalk.questions.forEach((q: any, qIndex: number) => {
            const questionItem = questionsContainer!.querySelector(`[data-question-index="${qIndex}"]`);
            if (!questionItem || !Array.isArray(q.answers)) return;
            const answersContainer = questionItem.querySelector('.answers-container');
            if (!answersContainer) return;
            const answerItems = answersContainer.querySelectorAll('.answer-item');
            q.answers.forEach((a: any, aIndex: number) => {
              const answerItem = answerItems[aIndex];
              const nextSelect = answerItem?.querySelector('.answer-next') as HTMLSelectElement;
              if (!nextSelect) return;
              if (a.isIgnore) nextSelect.value = 'ignore';
              else if (a.isMatch) nextSelect.value = 'noticed';
              else if (a.nextQuestionId) nextSelect.value = a.nextQuestionId;
            });
          });
          // Set self-answer radios from saved preferences when editing
          const editingId = existingTalk.id;
          if (editingId) {
            const prefs = this.getAnswerPreferences();
            existingTalk.questions.forEach((q: any, qIndex: number) => {
              const questionId = q.id || `q_${qIndex}`;
              const key = `${editingId}_${questionId}`;
              const pref = prefs[key];
              const questionItem = questionsContainer!.querySelector(`[data-question-index="${qIndex}"]`);
              const radio = questionItem?.querySelector(`input[name="self-answer-q_${qIndex}"][value="${pref?.answerId}"]`) as HTMLInputElement;
              if (radio) {
                radio.checked = true;
              } else {
                const ignoreRadio = questionItem?.querySelector('.self-answer-ignore-row input[value="ignore"]') as HTMLInputElement;
                if (ignoreRadio) ignoreRadio.checked = true;
              }
            });
          }
        } else {
          this.addQuestionToForm(0, questionsContainer);
        }
      }

      // Set expiration and location from existing talk
      const expiresSelect = document.getElementById('talk-expires') as HTMLSelectElement;
      const locationSelect = document.getElementById('talk-location-radius') as HTMLSelectElement;
      if (existingTalk) {
        if (expiresSelect && existingTalk.expiresAt != null) {
          const exp = Number(existingTalk.expiresAt);
          const now = Date.now();
          const oneDay = 24 * 60 * 60 * 1000;
          if (now > exp) {
            expiresSelect.value = ''; // expired -> Forever so user can re-activate
          } else if (exp - now <= oneDay) {
            expiresSelect.value = '1d';
          } else if (exp - now <= 7 * oneDay) {
            expiresSelect.value = '1w';
          } else if (exp - now <= 30 * oneDay) {
            expiresSelect.value = '1M';
          } else if (exp - now <= 365 * oneDay) {
            expiresSelect.value = '1y';
          } else {
            expiresSelect.value = '';
          }
        }
        if (locationSelect && existingTalk.locationRadiusMiles != null) {
          locationSelect.value = String(existingTalk.locationRadiusMiles);
        }
      }
      const talkOptionsGroup = document.getElementById('talk-options-group');
      const talkLocationGroup = document.getElementById('talk-location-group');
      const talkSendChatroomGroup = document.getElementById('talk-send-chatroom-group');
      const tagLikeGroup = document.getElementById('tag-like-group');
      const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
      const talkTypeSelect = document.getElementById('talk-type') as HTMLSelectElement;
      const questionsFormGroup = document.getElementById('questions-form-group');
      const updateFormForType = () => {
        const type = talkTypeSelect?.value || 'matching';
        const titleInput = document.getElementById('talk-title') as HTMLInputElement;
        const desc = document.querySelector('.talk-editor-description');
        if (type === 'tag') {
          if (questionsFormGroup) {
            questionsFormGroup.style.display = 'none';
            questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
              (el as HTMLInputElement).disabled = true;
            });
          }
          if (talkOptionsGroup) talkOptionsGroup.style.display = 'none';
          if (talkLocationGroup) talkLocationGroup.style.display = 'none';
          if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = 'none';
          if (tagLikeGroup) tagLikeGroup.style.display = 'block';
          if (tagLikeCheckbox && !isEdit && tagLikeCheckbox.checked === false) tagLikeCheckbox.checked = true;
          if (titleInput) {
            titleInput.placeholder = 'e.g., Coffee, Tennis, Jobs';
            titleInput.setAttribute('aria-label', 'Tag keyword');
          }
          if (desc) (desc as HTMLElement).textContent = 'Tag: one keyword. Others answer with a checkbox — checked = match, unchecked = ignore.';
        } else {
          if (questionsFormGroup) {
            questionsFormGroup.style.display = 'block';
            questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
              (el as HTMLInputElement).disabled = false;
            });
          }
          if (talkOptionsGroup) talkOptionsGroup.style.display = 'block';
          if (talkLocationGroup) talkLocationGroup.style.display = 'block';
          if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = isEdit ? 'none' : 'block';
          if (tagLikeGroup) tagLikeGroup.style.display = 'none';
          if (titleInput) {
            titleInput.placeholder = 'e.g., Coffee Meetup, Quick Survey';
            titleInput.removeAttribute('aria-label');
          }
          if (desc) (desc as HTMLElement).textContent = 'Build a branching conversation flow - each answer can lead to a different question';
        }
      };
      modal.querySelectorAll('input[name="talk-type-radio"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          const value = (e.target as HTMLInputElement).value;
          if (talkTypeSelect) talkTypeSelect.value = value;
          updateFormForType();
        });
      });
      const checkedRadio = modal.querySelector('input[name="talk-type-radio"]:checked') as HTMLInputElement;
      if (talkTypeSelect && checkedRadio) {
        talkTypeSelect.value = checkedRadio.value;
      }
      if (talkTypeSelect) {
        talkTypeSelect.addEventListener('change', updateFormForType);
        updateFormForType();
      }

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

    const answersContainer = questionDiv.querySelector('.answers-container') as HTMLElement;
    this.addAnswerToQuestion(answersContainer, 0);
    this.addAnswerToQuestion(answersContainer, 1);
    this.appendIgnoreRow(answersContainer, index);

    // Setup event handlers
    const removeBtn = questionDiv.querySelector('.btn-remove-question');
    removeBtn?.addEventListener('click', () => {
      container.removeChild(questionDiv);
      this.renumberQuestions();
      this.updateAllAnswerDropdowns();
    });

    const addAnswerBtn = questionDiv.querySelector('.btn-add-answer');
    addAnswerBtn?.addEventListener('click', () => {
      const answerCount = answersContainer.querySelectorAll('.answer-item').length;
      this.addAnswerToQuestion(answersContainer, answerCount);
      this.updateAllAnswerDropdowns();
    });
  }

  private addAnswerToQuestion(container: HTMLElement, index: number): void {
    const questionItem = container.closest('.question-item');
    const qIdx = questionItem ? parseInt(questionItem.getAttribute('data-question-index') ?? '0', 10) : 0;
    const answerDiv = document.createElement('div');
    answerDiv.className = 'answer-item';
    answerDiv.dataset.answerIndex = index.toString();
    answerDiv.style.cssText = `
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    `;
    const radioName = `self-answer-q_${qIdx}`;
    const radioValue = `a_${qIdx}_${index}`;
    answerDiv.innerHTML = `
      <input type="radio" name="${radioName}" value="${radioValue}" class="self-answer-radio" title="My answer">
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

    const ignoreRow = container.querySelector('.self-answer-ignore-row');
    if (ignoreRow) {
      container.insertBefore(answerDiv, ignoreRow);
    } else {
      container.appendChild(answerDiv);
    }

    const nextSelect = answerDiv.querySelector('.answer-next') as HTMLSelectElement;
    nextSelect?.addEventListener('change', () => {
      const val = nextSelect.value;
      if (val && val !== 'ignore' && (val === 'noticed' || val.startsWith('q_'))) {
        const radio = answerDiv.querySelector(`input[name="${radioName}"]`) as HTMLInputElement;
        if (radio) radio.checked = true;
      }
    });

    const removeBtn = answerDiv.querySelector('.btn-remove-answer');
    removeBtn?.addEventListener('click', () => {
      container.removeChild(answerDiv);
      this.renumberAnswers(container);
      this.updateAllAnswerDropdowns();
      this.renumberSelfAnswerRadios(container);
    });
  }

  private appendIgnoreRow(container: HTMLElement, qIndex: number): void {
    if (container.querySelector('.self-answer-ignore-row')) return;
    const row = document.createElement('div');
    row.className = 'self-answer-ignore-row';
    row.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-top: 6px; margin-bottom: 8px;';
    row.innerHTML = `
      <input type="radio" name="self-answer-q_${qIndex}" value="ignore" class="self-answer-radio" checked title="My answer">
      <span style="font-size: 0.9em; color: #666;">Ignore</span>
    `;
    container.appendChild(row);
  }

  private renumberSelfAnswerRadios(answersContainer: HTMLElement): void {
    const questionItem = answersContainer.closest('.question-item');
    if (!questionItem) return;
    const qIndex = parseInt(questionItem.getAttribute('data-question-index') ?? '0', 10);
    const name = `self-answer-q_${qIndex}`;
    answersContainer.querySelectorAll('.answer-item').forEach((answerItem, aIdx) => {
      const radio = answerItem.querySelector('.self-answer-radio') as HTMLInputElement;
      if (radio) {
        radio.name = name;
        radio.value = `a_${qIndex}_${aIdx}`;
      }
    });
    const ignoreRow = answersContainer.querySelector('.self-answer-ignore-row');
    if (ignoreRow) {
      const ignoreRadio = ignoreRow.querySelector('input[type="radio"]') as HTMLInputElement;
      if (ignoreRadio) ignoreRadio.name = name;
    }
  }

  private renumberQuestions(): void {
    const questions = document.querySelectorAll('.question-item');
    questions.forEach((q, idx) => {
      q.setAttribute('data-question-index', idx.toString());
      const header = q.querySelector('strong');
      if (header) {
        header.textContent = `Question ${idx + 1}`;
      }
      const answersContainer = q.querySelector('.answers-container') as HTMLElement;
      if (answersContainer) {
        this.renumberSelfAnswerRadios(answersContainer);
        const ignoreRow = answersContainer.querySelector('.self-answer-ignore-row input[type="radio"]') as HTMLInputElement;
        if (ignoreRow) ignoreRow.name = `self-answer-q_${idx}`;
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
    const title = (document.getElementById('talk-title') as HTMLInputElement).value.trim();
    const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
      | 'matching'
      | 'survey'
      | 'tag';

    const expiresSelect = document.getElementById('talk-expires') as HTMLSelectElement;
    const locationSelect = document.getElementById('talk-location-radius') as HTMLSelectElement;
    const sendToChatroomCheck = document.getElementById('talk-send-to-chatroom') as HTMLInputElement;
    const expiresVal = expiresSelect?.value || '';
    const oneDay = 24 * 60 * 60 * 1000;
    let expiresAt: number | null = null;
    if (expiresVal === '1d') expiresAt = Date.now() + oneDay;
    else if (expiresVal === '1w') expiresAt = Date.now() + 7 * oneDay;
    else if (expiresVal === '1M') expiresAt = Date.now() + 30 * oneDay;
    else if (expiresVal === '1y') expiresAt = Date.now() + 365 * oneDay;
    const locationRadiusMiles =
      locationSelect?.value === '' || locationSelect?.value == null
        ? null
        : parseInt(locationSelect.value, 10);
    const sendToChatroom = sendToChatroomCheck?.checked !== false;

    let questions: any[];
    const selfAnswers: { questionId: string; answerId: string }[] = [];

    if (type === 'tag') {
      const keyword = title || (document.getElementById('talk-title') as HTMLInputElement).value.trim();
      if (!keyword) {
        this.showNotification('Tag keyword is required', 'error');
        return;
      }
      questions = [
        {
          id: 'q_0',
          text: keyword,
          answers: [
            { id: 'a_0_match', text: 'Match.', isMatch: true, isTerminal: true },
            { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        },
      ];
      const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
      const likesTag = tagLikeCheckbox ? tagLikeCheckbox.checked : true;
      selfAnswers.push({ questionId: 'q_0', answerId: likesTag ? 'a_0_match' : 'a_0_ignore' });
    } else {
      questions = [];
      const questionItems = form.querySelectorAll('.question-item');

      questionItems.forEach((item, qIndex) => {
        const questionId = `q_${qIndex}`;
        const selfRadio = item.querySelector(`input[name="self-answer-${questionId}"]:checked`) as HTMLInputElement;
        if (selfRadio && selfRadio.value !== 'ignore') {
          selfAnswers.push({ questionId, answerId: selfRadio.value });
        }
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
          id: questionId,
          text: questionText,
          answers: answers,
        });
      });
    }

    const editingTalkId = form.dataset.editingTalkId;
    if (editingTalkId) {
      // Update local myTalks so the list shows the new title when re-rendered after save
      const myTalks = this.getMyTalks();
      if (myTalks[editingTalkId]) {
        myTalks[editingTalkId] = {
          ...myTalks[editingTalkId],
          title,
          type,
          expiresAt: expiresAt ?? undefined,
          locationRadiusMiles: locationRadiusMiles ?? undefined,
          lastInteraction: new Date().toISOString(),
        };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
      }
      this.emit('updateTalk', {
        id: editingTalkId,
        title,
        type,
        questions,
        language: 'en',
        tags: [],
        expiresAt,
        locationRadiusMiles,
      });
    } else {
      this.emit('createTalk', {
        title,
        type,
        questions,
        language: 'en',
        tags: [],
        sendToChatroom,
        expiresAt,
        locationRadiusMiles,
        selfAnswers,
      });
    }
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
            (member) => {
              const isMatched = this.matchedUserIds.has(member.userId);
              return `
          <div class="chatroom-member-item" data-user-id="${member.userId}" data-stage-name="${this.escapeHtml(member.stageName)}" ${isMatched ? ' data-matched="true"' : ''}>
            <div class="chatroom-member-avatar">${member.stageName.charAt(0).toUpperCase()}</div>
            <div class="chatroom-member-info">
              <div class="chatroom-member-name">${member.stageName}</div>
              <div class="chatroom-member-status">${isMatched ? 'Matched' : 'Online now'}</div>
            </div>
          </div>
        `;
            },
          )
          .join('');

        // Re-apply matched class for styling
        chatroomMembersList.querySelectorAll('.chatroom-member-item').forEach((el) => {
          if ((el as HTMLElement).dataset.matched === 'true') {
            el.classList.add('member-matched');
          }
        });

        // Add click handlers: show talks from this user or open conversation
        chatroomMembersList.querySelectorAll('.chatroom-member-item').forEach((item) => {
          item.addEventListener('click', (e) => {
            const targetUserId = (e.currentTarget as HTMLElement).getAttribute('data-user-id');
            const stageName = (e.currentTarget as HTMLElement).getAttribute('data-stage-name') || 'User';
            if (targetUserId) {
              this.showTalksFromUserOrConversation(targetUserId, stageName);
            }
          });
        });
      }
    }
  }

  setMemberMatched(userId: string): void {
    this.matchedUserIds.add(userId);
    const list = document.getElementById('chatroom-members-list');
    const item = list?.querySelector(`.chatroom-member-item[data-user-id="${userId}"]`);
    if (item) {
      item.classList.add('member-matched');
      (item as HTMLElement).dataset.matched = 'true';
      const status = item.querySelector('.chatroom-member-status');
      if (status) status.textContent = 'Matched';
    }
  }

  flashMemberForNewTalk(authorId: string): void {
    const list = document.getElementById('chatroom-members-list');
    const item = list?.querySelector(`.chatroom-member-item[data-user-id="${authorId}"]`);
    if (item) {
      item.classList.remove('flash-new-talk');
      void (item as HTMLElement).offsetWidth;
      item.classList.add('flash-new-talk');
      setTimeout(() => item.classList.remove('flash-new-talk'), 1000);
    }
  }

  private showTalksFromUserOrConversation(userId: string, stageName: string): void {
    const myTalks = this.getMyTalks();
    const talksFromUser = Object.entries(myTalks).filter(
      ([, t]: [string, any]) => (t?.role === 'answered' || t?.role === 'copied') && t?.fullTalk?.authorId === userId,
    );
    const conversations = this.getMyConversations();
    const hasConversation = Object.values(conversations).some(
      (c: any) => c.otherUserId === userId,
    );

    if (talksFromUser.length > 0) {
      this.showTalksFromUserModal(userId, stageName, talksFromUser);
    } else if (hasConversation) {
      this.emit('sendTalkToUser', { userId });
    } else {
      this.showNotification(
        'Match with this user through Talks to start a conversation!',
        'info',
      );
    }
  }

  private showTalksFromUserModal(
    _userId: string,
    stageName: string,
    talkEntries: [string, any][],
  ): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'talks-from-user-modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 420px;">
        <div class="modal-header">
          <h2 class="modal-title">Talks from ${this.escapeHtml(stageName)}</h2>
          <button class="close-button" id="close-talks-from-user-modal" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <div style="padding: 16px;">
          ${talkEntries
            .map(
              ([talkId, talk]) => `
            <div class="talk-from-user-item" data-talk-id="${talkId}" style="padding: 12px; margin-bottom: 8px; background: #f5f5f5; border-radius: 8px; cursor: pointer;">
              <div style="font-weight: 600;">${this.escapeHtml(talk.title)}</div>
              <div style="font-size: 0.85em; color: #666;">Click to open & answer</div>
            </div>
          `,
            )
            .join('')}
          <p style="margin-top: 12px; font-size: 0.9em; color: #666;">Or go to the <strong>Talks</strong> tab to see all talks.</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtn = document.getElementById('close-talks-from-user-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (document.body.contains(modal)) document.body.removeChild(modal);
      });
    }
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (document.body.contains(modal)) document.body.removeChild(modal);
      }
    });

    modal.querySelectorAll('.talk-from-user-item').forEach((el) => {
      el.addEventListener('click', () => {
        const talkId = (el as HTMLElement).dataset.talkId;
        if (document.body.contains(modal)) document.body.removeChild(modal);
        if (talkId) this.showTalkDetail(talkId);
      });
    });
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
    respondedByBot?: boolean;
  }): void {
    const conversations = this.getMyConversations();
    const existing = conversations[conversationData.conversationId];
    const isNew = !existing;

    // Gun sync (subscribeToUserConversations) omits respondedByBot — do not wipe a bot badge set by match/chatbot handlers.
    const respondedByBot =
      conversationData.respondedByBot !== undefined
        ? !!conversationData.respondedByBot
        : !!existing?.respondedByBot;

    conversations[conversationData.conversationId] = {
      otherUserId: conversationData.otherUserId,
      otherUserName: conversationData.otherUserName,
      talkId: conversationData.talkId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastMessage: existing?.lastMessage ?? null,
      lastMessageTime: existing?.lastMessageTime ?? null,
      unread: isNew ? true : (existing?.unread ?? false),
      respondedByBot,
    };

    localStorage.setItem('myConversations', JSON.stringify(conversations));

    // Update badge
    this.updateMatchBadge();

    // Only show toast for genuinely new matches (not when re-syncing or opening edit)
    if (isNew) {
      const name = conversationData.otherUserName?.trim() || 'Someone';
      this.showNotification(`🎉 New match with ${name}!`, 'success');
    }
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
