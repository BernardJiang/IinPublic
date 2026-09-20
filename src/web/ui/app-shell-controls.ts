import { applyMeAnswerFilter } from './answers-view';
import {
  persistCreatorReplyFilterState,
  restoreCreatorReplyFilterState,
} from './creator-replies-view';
import type { User } from '../../shared/types';
import type { UiTranslationKey } from './ui-translations';

const chatroomActionDelegationDocuments = new WeakSet<Document>();

export interface AppShellControlsDeps {
  t: (key: UiTranslationKey) => string;
  emit: (event: string, payload?: unknown) => void;
  showDmInboxPicker: () => void;
  allowOutgoingMessage: (message: string) => boolean;
  showTalkEditorDialog: () => void;
  showPreferencesDialog: () => void;
  showChatroomList: () => void;
  handleCreateCustomChatroomClick: () => Promise<void>;
  showContactsList: () => void;
  resetSettingsSection: () => void;
  handleBroadcastTalkFromCurrentRoom: (automatic: boolean) => void;
  restoreTalksTabState: () => void;
  setTalksShowIncoming: (value: boolean) => void;
  setTalksShowOutgoing: (value: boolean) => void;
  setTalkTypeEnabled: (type: string, enabled: boolean) => void;
  setTalksOutSortMode: (value: string) => void;
  setTalksQuery: (value: string) => void;
  setTalksCompletionFilter: (value: string) => void;
  setTalksOutcomeFilter: (value: string) => void;
  setTalksDateFrom: (value: string) => void;
  setTalksDateTo: (value: string) => void;
  persistTalksTabState: () => void;
  displayTalksList: () => void;
  resetCreatorReplyVisibleCount: () => void;
  clearCreatorReplyScope: () => void;
  renderCreatorRepliesIfVisible: () => void;
  getChatroomsDetailRoomId: () => string | null;
  showChatroomDetail: (chatroomId: string) => void;
  dismissMatchNotifications: () => void;
  refreshCreatorReplies: () => Promise<void>;
  getCurrentUser: () => User | undefined;
  showMainInterface: (user: User) => void;
  displayAnswersList: () => void;
  renderSettingsView: (user: User) => void;
  syncHeaderStatusView: (viewName: string) => void;
  syncAppBarActionsForView: (viewName: string) => void;
}

function applyAnswerFilter(deps: AppShellControlsDeps): void {
  applyMeAnswerFilter(deps.t);
}

function bindAnswerFilters(deps: AppShellControlsDeps): void {
  document.querySelectorAll('.me-talk-type-checkbox, .me-tag-state-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', () => applyAnswerFilter(deps));
  });
  ['me-outcome-filter', 'me-answer-sort', 'me-answer-date-from', 'me-answer-date-to'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => applyAnswerFilter(deps));
  });
  document.getElementById('me-answer-filter')?.addEventListener('input', () => applyAnswerFilter(deps));
  document.getElementById('me-clear-filters')?.addEventListener('click', () => {
    document.querySelectorAll<HTMLInputElement>('.me-talk-type-checkbox, .me-tag-state-checkbox')
      .forEach((checkbox) => { checkbox.checked = true; });
    const defaults: Record<string, string> = {
      'me-outcome-filter': 'all',
      'me-answer-sort': 'answered-desc',
      'me-answer-filter': '',
      'me-answer-date-from': '',
      'me-answer-date-to': '',
      'answers-search-input': '',
    };
    for (const [id, value] of Object.entries(defaults)) {
      const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (input) input.value = value;
    }
    applyAnswerFilter(deps);
  });
}

function bindBroadcastButton(deps: AppShellControlsDeps): void {
  const button = document.getElementById('broadcast-talk-btn');
  if (!button) return;
  const longPressMs = 500;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;
  const clearLongPressTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  button.addEventListener('pointerdown', () => {
    longPressFired = false;
    clearLongPressTimer();
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      deps.handleBroadcastTalkFromCurrentRoom(false);
    }, longPressMs);
  });
  button.addEventListener('pointerup', clearLongPressTimer);
  button.addEventListener('pointerleave', clearLongPressTimer);
  button.addEventListener('pointercancel', clearLongPressTimer);
  button.addEventListener('click', () => {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    deps.handleBroadcastTalkFromCurrentRoom(true);
  });
}

function bindTalkFilters(deps: AppShellControlsDeps): void {
  deps.restoreTalksTabState();
  const bind = (
    id: string,
    eventName: 'change' | 'input',
    update: (target: HTMLInputElement | HTMLSelectElement) => void,
  ) => {
    document.getElementById(id)?.addEventListener(eventName, (event) => {
      update(event.currentTarget as HTMLInputElement | HTMLSelectElement);
      deps.persistTalksTabState();
      deps.displayTalksList();
    });
  };
  bind('talks-filter-incoming', 'change', (target) => {
    deps.setTalksShowIncoming((target as HTMLInputElement).checked);
  });
  bind('talks-filter-outgoing', 'change', (target) => {
    deps.setTalksShowOutgoing((target as HTMLInputElement).checked);
  });
  document.querySelectorAll<HTMLInputElement>('.talks-type-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      deps.setTalkTypeEnabled(checkbox.value, checkbox.checked);
      deps.persistTalksTabState();
      deps.displayTalksList();
    });
  });
  bind('talks-out-sort-order', 'change', (target) => deps.setTalksOutSortMode(target.value));
  bind('talks-filter-query', 'input', (target) => deps.setTalksQuery(target.value));
  bind('talks-filter-completion', 'change', (target) => deps.setTalksCompletionFilter(target.value));
  bind('talks-filter-outcome', 'change', (target) => deps.setTalksOutcomeFilter(target.value));
  bind('talks-filter-date-from', 'change', (target) => deps.setTalksDateFrom(target.value));
  bind('talks-filter-date-to', 'change', (target) => deps.setTalksDateTo(target.value));
}

function bindCreatorReplyFilters(deps: AppShellControlsDeps): void {
  restoreCreatorReplyFilterState();
  const filterIds = [
    'reply-filter-query',
    'reply-filter-outcome',
    'reply-filter-relationship',
    'reply-filter-type',
    'reply-filter-language',
    'reply-filter-from',
    'reply-filter-to',
    'reply-sort-order',
    'reply-group-order',
  ];
  filterIds.forEach((id) => {
    document.getElementById(id)?.addEventListener(
      id === 'reply-filter-query' ? 'input' : 'change',
      () => {
        deps.resetCreatorReplyVisibleCount();
        persistCreatorReplyFilterState();
        deps.renderCreatorRepliesIfVisible();
      },
    );
  });
  document.getElementById('reply-clear-filters')?.addEventListener('click', () => {
    ['reply-filter-query', 'reply-filter-from', 'reply-filter-to'].forEach((id) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.value = '';
    });
    [
      'reply-filter-outcome',
      'reply-filter-relationship',
      'reply-filter-type',
      'reply-filter-language',
      'reply-sort-order',
      'reply-group-order',
    ].forEach((id) => {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      if (select) {
        select.value = id === 'reply-sort-order'
          ? 'recent'
          : id === 'reply-group-order'
            ? 'none'
            : 'all';
      }
    });
    deps.resetCreatorReplyVisibleCount();
    deps.clearCreatorReplyScope();
    persistCreatorReplyFilterState();
    deps.renderCreatorRepliesIfVisible();
  });
}

function bindPrimaryControls(deps: AppShellControlsDeps): void {
  document.getElementById('dm-inbox-btn')?.addEventListener('click', deps.showDmInboxPicker);
  const sendButton = document.getElementById('send-button');
  const messageInput = document.getElementById('message-input') as HTMLTextAreaElement | null;
  if (sendButton && messageInput) {
    sendButton.addEventListener('click', () => {
      const message = messageInput.value.trim();
      if (!message || !deps.allowOutgoingMessage(message)) return;
      deps.emit('sendMessage', { conversationId: 'default', message });
      messageInput.value = '';
    });
    messageInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
      }
    });
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
    });
  }
  document.getElementById('create-talk-btn')?.addEventListener('click', deps.showTalkEditorDialog);
  document.getElementById('view-preferences-btn')?.addEventListener('click', deps.showPreferencesDialog);
  document.getElementById('back-to-chatrooms')?.addEventListener('click', deps.showChatroomList);
  if (!chatroomActionDelegationDocuments.has(document)) {
    chatroomActionDelegationDocuments.add(document);
    document.body.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('#create-custom-chatroom-btn')) {
        event.preventDefault();
        void deps.handleCreateCustomChatroomClick();
      }
    });
  }
  document.getElementById('return-home-btn')?.addEventListener('click', () => {
    deps.emit('returnHomeFromTravel', {});
  });
  document.getElementById('settings-refresh-location-btn')?.addEventListener('click', () => {
    deps.emit('requestLocationUpdate', {});
  });
  document.getElementById('back-to-contacts-list')?.addEventListener('click', deps.showContactsList);
  document.getElementById('back-to-settings-menu')?.addEventListener('click', deps.resetSettingsSection);
}

/** Bottom-nav tab remembered across app restarts (restored by UIManager.restoreLastTab). */
export const LAST_TAB_KEY = 'iinpublic_last_tab';

/** Re-opens the bottom-nav tab the user was on when the app last closed (chatrooms is the default). */
export function restoreLastTab(): void {
  try {
    const tab = localStorage.getItem(LAST_TAB_KEY);
    if (!tab || tab === 'chatrooms') return;
    document.querySelector<HTMLElement>(`.nav-btn[data-view="${tab}"]`)?.click();
  } catch {
    /* optional */
  }
}

function bindBottomNavigation(deps: AppShellControlsDeps): void {
  const navButtons = document.querySelectorAll('.nav-btn');
  const viewPanels = document.querySelectorAll('.view-panel');
  const headerTitle = document.getElementById('header-title');
  const headerActions = document.getElementById('header-actions');

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetView = (button as HTMLElement).dataset.view;
      if (!targetView) return;
      document.getElementById('broadcast-preamble-modal')?.remove();
      try { localStorage.setItem(LAST_TAB_KEY, targetView); } catch { /* optional */ }
      navButtons.forEach((candidate) => candidate.classList.remove('active'));
      button.classList.add('active');
      viewPanels.forEach((panel) => panel.classList.remove('active'));
      document.getElementById(`${targetView}-view`)?.classList.add('active');
      if (headerTitle) headerTitle.textContent = '';
      deps.syncHeaderStatusView(targetView);
      if (headerActions) headerActions.style.display = 'flex';
      deps.syncAppBarActionsForView(targetView);

      if (targetView === 'chatrooms') {
        const detailRoomId = deps.getChatroomsDetailRoomId();
        if (detailRoomId) deps.showChatroomDetail(detailRoomId);
        else deps.showChatroomList();
      }
      if (targetView === 'contacts') {
        deps.dismissMatchNotifications();
        deps.showContactsList();
      }
      if (targetView === 'talks') {
        deps.emit('needIncomingTalkClusters');
        deps.displayTalksList();
        void deps.refreshCreatorReplies();
      }
      if (targetView === 'me') {
        const user = deps.getCurrentUser();
        if (user) deps.showMainInterface(user);
        deps.emit('needConversationSync');
        deps.displayAnswersList();
      }
      if (targetView === 'settings') {
        const user = deps.getCurrentUser();
        if (user) deps.renderSettingsView(user);
      }
    });
  });
}

export function bindAppShellControls(deps: AppShellControlsDeps): void {
  bindPrimaryControls(deps);
  bindAnswerFilters(deps);
  bindBroadcastButton(deps);
  bindTalkFilters(deps);
  bindCreatorReplyFilters(deps);
  bindBottomNavigation(deps);
}
