/** @jest-environment jsdom */

import {
  bindAppShellControls,
  showSettingsPanelIfReady,
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
    <section id="settings-view" class="view-panel"><div id="settings-content"></div></section>`;
});

describe('bindAppShellControls', () => {
  it('opens the message inbox without requiring a selected person', () => {
    const showDmInboxPicker = jest.fn();
    bindAppShellControls(deps({ showDmInboxPicker }));

    document.getElementById('dm-inbox-btn')?.click();
    expect(showDmInboxPicker).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft during a slow send and restores it on failure', () => {
    const emit = jest.fn();
    const allowOutgoingMessage = jest.fn((message: string) => message !== 'blocked');
    bindAppShellControls(deps({ emit, allowOutgoingMessage }));
    const input = document.getElementById('message-input') as HTMLTextAreaElement;

    input.value = '  hello  ';
    document.getElementById('send-button')?.click();
    expect(emit).toHaveBeenCalledWith('sendMessage', expect.objectContaining({
      conversationId: 'default',
      message: 'hello',
    }));
    expect(input.value).toBe('  hello  ');
    const button = document.getElementById('send-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const first = emit.mock.calls[0][1] as { onError: () => void };
    first.onError();
    expect(button.disabled).toBe(false);
    expect(input.value).toBe('  hello  ');

    button.click();
    const second = emit.mock.calls[1][1] as { onPersisted: () => void };
    second.onPersisted();
    expect(button.disabled).toBe(false);
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
    jest.useFakeTimers();
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
    expect(displayTalksList).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(emit).toHaveBeenCalledWith('needIncomingTalkClusters');
    expect(displayTalksList).toHaveBeenCalledTimes(1);
    expect(refreshCreatorReplies).toHaveBeenCalledTimes(1);
    expect(syncHeaderStatusView).toHaveBeenCalledWith('talks');
    expect(syncAppBarActionsForView).toHaveBeenCalledWith('talks');
    jest.useRealTimers();
  });

  it('shows Chatrooms immediately and cancels work for a tab left before paint', () => {
    jest.useFakeTimers();
    const showChatroomList = jest.fn();
    const renderSettingsView = jest.fn();
    bindAppShellControls(deps({ showChatroomList, renderSettingsView, getCurrentUser: () => ({ id: 'self' } as any) }));
    (document.querySelector('.nav-btn[data-view="settings"]') as HTMLButtonElement).click();
    (document.querySelector('.nav-btn[data-view="chatrooms"]') as HTMLButtonElement).click();
    expect(document.getElementById('chatrooms-view')?.classList.contains('active')).toBe(true);
    expect(showChatroomList).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(showChatroomList).toHaveBeenCalledTimes(1);
    expect(renderSettingsView).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('preserves a graph-opening Chatrooms click when its temporary flag is cleared before render', () => {
    jest.useFakeTimers();
    const showChatroomList = jest.fn();
    bindAppShellControls(deps({ showChatroomList }));
    const button = document.querySelector<HTMLElement>('.nav-btn[data-view="chatrooms"]')!;
    button.dataset.focusOpening = '1';
    button.click();
    delete button.dataset.focusOpening;
    jest.runAllTimers();
    expect(showChatroomList).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('keeps the previous panel until the first Settings content is ready', () => {
    jest.useFakeTimers();
    const renderSettingsView = jest.fn(() => {
      document.getElementById('settings-content')!.textContent = 'Settings controls';
    });
    const user = { id: 'self' } as any;
    bindAppShellControls(deps({ getCurrentUser: () => user, renderSettingsView }));

    (document.querySelector('.nav-btn[data-view="settings"]') as HTMLButtonElement).click();

    expect(document.querySelector('.nav-btn[data-view="settings"]')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('chatrooms-view')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('settings-view')?.classList.contains('active')).toBe(false);
    expect(document.getElementById('settings-content')?.textContent).toBe('');
    expect(renderSettingsView).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(renderSettingsView).toHaveBeenCalledWith(user);
    expect(document.getElementById('settings-view')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('chatrooms-view')?.classList.contains('active')).toBe(false);
    jest.useRealTimers();
  });

  it('shows cached Settings content immediately while its refresh is pending', () => {
    jest.useFakeTimers();
    document.getElementById('settings-content')!.textContent = 'Previous settings';
    const renderSettingsView = jest.fn();
    bindAppShellControls(deps({ getCurrentUser: () => ({ id: 'self' } as any), renderSettingsView }));

    (document.querySelector('.nav-btn[data-view="settings"]') as HTMLButtonElement).click();

    expect(document.getElementById('settings-view')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('settings-content')?.textContent).toBe('Previous settings');
    expect(renderSettingsView).not.toHaveBeenCalled();
    jest.runAllTimers();
    jest.useRealTimers();
  });

  it('reveals Settings when the identity arrives after the first tap', () => {
    jest.useFakeTimers();
    bindAppShellControls(deps());
    (document.querySelector('.nav-btn[data-view="settings"]') as HTMLButtonElement).click();
    jest.runAllTimers();
    expect(document.getElementById('chatrooms-view')?.classList.contains('active')).toBe(true);

    document.getElementById('settings-content')!.textContent = 'Settings controls';
    showSettingsPanelIfReady();
    expect(document.getElementById('settings-view')?.classList.contains('active')).toBe(true);
    jest.useRealTimers();
  });
});
