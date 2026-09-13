/** @jest-environment jsdom */

import { createChatroomShellController, type ChatroomShellControllerDeps } from '../../web/ui/chatroom-shell-controller';
import { renderChatroomList, showChatroomDetail, updateChatroomMembers } from '../../web/ui/chatrooms-view';

jest.mock('../../web/ui/chatrooms-view', () => ({
  renderChatroomList: jest.fn(),
  showChatroomDetail: jest.fn(),
  updateChatroomMembers: jest.fn(),
}));

const renderRooms = renderChatroomList as jest.MockedFunction<typeof renderChatroomList>;
const openRoom = showChatroomDetail as jest.MockedFunction<typeof showChatroomDetail>;
const renderMembers = updateChatroomMembers as jest.MockedFunction<typeof updateChatroomMembers>;

function makeDeps(overrides: Partial<ChatroomShellControllerDeps> = {}): ChatroomShellControllerDeps {
  return {
    getApiBase: () => 'http://api.test',
    getCurrentChatroom: () => 'global',
    getCurrentUserId: () => 'self',
    getCurrentUser: () => undefined,
    getChatroomMemberCounts: () => new Map(),
    getChatroomVisitCounts: () => new Map(),
    getChatroomBrowseMode: () => 'tree',
    getExpandedChatrooms: () => new Set(),
    getMatchedUserIds: () => new Set(),
    getCustomChatrooms: () => [],
    setSessionUser: jest.fn(),
    setCurrentUserId: jest.fn(),
    setChatroomBrowseMode: jest.fn(),
    setCurrentChatroom: jest.fn(),
    setCurrentChatroomMembers: jest.fn(),
    setChatroomsDetailRoomId: jest.fn(),
    applyShellTranslations: jest.fn(),
    renderSettingsView: jest.fn(),
    displayAnswersList: jest.fn(),
    syncReturnHomeButton: jest.fn(),
    syncAppBarOverflow: jest.fn(),
    openPeerDetail: jest.fn(),
    rememberPeerName: jest.fn(),
    showCreateCustomChatroomDialog: jest.fn().mockResolvedValue(null),
    upsertCustomChatroomFromServer: jest.fn(),
    showNotification: jest.fn(),
    emit: jest.fn(),
    isTechSupportOnline: () => false,
    isUserOnline: () => false,
    formatDate: () => 'date',
    t: (key) => String(key),
    tf: (key, values) => `${String(key)}:${values.name || values.reason}`,
    ...overrides,
  };
}

describe('chatroom shell controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('hydrates the main shell, normalizes user settings, and renders an absent startup list', () => {
    document.body.innerHTML = `
      <div id="header-status" style="display:none"></div><div id="header-user-info"></div>
      <div id="chatroom-info"></div><div id="chatroom-list"></div>`;
    const deps = makeDeps();
    const user = { id: 'self', stageName: 'Alice', languages: ['EN'] } as any;

    createChatroomShellController(deps).showMainInterface(user);

    expect(user.languages).toEqual(['en']);
    expect(deps.setSessionUser).toHaveBeenCalledWith(user);
    expect(document.querySelector('[data-testid="user-stage-name"]')?.textContent).toBe('Alice');
    expect(deps.renderSettingsView).toHaveBeenCalledWith(user);
    expect(deps.displayAnswersList).toHaveBeenCalledTimes(1);
    expect(renderRooms).toHaveBeenCalledTimes(1);
  });

  it('preserves the first-painted startup hierarchy instead of rendering it twice', () => {
    document.body.innerHTML = `<div id="chatroom-list"><div class="chatroom-item"></div></div>`;
    const deps = makeDeps();

    createChatroomShellController(deps).showMainInterface({ id: 'self', stageName: 'Alice' } as any);

    expect(renderRooms).not.toHaveBeenCalled();
    expect(deps.syncReturnHomeButton).toHaveBeenCalledTimes(1);
    expect(deps.syncAppBarOverflow).toHaveBeenCalledTimes(1);
  });

  it('resets detail chrome and renders the room list', () => {
    document.body.innerHTML = `
      <div id="chatroom-list-container" style="display:none"></div>
      <div id="chatroom-detail-container"></div><button id="back-to-chatrooms"></button>
      <button id="create-custom-chatroom-btn"></button><div id="chatroom-owner-bar">owner</div>
      <div id="chatroom-metadata">meta</div><div id="header-title">title</div>`;
    const deps = makeDeps();

    createChatroomShellController(deps).showChatroomList();

    expect(deps.setChatroomsDetailRoomId).toHaveBeenCalledWith(null);
    expect((document.getElementById('chatroom-list-container') as HTMLElement).style.display).toBe('flex');
    expect((document.getElementById('chatroom-detail-container') as HTMLElement).style.display).toBe('none');
    expect(renderRooms).toHaveBeenCalledTimes(1);
    expect(deps.syncReturnHomeButton).toHaveBeenCalledTimes(1);
  });

  it('creates a custom room, upserts it, and opens its detail view', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'room-1', name: 'New Room', type: 'custom' }),
    });
    global.fetch = fetchMock as typeof fetch;
    const deps = makeDeps({
      showCreateCustomChatroomDialog: jest.fn().mockResolvedValue({ name: 'New Room', type: 'custom' }),
    });
    const controller = createChatroomShellController(deps);

    await controller.handleCreateCustomChatroomClick();

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/chatrooms', expect.objectContaining({ method: 'POST' }));
    expect(deps.upsertCustomChatroomFromServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'room-1' }));
    expect(openRoom).toHaveBeenCalledWith(expect.any(Object), 'room-1');
    expect(deps.showNotification).toHaveBeenCalledWith('chatroomCreated:New Room', 'success');
  });

  it('updates member names and delegates live member rendering', () => {
    const deps = makeDeps();
    const members = [{ userId: 'peer', stageName: 'Peer Name' }];

    createChatroomShellController(deps).updateChatroomMembers(members, 'self-2');

    expect(deps.setCurrentUserId).toHaveBeenCalledWith('self-2');
    expect(deps.rememberPeerName).toHaveBeenCalledWith('peer', 'Peer Name');
    expect(renderMembers).toHaveBeenCalledWith(expect.any(Object), members, 'self-2');
  });
});
