/** @jest-environment jsdom */

import {
  bindAppShellControls,
  type AppShellControlsDeps,
} from '../../web/ui/app-shell-controls';
import { uiText } from '../../web/ui/ui-translations';

function deps(overrides: Partial<AppShellControlsDeps> = {}): AppShellControlsDeps {
  const noop = jest.fn();
  return {
    t: (key) => uiText('en', key),
    emit: jest.fn(),
    showDmInboxPicker: noop,
    allowOutgoingMessage: () => true,
    showTalkEditorDialog: noop,
    showPreferencesDialog: noop,
    showChatroomList: noop,
    handleCreateCustomChatroomClick: jest.fn().mockResolvedValue(undefined),
    showContactsList: noop,
    resetSettingsSection: noop,
    handleBroadcastTalkFromCurrentRoom: noop,
    restoreTalksTabState: noop,
    setTalksShowIncoming: noop,
    setTalksShowOutgoing: noop,
    setTalkTypeEnabled: noop,
    setTalksOutSortMode: noop,
    setTalksQuery: noop,
    setTalksCompletionFilter: noop,
    setTalksOutcomeFilter: noop,
    setTalksDateFrom: noop,
    setTalksDateTo: noop,
    persistTalksTabState: noop,
    displayTalksList: noop,
    resetCreatorReplyVisibleCount: noop,
    clearCreatorReplyScope: noop,
    renderCreatorRepliesIfVisible: noop,
    getChatroomsDetailRoomId: () => null,
    showChatroomDetail: noop,
    dismissMatchNotifications: noop,
    refreshCreatorReplies: jest.fn().mockResolvedValue(undefined),
    getCurrentUser: () => undefined,
    showMainInterface: noop,
    displayAnswersList: noop,
    renderSettingsView: noop,
    syncHeaderStatusView: noop,
    syncAppBarActionsForView: noop,
    ...overrides,
  };
}

beforeEach(() => {
  document.documentElement.replaceChild(document.createElement('body'), document.body);
  document.body.innerHTML = `
    <header><span id="header-title">Old</span><div id="header-actions"></div></header>
    <button id="send-button"></button><textarea id="message-input"></textarea>
    <button id="create-talk-btn"></button><button id="view-preferences-btn"></button>
    <button id="dm-inbox-btn"></button><button id="back-to-chatrooms"></button>
    <button id="return-home-btn"></button><button id="settings-refresh-location-btn"></button>
    <button id="back-to-contacts-list"></button><button id="back-to-settings-menu"></button>
    <button id="broadcast-talk-btn"></button>
    <input id="talks-filter-incoming" type="checkbox" checked>
    <input id="talks-filter-outgoing" type="checkbox" checked>
    <input class="talks-type-checkbox" value="tag" type="checkbox" checked>
    <input id="talks-filter-query"><input id="talks-filter-date-from"><input id="talks-filter-date-to">
    <select id="talks-out-sort-order"><option value="recent">recent</option></select>
    <select id="talks-filter-completion"><option value="all">all</option></select>
    <select id="talks-filter-outcome"><option value="all">all</option></select>
    <button class="nav-btn active" data-view="chatrooms"></button>
    <button class="nav-btn" data-view="talks"></button>
    <button class="nav-btn" data-view="settings"></button>
    <section id="chatrooms-view" class="view-panel active"></section>
    <section id="talks-view" class="view-panel"></section>
    <section id="settings-view" class="view-panel"></section>`;
});

describe('bindAppShellControls', () => {
  it('sends trimmed messages and preserves blocked composer text', () => {
    const emit = jest.fn();
    const allowOutgoingMessage = jest.fn((message: string) => message !== 'blocked');
    bindAppShellControls(deps({ emit, allowOutgoingMessage }));
    const input = document.getElementById('message-input') as HTMLTextAreaElement;

    input.value = '  hello  ';
    document.getElementById('send-button')?.click();
    expect(emit).toHaveBeenCalledWith('sendMessage', {
      conversationId: 'default',
      message: 'hello',
    });
    expect(input.value).toBe('');

    input.value = 'blocked';
    document.getElementById('send-button')?.click();
    expect(input.value).toBe('blocked');
  });

  it('persists and rerenders talk filters after state changes', () => {
    const setTalksShowIncoming = jest.fn();
    const setTalkTypeEnabled = jest.fn();
    const persistTalksTabState = jest.fn();
    const displayTalksList = jest.fn();
    bindAppShellControls(deps({
      setTalksShowIncoming,
      setTalkTypeEnabled,
      persistTalksTabState,
      displayTalksList,
    }));

    const incoming = document.getElementById('talks-filter-incoming') as HTMLInputElement;
    incoming.checked = false;
    incoming.dispatchEvent(new Event('change'));
    const tag = document.querySelector('.talks-type-checkbox') as HTMLInputElement;
    tag.checked = false;
    tag.dispatchEvent(new Event('change'));

    expect(setTalksShowIncoming).toHaveBeenCalledWith(false);
    expect(setTalkTypeEnabled).toHaveBeenCalledWith('tag', false);
    expect(persistTalksTabState).toHaveBeenCalledTimes(2);
    expect(displayTalksList).toHaveBeenCalledTimes(2);
  });

  it('switches panels and runs the active tab lifecycle', () => {
    const emit = jest.fn();
    const displayTalksList = jest.fn();
    const refreshCreatorReplies = jest.fn().mockResolvedValue(undefined);
    const syncHeaderStatusView = jest.fn();
    const syncAppBarActionsForView = jest.fn();
    bindAppShellControls(deps({
      emit,
      displayTalksList,
      refreshCreatorReplies,
      syncHeaderStatusView,
      syncAppBarActionsForView,
    }));

    (document.querySelector('.nav-btn[data-view="talks"]') as HTMLButtonElement).click();

    expect(document.getElementById('talks-view')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('chatrooms-view')?.classList.contains('active')).toBe(false);
    expect(emit).toHaveBeenCalledWith('needIncomingTalkClusters');
    expect(displayTalksList).toHaveBeenCalledTimes(1);
    expect(refreshCreatorReplies).toHaveBeenCalledTimes(1);
    expect(syncHeaderStatusView).toHaveBeenCalledWith('talks');
    expect(syncAppBarActionsForView).toHaveBeenCalledWith('talks');
  });
});
