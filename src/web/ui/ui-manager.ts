import { User } from '../../shared/types';
import { EventEmitter } from 'events';
import { pickLatestTalkIdFromIncomingCluster, isValidTalkId } from '../../shared/incoming-talk-ids';
import { computeTalkIdFromTalkData } from '../../shared/talk-content-id';
import {
  buildAnswerPreferenceLookupKey,
  sessionAnswersToQAPairs,
  type QAPair,
} from '../../shared/flattened-answer-keys';
import { normalizeQuestionKey } from '../../shared/user-utils';
import { TalkValidator, TalkAutofix } from '../../shared/talk-engine';
import { displayAnswersList as renderAnswersList } from './answers-view';
import {
  renderChatroomList as renderChatrooms,
  showChatroomDetail as openChatroomDetail,
  syncStatusBroadcastButtonVisibility as syncChatroomBroadcastVisibility,
  updateChatroomMembers as renderChatroomMembers,
} from './chatrooms-view';
import {
  displayContactsList as renderContactsList,
  showContactDetail as openContactDetail,
  showContactsList as openContactsList,
} from './contacts-view';
import { displayConversationsList as renderConversationsList } from './conversations-view';
import {
  clearAnswerPreferences,
  getAnswerPreferences,
  getAnsweredTalkByContent,
  getFlattenedAnswerPreferences,
  setAnswerPreferences,
  setAnsweredTalkByContent,
  setFlattenedAnswerPreferences,
  setMyQuestionAnswer,
  type AnswerPreferenceMap,
  type MyQuestionAnswerEntry,
} from './answer-preferences-storage';
import {
  clearMyTalks,
  deleteMyTalkEntry,
  getMyTalks,
  patchMyTalk,
  setMyTalks,
  type MyTalkEntry,
} from './my-talks-storage';
import {
  getChatbotEnabled,
  getChatbotTemplate as loadChatbotTemplate,
  getCopyTalkAutoSave,
  saveChatbotTemplate as storeChatbotTemplate,
  setChatbotEnabled,
  setCopyTalkAutoSave,
} from './ui-settings-storage';
import { showMyTalksDialog as openMyTalksDialog } from './my-talks-dialog';
import { showPreferencesDialog as openPreferencesDialog } from './preferences-dialog';
import { showTalkResponseDialog as openTalkResponseDialog } from './talk-response-dialog';
import {
  addAnswerToQuestion as addTalkEditorAnswerToQuestion,
  addQuestionToForm as addTalkEditorQuestionToForm,
  appendIgnoreRow as appendTalkEditorIgnoreRow,
  setupTalkFormHandlers as setupTalkEditorFormHandlers,
  updateAllAnswerDropdowns as updateTalkEditorAnswerDropdowns,
} from './talk-editor-form-helpers';

export class UIManager extends EventEmitter {
  private appContainer?: HTMLElement;
  private currentChatroom: string = 'global';
  private currentChatroomMembers: Array<{ userId: string; stageName: string }> = [];

  /** Other users in the current chatroom detail view (excludes self); used for broadcast + server-side IN registration. */
  getCurrentChatroomMembers(): Array<{ userId: string; stageName: string }> {
    return [...this.currentChatroomMembers];
  }
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

  private getMyTalks(): Record<string, any> {
    return getMyTalks();
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
              <div class="status-bar-actions" id="status-bar-actions" style="display: none;">
                <button type="button" class="btn status-broadcast-btn" id="status-broadcast-talk-btn" title="Send every talk in your OUT list to everyone in this chatroom">
                  📢 Broadcast to everyone in this room
                </button>
                <p class="status-broadcast-hint" id="status-broadcast-hint">Uses talks from <strong>Talks</strong> (your OUT list). Create or copy a talk there first, then broadcast.</p>
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
              <div class="chatroom-actions chatroom-actions-top">
                <button class="btn broadcast-btn" id="broadcast-talk-btn" title="Sends every talk in your Talks → OUT list to all members in this room (same as the bar above)">
                  📢 Broadcast talk to everyone here
                </button>
              </div>
              <div class="chatroom-members-list" id="chatroom-members-list">
                <p style="text-align: center; padding: 20px; color: #999;">Loading members...</p>
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

    const broadcastTalkBtn = document.getElementById('broadcast-talk-btn');
    if (broadcastTalkBtn) {
      broadcastTalkBtn.addEventListener('click', () => this.handleBroadcastTalkFromCurrentRoom(false));
    }
    const statusBroadcastBtn = document.getElementById('status-broadcast-talk-btn');
    if (statusBroadcastBtn) {
      statusBroadcastBtn.addEventListener('click', () => this.handleBroadcastTalkFromCurrentRoom(true));
    }
  }

  /**
   * Send all broadcastable OUT talks to everyone in the current chatroom (Gun announce + server IN registration).
   * @param ensureDetailVisible — if true, open the room detail panel first so the flow matches “tap room → broadcast” (also scrolls the main broadcast button into view).
   */
  private handleBroadcastTalkFromCurrentRoom(ensureDetailVisible: boolean): void {
    if (!this.currentChatroom) {
      this.showNotification('Open a chatroom from the list (tap a room), or wait until you are placed in one.', 'info');
      return;
    }

    const runBroadcast = (): void => {
      const broadcastableCount = this.getBroadcastableTalkIds().length;
      // Union DOM + in-memory list: after opening room detail, Gun debounce can leave one empty while
      // the other is populated; the app also merges Gun `chatrooms/.../users` when this array is short.
      const fromDom = Array.from(
        document.querySelectorAll('#chatroom-members-list .chatroom-member-item[data-user-id]'),
      ).map((el) => {
        const node = el as HTMLElement;
        return {
          userId: node.dataset.userId || '',
          stageName: (node.dataset.stageName || 'User').trim() || 'User',
        };
      });
      const byId = new Map<string, { userId: string; stageName: string }>();
      for (const m of [...this.currentChatroomMembers, ...fromDom]) {
        const id = (m.userId || '').trim();
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, { userId: id, stageName: m.stageName || id });
      }
      const members = Array.from(byId.values());
      this.emit('broadcastTalk', {
        chatroomId: this.currentChatroom,
        members,
      });

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

      if (broadcastableCount === 0) {
        this.showTalkEditorDialog();
        setTimeout(() => {
          this.showNotification('You have no talks to broadcast. Create one first or enable copied talks.', 'info');
        }, 0);
      }
    };

    if (ensureDetailVisible) {
      const detail = document.getElementById('chatroom-detail-container');
      if (detail && detail.style.display === 'none') {
        this.showChatroomDetail(this.currentChatroom);
      }
      // Member list + Gun callbacks can lag ~150–400ms after opening detail; wait so union/DOM isn't empty.
      setTimeout(() => {
        document.getElementById('broadcast-talk-btn')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        runBroadcast();
      }, 750);
    } else {
      runBroadcast();
    }
  }

  private syncStatusBroadcastButtonVisibility(): void {
    syncChatroomBroadcastVisibility(this.currentChatroom);
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
          this.dismissMatchNotifications();
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
      const copyTalkChecked = getCopyTalkAutoSave();
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
            <input type="checkbox" id="chatbot-enabled-checkbox" ${getChatbotEnabled() ? 'checked' : ''}>
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
          setCopyTalkAutoSave(copyTalkCheckbox.checked);
        });
      }
      const chatbotCheckbox = document.getElementById('chatbot-enabled-checkbox') as HTMLInputElement;
      if (chatbotCheckbox) {
        chatbotCheckbox.addEventListener('change', () => {
          setChatbotEnabled(chatbotCheckbox.checked);
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
    openContactsList({
      getMyConversations: this.getMyConversations.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      escapeHtml: this.escapeHtml.bind(this),
      showTalkDetail: this.showTalkDetail.bind(this),
    });
  }

  /** Build list of contacts: users who have at least one match (conversation) with current user. */
  displayContactsList(): void {
    renderContactsList({
      getMyConversations: this.getMyConversations.bind(this),
      getMyTalks: this.getMyTalks.bind(this),
      escapeHtml: this.escapeHtml.bind(this),
      showTalkDetail: this.showTalkDetail.bind(this),
    });
  }

  /** Show list of talks that match the current user and the selected contact. */
  showContactDetail(otherUserId: string, otherUserName: string, matchCount: number): void {
    openContactDetail(
      {
        getMyConversations: this.getMyConversations.bind(this),
        getMyTalks: this.getMyTalks.bind(this),
        escapeHtml: this.escapeHtml.bind(this),
        showTalkDetail: this.showTalkDetail.bind(this),
      },
      otherUserId,
      otherUserName,
      matchCount,
    );
  }

  private renderChatroomList(): void {
    renderChatrooms({
      currentChatroom: this.currentChatroom,
      chatroomMemberCounts: this.chatroomMemberCounts,
      expandedChatrooms: this.expandedChatrooms,
      matchedUserIds: this.matchedUserIds,
      setCurrentChatroom: (chatroomId) => {
        this.currentChatroom = chatroomId;
      },
      setCurrentChatroomMembers: (members) => {
        this.currentChatroomMembers = members;
      },
      escapeHtml: this.escapeHtml.bind(this),
      renderChatroomList: this.renderChatroomList.bind(this),
      showTalksFromUserOrConversation: this.showTalksFromUserOrConversation.bind(this),
      emit: (eventName, payload) => this.emit(eventName, payload),
    });
  }

  showChatroomDetail(chatroomId: string): void {
    openChatroomDetail({
      currentChatroom: this.currentChatroom,
      chatroomMemberCounts: this.chatroomMemberCounts,
      expandedChatrooms: this.expandedChatrooms,
      matchedUserIds: this.matchedUserIds,
      setCurrentChatroom: (nextChatroomId) => {
        this.currentChatroom = nextChatroomId;
      },
      setCurrentChatroomMembers: (members) => {
        this.currentChatroomMembers = members;
      },
      escapeHtml: this.escapeHtml.bind(this),
      renderChatroomList: this.renderChatroomList.bind(this),
      showTalksFromUserOrConversation: this.showTalksFromUserOrConversation.bind(this),
      emit: (eventName, payload) => this.emit(eventName, payload),
    }, chatroomId);
  }

  displayTalksList(): void {
    const talksList = document.getElementById('talks-list');
    if (!talksList) return;

    const myTalks = getMyTalks();

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
          new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime(),
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
            <span class="talk-item-time">${this.formatTimeAgo(new Date(talk.lastInteraction || 0))}</span>
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
                const incomingType = String(cluster?.type || 'flow').toLowerCase();
                return `
        <div class="talk-list-item" data-talk-id="${talkId}" data-identity-key="${this.escapeHtml(identityKey)}" data-role="incoming" data-incoming-type="${this.escapeHtml(incomingType)}" style="${isAnswered ? 'background:#fafafa;' : ''}">
          <div class="talk-item-header">
            <div class="talk-item-title" style="${titleStyle}">${this.escapeHtml(cluster?.title || 'Incoming Talk')}</div>
            <div class="talk-item-badges">
              ${statusBadge}
              <span class="talk-badge talk-badge-type">${this.escapeHtml(cluster?.type || 'flow')}</span>
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
    renderAnswersList({
      getMyTalks: this.getMyTalks.bind(this),
      escapeHtml: this.escapeHtml.bind(this),
      copyAnsweredTalkToTalks: this.copyAnsweredTalkToTalks.bind(this),
      showTalkDetail: this.showTalkDetail.bind(this),
      showPreferencesDialog: this.showPreferencesDialog.bind(this),
      getTalkContentKey: UIManager.getTalkContentKey,
    });
  }

  private copyAnsweredTalkToTalks(talkId: string): void {
    const myTalks = getMyTalks();
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

    const myTalks = getMyTalks();
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
    renderConversationsList({
      getMyConversations: this.getMyConversations.bind(this),
      escapeHtml: this.escapeHtml.bind(this),
      formatTimeAgo: this.formatTimeAgo.bind(this),
      showConversationDetail: this.showConversationDetail.bind(this),
    });
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
    this.syncStatusBroadcastButtonVisibility();

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
    openTalkResponseDialog({
      talk,
      ...(options?.skipAutoAnswer !== undefined ? { skipAutoAnswer: options.skipAutoAnswer } : {}),
      escapeHtml: this.escapeHtml.bind(this),
      showNotification: this.showNotification.bind(this),
      completeTalk: this.completeTalk.bind(this),
      resolveAnswerPreferenceForTalkQuestion: this.resolveAnswerPreferenceForTalkQuestion.bind(this),
      saveAnswerPreference: this.saveAnswerPreference.bind(this),
    });
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

  private completeTalk(talk: any, answers: any[], outcome?: 'match' | 'mismatch'): void {
    console.log('✅ Talk completed:', talk.id, answers, outcome);

    const contentKey = UIManager.getTalkContentKey(talk);
    const answeredByContent = getAnsweredTalkByContent();
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
      setAnsweredTalkByContent(answeredByContent);
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
      talk.type === 'flow'
        ? "Response submitted! We'll notify you of matches."
        : talk.type === 'tag'
          ? "Tag response submitted!"
          : 'Survey response submitted! Thank you.',
      'success',
    );
  }

  /**
   * Prefer context-aware flat key (cross-talk + multi-question path), then legacy `${talkId}_${questionId}`.
   */
  private resolveAnswerPreferenceForTalkQuestion(
    talk: any,
    questionIndex: number,
    previousQAPairs: QAPair[],
    currentQuestion: { id: string; text?: string },
    talkInstanceId: string,
  ): {
    answerId: string;
    answerText: string;
    mode: string;
    questionText?: string;
    allAnswers?: any[];
  } | null {
    const talkContentHash = computeTalkIdFromTalkData(talk);
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      talkContentHash,
      questionIndex,
      previousQAPairs,
      currentQuestion.text || '',
    );
    const flat = getFlattenedAnswerPreferences()[flatKey];
    if (flat) return flat;
    const preferences = getAnswerPreferences();
    const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
    return preferences[legacyKey] || null;
  }

  private saveAnswerPreference(
    talk: any,
    talkInstanceId: string,
    currentQuestion: { id: string; text?: string; answers?: any[] },
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode: 'auto' | 'manual' = 'auto',
  ): void {
    const preferences = getAnswerPreferences();
    const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
    const talkContentHash = computeTalkIdFromTalkData(talk);
    const qIndex = Math.max(
      0,
      talk.questions?.findIndex((q: { id: string }) => q.id === currentQuestion.id) ?? 0,
    );
    const previous = sessionAnswersToQAPairs(talk, fullSessionAnswersIncludingCurrent.slice(0, -1));
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      talkContentHash,
      qIndex,
      previous,
      currentQuestion.text || '',
    );

    const entry = {
      answerId,
      answerText,
      mode,
      talkId: talkInstanceId,
      questionText: currentQuestion.text || '',
      allAnswers: currentQuestion.answers || [],
      timestamp: new Date().toISOString(),
      flatKey,
    };

    preferences[legacyKey] = entry;
    setAnswerPreferences(preferences);

    const flatMap = getFlattenedAnswerPreferences();
    flatMap[flatKey] = entry;
    setFlattenedAnswerPreferences(flatMap);
    console.log('💾 Saved answer (flat + legacy):', flatKey, answerText);
  }

  /** Snapshot for syncing encrypted/auto answers to Gun (Phase 2). */
  getAnswerPreferencesSnapshot(): Record<
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
    return getAnswerPreferences();
  }

  /**
   * Build a full answer list for Gun chatbot reply when the same talk id or content hash
   * has no template but each step has a matching auto preference (any talk with same path).
   */
  tryBuildChatbotAnswersFromFlattened(
    talkData: any,
  ): Array<{ questionId: string; answerId: string; answerText: string; mode?: string }> | null {
    const questions = talkData?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const out: Array<{ questionId: string; answerId: string; answerText: string; mode?: string }> =
      [];
    const pairs: QAPair[] = [];
    const gunId = talkData.id || '';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const pref = this.resolveAnswerPreferenceForTalkQuestion(talkData, i, pairs, q, gunId);
      if (!pref || pref.mode !== 'auto') return null;
      const ans = q.answers?.find((a: { id: string }) => a.id === pref.answerId);
      if (!ans) return null;
      out.push({
        questionId: q.id,
        answerId: pref.answerId,
        answerText: pref.answerText,
        mode: 'auto',
      });
      pairs.push({
        questionText: (q.text || '').trim(),
        answerText: (pref.answerText || '').trim(),
      });
    }
    return out;
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
      const key = normalizeQuestionKey(questionText);
      const isIgnored = a.answerText === 'ignore' || !a.answerText;
      const entry: MyQuestionAnswerEntry = {
        questionText,
        answerId: a.answerId,
        answerText: isIgnored ? '' : (a.answerText || ''),
        isIgnored,
        timestamp,
      };
      if (locationStr != null) entry.location = locationStr;
      setMyQuestionAnswer(key, entry);
    }
    const answersView = document.getElementById('answers-view');
    if (answersView?.classList.contains('active')) {
      this.displayAnswersList();
    }
  }

  showPreferencesDialog(): void {
    openPreferencesDialog({
      getPreferences: () => ({
        ...getAnswerPreferences(),
        ...getFlattenedAnswerPreferences(),
      }),
      escapeHtml: this.escapeHtml.bind(this),
      updateAnswer: (key, answerId, answerText) => {
        if (key.startsWith('flat_')) {
          const prefs = getFlattenedAnswerPreferences();
          if (!prefs[key]) return;
          prefs[key].answerId = answerId;
          prefs[key].answerText = answerText;
          prefs[key].timestamp = new Date().toISOString();
          setFlattenedAnswerPreferences(prefs);
        } else {
          const prefs = getAnswerPreferences();
          if (!prefs[key]) return;
          prefs[key].answerId = answerId;
          prefs[key].answerText = answerText;
          prefs[key].timestamp = new Date().toISOString();
          setAnswerPreferences(prefs);
        }
        this.showNotification('Answer updated', 'success');
      },
      updateMode: (key, isAuto) => {
        const prefs: AnswerPreferenceMap = key.startsWith('flat_')
          ? getFlattenedAnswerPreferences()
          : getAnswerPreferences();
        if (!prefs[key]) return;
        prefs[key].mode = isAuto ? 'auto' : 'manual';
        prefs[key].timestamp = new Date().toISOString();
        if (key.startsWith('flat_')) {
          setFlattenedAnswerPreferences(prefs);
        } else {
          setAnswerPreferences(prefs);
        }
        this.showNotification(`Mode changed to ${isAuto ? 'AUTO' : 'MANUAL'}`, 'success');
      },
      deletePreference: (key) => {
        this.deleteAnswerPreference(key);
        this.showNotification('Answer deleted', 'success');
      },
      clearAll: () => {
        clearAnswerPreferences();
        this.showNotification('All answers cleared', 'success');
      },
      notify: this.showNotification.bind(this),
    });
  }

  private deleteAnswerPreference(key: string): void {
    if (key.startsWith('flat_')) {
      const flat = getFlattenedAnswerPreferences();
      delete flat[key];
      setFlattenedAnswerPreferences(flat);
      return;
    }
    const preferences = getAnswerPreferences();
    delete preferences[key];
    setAnswerPreferences(preferences);
  }

  // ============================================
  // MY TALKS MANAGEMENT
  // ============================================

  private saveMyTalk(talkData: MyTalkEntry): void {
    const myTalks = getMyTalks();
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
    setMyTalks(myTalks);

    // Refresh talks list if currently viewing Talks tab
    const talksView = document.getElementById('talks-view');
    if (talksView && talksView.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  /** Talks that can be included in broadcast: created or copied, not disabled, and not expired */
  getBroadcastableTalkIds(): string[] {
    const myTalks = getMyTalks();
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
   * Full talk from OUT/myTalks when Gun `getTalk` is slow — bulk broadcast must still POST register-receivers.
   */
  getBroadcastTalkPayload(talkId: string): any | null {
    const myTalks = getMyTalks();
    const row = myTalks[talkId];
    const full = row?.fullTalk;
    if (!full) return null;
    // Tag talks have no questions; non-tag talks require at least one question
    if (full.type !== 'tag' && (!Array.isArray(full.questions) || full.questions.length === 0)) return null;
    return full;
  }

  /**
   * Called by app after a talk is created: saves to myTalks and user's answer list (answerPreferences).
   */
  saveCreatedTalk(
    talk: { id: string; title: string; type: string; questions: any[]; expiresAt?: number | null; locationRadiusMiles?: number | null },
    options: { selfAnswers: { questionId: string; answerId: string }[] },
  ): void {
    const myTalks = getMyTalks();
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
    setMyTalks(myTalks);

    // Save self-answers to answer preferences (user's answer list) for chatbot/auto-reply
    const acc: Array<{ questionId: string; answerText?: string }> = [];
    for (const { questionId, answerId } of options.selfAnswers) {
      const q = talk.questions?.find((qu: any) => qu.id === questionId);
      if (!q) continue;
      const a = q.answers?.find((an: any) => an.id === answerId);
      if (!a) continue;
      acc.push({ questionId, answerText: a.text });
      this.saveAnswerPreference(talk, talk.id, q, a.id, a.text || '', acc, 'auto');
    }

    const talksView = document.getElementById('talks-view');
    if (talksView?.classList.contains('active')) {
      this.displayTalksList();
    }
  }

  getChatbotTemplate(talkId: string): { answers: any[]; talkData: any } | null {
    return loadChatbotTemplate(talkId);
  }

  saveChatbotTemplate(talkId: string, data: { answers: any[]; talkData: any }): void {
    storeChatbotTemplate(talkId, data);
  }

  getCopyTalkAutoSave(): boolean {
    return getCopyTalkAutoSave();
  }

  setCopyTalkAutoSave(enabled: boolean): void {
    setCopyTalkAutoSave(enabled);
  }

  getChatbotEnabled(): boolean {
    return getChatbotEnabled();
  }

  setChatbotEnabled(enabled: boolean): void {
    setChatbotEnabled(enabled);
  }

  /**
   * Sets whether a talk is disabled for broadcast.
   * When disabled (checkbox checked), the talk is excluded from getBroadcastableTalkIds()
   * and will not be sent to anyone when broadcasting.
   */
  setTalkDisabled(talkId: string, disabled: boolean): void {
    const myTalks = getMyTalks();
    if (!myTalks[talkId]) return;
    myTalks[talkId].disabled = !!disabled;
    setMyTalks(myTalks);
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

  showMyTalksDialog(): void {
    openMyTalksDialog({
      getMyTalks,
      escapeHtml: this.escapeHtml.bind(this),
      onDeleteTalk: (talkId) => {
        this.deleteMyTalk(talkId);
        this.showNotification('Talk removed from history', 'success');
      },
      onToggleBroadcast: (talkId, disabled) => {
        this.setTalkDisabled(talkId, disabled);
      },
      onOpenTalk: (talkId) => {
        this.showTalkDetail(talkId);
      },
      onClearAll: () => {
        clearMyTalks();
        this.showNotification('All talk history cleared', 'success');
      },
    });
  }

  private deleteMyTalk(talkId: string): void {
    const myTalks = deleteMyTalkEntry(talkId);
    if (!(talkId in myTalks) && Object.keys(myTalks).length === 0) {
      // already absent; continue to clear answered-by-content links if present
    }
    const answeredByContent = getAnsweredTalkByContent();
    for (const [key, id] of Object.entries(answeredByContent)) {
      if (id === talkId) {
        delete answeredByContent[key];
        setAnsweredTalkByContent(answeredByContent);
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

    if (message.startsWith('Match!')) {
      notification.dataset.matchNotification = 'true';
    }
    // All toasts: tap to dismiss (E2E and users need to clear overlays blocking the header).
    notification.style.cursor = 'pointer';
    notification.addEventListener('click', () => {
      if (document.body.contains(notification)) document.body.removeChild(notification);
    });

    document.body.appendChild(notification);

    if (!message.startsWith('Match!')) {
      const hideAfter = message.includes('You have no talks to broadcast') ? 10000 : 3000;
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, hideAfter);
    }
  }

  private dismissMatchNotifications(): void {
    document.querySelectorAll('.notification[data-match-notification="true"]').forEach((el) => {
      if (document.body.contains(el)) document.body.removeChild(el);
    });
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
                  <input type="radio" name="talk-type-radio" value="tag" ${existingTalk?.type === 'tag' || !existingTalk ? 'checked' : ''}>
                  <span>Tag (single keyword; answer with one checkbox — match or ignore)</span>
                </label>
                <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                  <input type="radio" name="talk-type-radio" value="flow" ${existingTalk?.type === 'flow' ? 'checked' : ''}>
                  <span>Flow – sequential questions that find compatible people</span>
                </label>
                <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                  <input type="radio" name="talk-type-radio" value="survey" ${existingTalk?.type === 'survey' ? 'checked' : ''}>
                  <span>Survey – independent questions that collect aggregate counts</span>
                </label>
                <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                  <input type="radio" name="talk-type-radio" value="route" ${existingTalk?.type === 'route' ? 'checked' : ''}>
                  <span>Route – branching DAG of questions (tree editor)</span>
                </label>
              </div>
              <select class="form-input" id="talk-type" aria-hidden="true" style="position: absolute; left: -9999px;" tabindex="-1">
                <option value="tag">Tag</option>
                <option value="flow">Flow</option>
                <option value="survey">Survey</option>
                <option value="route">Route</option>
              </select>
            </div>

            <div class="form-group" id="questions-form-group">
              <label class="form-label" id="questions-form-label">Questions &amp; Branching</label>
              <p class="talk-editor-type-hint" id="talk-editor-type-hint" style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;"></p>
              <div id="questions-container"></div>
              <button type="button" id="add-question-btn" class="btn" style="margin-top: 10px; background: #667eea; color: white;">+ Add Question</button>
            </div>

            <div class="form-group" id="route-form-group" style="display: none;">
              <label class="form-label">Route (DAG editor)</label>
              <p style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;">
                Build a branching tree. Each answer can lead to a follow-up question. On any
                path from the root to a leaf, the same question cannot appear twice — but the
                same question may appear in two different branches (each will have its own
                context hash ID).
              </p>
              <div id="route-editor"></div>
              <div id="talk-validation-errors" class="talk-validation-errors" style="display: none; margin-top: 10px; padding: 10px; border: 1px solid #f44336; background: #fdecea; color: #b71c1c; border-radius: 6px; font-size: 0.9em;"></div>
            </div>

            <div class="form-group" id="talk-validation-group" style="display: none;">
              <div id="talk-autofix-banner" class="talk-autofix-banner" style="display: none; margin-top: 10px; padding: 10px; border: 1px solid #4CAF50; background: #e8f5e9; color: #1b5e20; border-radius: 6px; font-size: 0.9em;"></div>
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
            addTalkEditorQuestionToForm(qIndex, questionsContainer, {
              refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
              processTalkForm: this.processTalkForm.bind(this),
            });
            const questionItem = questionsContainer.querySelector(`[data-question-index="${qIndex}"]`);
            if (questionItem) {
              const textInput = questionItem.querySelector('.question-text') as HTMLInputElement;
              if (textInput) textInput.value = q.text || '';
              const answersContainer = questionItem.querySelector('.answers-container') as HTMLElement;
              if (answersContainer && Array.isArray(q.answers)) {
                answersContainer.innerHTML = '';
                q.answers.forEach((a: any, aIndex: number) => {
                  addTalkEditorAnswerToQuestion(answersContainer, aIndex, {
                    refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
                    processTalkForm: this.processTalkForm.bind(this),
                  });
                  const answerItem = answersContainer.querySelector(`[data-answer-index="${aIndex}"]`);
                  if (answerItem) {
                    const answerInput = answerItem.querySelector('.answer-text') as HTMLInputElement;
                    if (answerInput) answerInput.value = a.text || '';
                  }
                });
                appendTalkEditorIgnoreRow(answersContainer, qIndex);
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
            const prefs = getAnswerPreferences();
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
          addTalkEditorQuestionToForm(0, questionsContainer, {
            refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
            processTalkForm: this.processTalkForm.bind(this),
          });
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
      const routeFormGroup = document.getElementById('route-form-group');
      const questionsTypeHint = document.getElementById('talk-editor-type-hint');
      const questionsFormLabel = document.getElementById('questions-form-label');
      const updateFormForType = () => {
        const type = talkTypeSelect?.value || 'tag';
        const titleInput = document.getElementById('talk-title') as HTMLInputElement;
        const desc = document.querySelector('.talk-editor-description');
        // Reset visibility each render — simpler than nested toggles.
        if (questionsFormGroup) questionsFormGroup.style.display = 'none';
        if (routeFormGroup) routeFormGroup.style.display = 'none';
        if (tagLikeGroup) tagLikeGroup.style.display = 'none';
        if (talkOptionsGroup) talkOptionsGroup.style.display = 'none';
        if (talkLocationGroup) talkLocationGroup.style.display = 'none';
        if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = 'none';
        if (questionsFormGroup) {
          questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
            (el as HTMLInputElement).disabled = true;
          });
        }

        if (type === 'tag') {
          if (tagLikeGroup) tagLikeGroup.style.display = 'block';
          if (tagLikeCheckbox && !isEdit && tagLikeCheckbox.checked === false) tagLikeCheckbox.checked = true;
          if (titleInput) {
            titleInput.placeholder = 'e.g., Coffee, Tennis, Jobs';
            titleInput.setAttribute('aria-label', 'Tag keyword');
          }
          if (desc) (desc as HTMLElement).textContent = 'Tag: one keyword. Others answer with a checkbox — checked = match, unchecked = ignore.';
          return;
        }

        // Non-tag types share the bottom options.
        if (talkOptionsGroup) talkOptionsGroup.style.display = 'block';
        if (talkLocationGroup) talkLocationGroup.style.display = 'block';
        if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = isEdit ? 'none' : 'block';
        if (titleInput) {
          titleInput.placeholder = 'e.g., Coffee Meetup, Quick Survey';
          titleInput.removeAttribute('aria-label');
        }

        if (type === 'route') {
          if (routeFormGroup) routeFormGroup.style.display = 'block';
          if (desc) (desc as HTMLElement).textContent = 'Route: a branching DAG. Each answer can lead to a follow-up question — same question can appear in different branches (different context hash ID).';
          // Lazily render the route tree the first time the user switches to route.
          this.ensureRouteEditorRendered(existingTalk);
          return;
        }

        // flow / survey share the linear "questions" editor.
        if (questionsFormGroup) {
          questionsFormGroup.style.display = 'block';
          questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
            (el as HTMLInputElement).disabled = false;
          });
        }
        if (type === 'survey') {
          if (questionsFormLabel) questionsFormLabel.textContent = 'Questions (independent)';
          if (questionsTypeHint) {
            questionsTypeHint.textContent =
              'Survey: questions are independent — no branching. Every answer has a counter used for aggregate statistics.';
          }
          if (desc) (desc as HTMLElement).textContent = 'Survey: independent Q/A pairs. Counts per answer are tallied for statistics.';
        } else {
          if (questionsFormLabel) questionsFormLabel.textContent = 'Questions (flow)';
          if (questionsTypeHint) {
            questionsTypeHint.textContent =
              'Flow: each question must be unique. The first answer is your "match" or "go to next" decision; any extra answers are treated as ignore.';
          }
          if (desc) (desc as HTMLElement).textContent = 'Flow: a linear chain of unique questions — first answer decides, rest are ignore.';
        }
        this.refreshFlowAnswerConstraints(type);
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

      setupTalkEditorFormHandlers(modal, {
        refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
        processTalkForm: this.processTalkForm.bind(this),
      });
    };

    document.body.appendChild(modal);
    renderForm();
  }

  private updateAllAnswerDropdowns(): void {
    updateTalkEditorAnswerDropdowns({
      refreshFlowAnswerConstraints: this.refreshFlowAnswerConstraints.bind(this),
      processTalkForm: this.processTalkForm.bind(this),
    });
  }

  private processTalkForm(form: HTMLFormElement): boolean {
    const title = (document.getElementById('talk-title') as HTMLInputElement).value.trim();
    const type = (document.getElementById('talk-type') as HTMLSelectElement).value as
      | 'flow'
      | 'survey'
      | 'tag'
      | 'route';

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
        this.showTalkValidationError(['Tag keyword is required']);
        return false;
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
    } else if (type === 'route') {
      questions = this.collectRouteEditorQuestions();
      if (questions.length === 0) {
        this.showTalkValidationError(['Route must have at least one question']);
        return false;
      }
    } else {
      // flow + survey share the linear editor
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

            if (type === 'survey') {
              // Surveys never branch; every answer carries a counter for stats.
              answer.counter = 0;
              answer.isTerminal = true;
              if (nextQuestion === 'ignore') {
                answer.isIgnore = true;
              }
            } else if (nextQuestion === 'ignore') {
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

        const questionObj: any = {
          id: questionId,
          text: questionText,
          answers: answers,
        };
        if (type === 'survey') {
          questionObj.isAggregatable = true;
          questionObj.contextHashId = '';
        }
        questions.push(questionObj);
      });
    }

    // ── Validate (with best-effort autofix) before we emit anything ────────
    // Build a minimal Talk-shaped object for the validator. Fields the
    // validator doesn't care about are filled with placeholders.
    const candidate = {
      id: '',
      title,
      authorId: '',
      type,
      isAdult: false,
      language: 'en',
      tags: [],
      questions,
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
    };
    let fixed: any;
    try {
      const report = TalkAutofix.fix(candidate as any);
      fixed = report.talk;
      if (report.fixes.length > 0) {
        this.showTalkAutofixReport(report.fixes);
      }
      TalkValidator.validateTalk(fixed as any);
    } catch (err) {
      this.showTalkValidationError([(err as Error).message]);
      return false;
    }
    questions = fixed.questions;

    const editingTalkId = form.dataset.editingTalkId;
    if (editingTalkId) {
      // Update local myTalks so the list shows the new title when re-rendered after save
      patchMyTalk(editingTalkId, {
        title,
        type,
        expiresAt: expiresAt ?? undefined,
        locationRadiusMiles: locationRadiusMiles ?? undefined,
        lastInteraction: new Date().toISOString(),
      });
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
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Create-Talk: per-type UI helpers (flow constraint, route DAG editor,
  // validation feedback). Kept on the class so the inner closures in
  // showTalkEditorDialog can reference them via `this`.
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Flow-talk UI hints: only the first answer per question decides (match or
   * link to the next question). Additional answers are normalized to "ignore"
   * by TalkAutofix at submit time, but we keep the <select> elements fully
   * interactive here so the user — and Playwright — can toggle them freely.
   *
   * We do NOT disable the dropdowns or force their value on render. The only
   * visible hint is a tooltip on non-first answers in flow mode. The heavy
   * lifting is done by TalkAutofix + TalkValidator before save.
   */
  private refreshFlowAnswerConstraints(type: string): void {
    const questionItems = document.querySelectorAll('.question-item');
    questionItems.forEach((item) => {
      const answersContainer = item.querySelector('.answers-container');
      if (!answersContainer) return;
      const answerItems = answersContainer.querySelectorAll('.answer-item');
      answerItems.forEach((answerItem, aIdx) => {
        const select = answerItem.querySelector('.answer-next') as HTMLSelectElement | null;
        if (!select) return;
        // Always keep the select enabled so Playwright / keyboard users can
        // interact with every row. Reset any stale lock-state from previous
        // renders.
        select.disabled = false;
        const ignoreOpt = select.querySelector('option[value="ignore"]') as HTMLOptionElement | null;
        if (ignoreOpt) ignoreOpt.disabled = false;
        select.removeAttribute('title');
        if (type === 'flow' && aIdx > 0) {
          select.title = 'Flow talks: only the first answer decides; others are normalized to Ignore when you save.';
        }
      });
    });
  }

  /** In-memory model for the route-type DAG editor. */
  private routeEditorQuestions: Array<{
    id: string;
    text: string;
    parentAnswer: { questionId: string; answerId: string } | null;
    answers: Array<{ id: string; text: string; isMatch?: boolean; isIgnore?: boolean; isTerminal?: boolean }>;
  }> = [];

  /** Builds or re-hydrates the route-editor in-memory state and redraws it. */
  private ensureRouteEditorRendered(existingTalk?: any): void {
    const host = document.getElementById('route-editor');
    if (!host) return;
    if (this.routeEditorQuestions.length === 0) {
      if (existingTalk && existingTalk.type === 'route' && Array.isArray(existingTalk.questions)) {
        // Rehydrate from an existing route talk.
        this.routeEditorQuestions = existingTalk.questions.map((q: any) => ({
          id: q.id,
          text: q.text,
          parentAnswer:
            Array.isArray(q.contextPath) && q.contextPath.length > 0
              ? { ...q.contextPath[q.contextPath.length - 1] }
              : null,
          answers: (q.answers || []).map((a: any) => ({
            id: a.id,
            text: a.text,
            isMatch: !!a.isMatch,
            isIgnore: !!a.isIgnore,
            isTerminal: a.isTerminal !== false,
          })),
        }));
      } else {
        // Seed with a single root question.
        this.routeEditorQuestions = [
          {
            id: 'q_0',
            text: '',
            parentAnswer: null,
            answers: [
              { id: 'a_0_match', text: 'Match.', isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          },
        ];
      }
    }
    this.renderRouteEditor();
  }

  private renderRouteEditor(): void {
    const host = document.getElementById('route-editor');
    if (!host) return;
    // Build children index from parentAnswer refs.
    const childrenOf = new Map<string, string[]>(); // key = parentAnswerId "qid::aid", value = child question ids
    const roots: string[] = [];
    for (const q of this.routeEditorQuestions) {
      if (!q.parentAnswer) {
        roots.push(q.id);
      } else {
        const key = `${q.parentAnswer.questionId}::${q.parentAnswer.answerId}`;
        const arr = childrenOf.get(key) ?? [];
        arr.push(q.id);
        childrenOf.set(key, arr);
      }
    }
    const byId = new Map(this.routeEditorQuestions.map((q) => [q.id, q]));
    const renderNode = (qid: string, depth: number): string => {
      const q = byId.get(qid);
      if (!q) return '';
      const indent = `margin-left:${depth * 20}px;`;
      const answersHtml = q.answers
        .map((a) => {
          const childIds = childrenOf.get(`${q.id}::${a.id}`) ?? [];
          const kind = a.isMatch ? 'match' : a.isIgnore ? 'ignore' : a.isTerminal ? 'terminal' : 'link';
          return `
            <div class="route-answer" data-qid="${q.id}" data-aid="${a.id}" style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
              <span class="route-answer-kind" style="font-size:0.8em; padding:2px 6px; border-radius:10px; background:#eef; color:#334;">${kind}</span>
              <input type="text" class="form-input route-answer-text" value="${this.escapeHtml(a.text)}" placeholder="Answer text (e.g., Yes.)" data-qid="${q.id}" data-aid="${a.id}" style="flex:1;">
              <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:#667eea; color:white; padding:2px 6px;">+ Child Q</button>
              <button type="button" class="btn route-remove-answer-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:#f44336; color:white; padding:2px 6px;">×</button>
            </div>
            ${childIds.map((c) => renderNode(c, depth + 1)).join('')}
          `;
        })
        .join('');
      return `
        <div class="route-node" data-qid="${q.id}" style="border:1px solid #ddd; border-radius:6px; padding:8px; margin:6px 0; ${indent} background:#fafafa;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:#667eea;">Q:</strong>
            <input type="text" class="form-input route-question-text" value="${this.escapeHtml(q.text)}" placeholder="Question (end with ?)" data-qid="${q.id}" style="flex:1;">
            <button type="button" class="btn route-add-answer-btn" data-qid="${q.id}" style="font-size:0.8em; background:#4CAF50; color:white; padding:2px 6px;">+ Answer</button>
            ${q.parentAnswer ? `<button type="button" class="btn route-remove-question-btn" data-qid="${q.id}" style="font-size:0.8em; background:#f44336; color:white; padding:2px 6px;">Remove Q</button>` : ''}
          </div>
          ${answersHtml}
        </div>
      `;
    };
    host.innerHTML = roots.map((r) => renderNode(r, 0)).join('');

    // Bind events (delegation-free for clarity).
    host.querySelectorAll<HTMLInputElement>('.route-question-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (q) q.text = inp.value;
      });
    });
    host.querySelectorAll<HTMLInputElement>('.route-answer-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = byId.get(inp.dataset.qid!);
        if (!q) return;
        const a = q.answers.find((x) => x.id === inp.dataset.aid);
        if (a) a.text = inp.value;
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-add-answer-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = byId.get(btn.dataset.qid!);
        if (!q) return;
        const idx = q.answers.length;
        q.answers.push({
          id: `${q.id}_a${idx}`,
          text: 'New answer.',
          isIgnore: true,
          isTerminal: true,
        });
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-remove-answer-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = byId.get(btn.dataset.qid!);
        if (!q) return;
        q.answers = q.answers.filter((a) => a.id !== btn.dataset.aid);
        // Also cascade-remove any children of this answer.
        const killKey = `${btn.dataset.qid}::${btn.dataset.aid}`;
        this.routeEditorQuestions = this.routeEditorQuestions.filter((qq) => {
          if (!qq.parentAnswer) return true;
          const key = `${qq.parentAnswer.questionId}::${qq.parentAnswer.answerId}`;
          return key !== killKey;
        });
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-add-child-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parentQid = btn.dataset.qid!;
        const parentAid = btn.dataset.aid!;
        const newId = `q_${this.routeEditorQuestions.length}`;
        // Promote the chosen parent answer to a linking answer (not terminal/match/ignore).
        const parentQ = byId.get(parentQid);
        if (parentQ) {
          const parentAnswer = parentQ.answers.find((a) => a.id === parentAid);
          if (parentAnswer) {
            delete parentAnswer.isMatch;
            delete parentAnswer.isIgnore;
            parentAnswer.isTerminal = false;
          }
        }
        this.routeEditorQuestions.push({
          id: newId,
          text: '',
          parentAnswer: { questionId: parentQid, answerId: parentAid },
          answers: [
            { id: `${newId}_match`, text: 'Match.', isMatch: true, isTerminal: true },
            { id: `${newId}_ignore`, text: 'Ignore.', isIgnore: true, isTerminal: true },
          ],
        });
        this.renderRouteEditor();
      });
    });
    host.querySelectorAll<HTMLButtonElement>('.route-remove-question-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.qid!;
        // Remove target and its descendants.
        const keep = new Set<string>();
        const mark = (id: string) => {
          keep.add(id);
          for (const qq of this.routeEditorQuestions) {
            if (qq.parentAnswer && qq.parentAnswer.questionId === id) {
              // Do not keep descendants of target.
            }
          }
        };
        // Build a child map and BFS from target to collect descendants.
        const childMap = new Map<string, string[]>();
        for (const qq of this.routeEditorQuestions) {
          if (qq.parentAnswer) {
            const arr = childMap.get(qq.parentAnswer.questionId) ?? [];
            arr.push(qq.id);
            childMap.set(qq.parentAnswer.questionId, arr);
          }
        }
        const dead = new Set<string>([target]);
        const stack = [target];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const child of childMap.get(cur) ?? []) {
            if (!dead.has(child)) {
              dead.add(child);
              stack.push(child);
            }
          }
        }
        this.routeEditorQuestions = this.routeEditorQuestions.filter((qq) => !dead.has(qq.id));
        void keep; // silence unused
        void mark;
        this.renderRouteEditor();
      });
    });
  }

  /**
   * Converts the route-editor model into the validator-ready Question[] shape.
   * Sets each question's contextPath by walking up its parent chain.
   */
  private collectRouteEditorQuestions(): any[] {
    const byId = new Map(this.routeEditorQuestions.map((q) => [q.id, q]));
    const computeContextPath = (qid: string): Array<{ questionId: string; answerId: string }> => {
      const path: Array<{ questionId: string; answerId: string }> = [];
      let cur = byId.get(qid);
      while (cur && cur.parentAnswer) {
        path.unshift({ questionId: cur.parentAnswer.questionId, answerId: cur.parentAnswer.answerId });
        cur = byId.get(cur.parentAnswer.questionId);
      }
      return path;
    };
    return this.routeEditorQuestions.map((q) => {
      const contextPath = computeContextPath(q.id);
      return {
        id: q.id,
        text: q.text.trim(),
        contextPath,
        answers: q.answers.map((a) => {
          const obj: any = { id: a.id, text: a.text.trim() };
          if (a.isMatch) obj.isMatch = true;
          if (a.isIgnore) obj.isIgnore = true;
          if (a.isTerminal) obj.isTerminal = true;
          return obj;
        }),
      };
    });
  }

  private showTalkValidationError(errors: string[]): void {
    const group = document.getElementById('talk-validation-group');
    if (group) group.style.display = 'block';
    const errBox = document.getElementById('talk-validation-errors');
    if (errBox) {
      errBox.style.display = 'block';
      errBox.innerHTML = '<strong>Cannot save — please fix:</strong><ul style="margin:6px 0 0 16px; padding:0;">' +
        errors.map((e) => `<li>${this.escapeHtml(e)}</li>`).join('') +
        '</ul>';
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private showTalkAutofixReport(fixes: string[]): void {
    const group = document.getElementById('talk-validation-group');
    if (group) group.style.display = 'block';
    const banner = document.getElementById('talk-autofix-banner');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = '<strong>Auto-fixed:</strong><ul style="margin:6px 0 0 16px; padding:0;">' +
        fixes.map((f) => `<li>${this.escapeHtml(f)}</li>`).join('') +
        '</ul>';
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
    console.log(
      `📊 Updating member count for ${this.currentChatroom}: ${members.length} total members`,
    );
    renderChatroomMembers(
      {
        currentChatroom: this.currentChatroom,
        chatroomMemberCounts: this.chatroomMemberCounts,
        expandedChatrooms: this.expandedChatrooms,
        matchedUserIds: this.matchedUserIds,
        setCurrentChatroom: (chatroomId) => {
          this.currentChatroom = chatroomId;
        },
        setCurrentChatroomMembers: (nextMembers) => {
          this.currentChatroomMembers = nextMembers;
        },
        escapeHtml: this.escapeHtml.bind(this),
        renderChatroomList: this.renderChatroomList.bind(this),
        showTalksFromUserOrConversation: this.showTalksFromUserOrConversation.bind(this),
        emit: (eventName, payload) => this.emit(eventName, payload),
      },
      members,
      currentUserId,
    );
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
    const myTalks = getMyTalks();
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
