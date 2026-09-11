/** @jest-environment jsdom */

import { setCurrentChatroomId, type SetCurrentChatroomIdDeps } from '../../web/ui/current-chatroom';

function deps(overrides: Partial<SetCurrentChatroomIdDeps> = {}): SetCurrentChatroomIdDeps {
  return {
    setCurrentChatroom: jest.fn(),
    renderChatroomList: jest.fn(),
    resolveChatroomTitle: (id) => `Title:${id}`,
    t: (key) => key,
    syncReturnHomeButton: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('setCurrentChatroomId', () => {
  it('is a no-op when chatroomId is blank', () => {
    const d = deps();
    setCurrentChatroomId('', d);
    expect(d.setCurrentChatroom).not.toHaveBeenCalled();
    expect(d.renderChatroomList).not.toHaveBeenCalled();
  });

  it('updates the tracked chatroom, re-renders the list, and syncs the return-home button', () => {
    const d = deps();
    setCurrentChatroomId('global', d);
    expect(d.setCurrentChatroom).toHaveBeenCalledWith('global');
    expect(d.renderChatroomList).toHaveBeenCalledTimes(1);
    expect(d.syncReturnHomeButton).toHaveBeenCalledTimes(1);
  });

  it('does not touch the detail panel when it is not visible', () => {
    document.body.innerHTML = `
      <div id="chatroom-detail-container" style="display: none;"></div>
      <div id="current-chatroom-title"></div>`;
    setCurrentChatroomId('global', deps());
    expect(document.getElementById('current-chatroom-title')!.textContent).toBe('');
  });

  it('updates the detail panel title/status/members-loading text when the panel is visible', () => {
    document.body.innerHTML = `
      <div id="chatroom-detail-container" style="display: block;"></div>
      <div id="current-chatroom-title"></div>
      <div id="current-chatroom-status"></div>
      <div id="chatroom-members-list"></div>`;
    setCurrentChatroomId('global', deps());
    expect(document.getElementById('current-chatroom-title')!.textContent).toBe('Title:global');
    expect(document.getElementById('current-chatroom-status')!.textContent).toBe('chatroomLoadingMembers');
    expect(document.getElementById('chatroom-members-list')!.innerHTML).toContain('chatroomLoadingOnlineUsers');
  });

  it('does not throw when the detail panel is visible but its inner elements are missing', () => {
    document.body.innerHTML = '<div id="chatroom-detail-container" style="display: block;"></div>';
    expect(() => setCurrentChatroomId('global', deps())).not.toThrow();
  });
});
