/** @jest-environment jsdom */

import { updateChatroomInfo, type ChatroomInfoDeps } from '../../web/ui/chatroom-info';

function deps(overrides: Partial<ChatroomInfoDeps> = {}): ChatroomInfoDeps {
  return {
    setCurrentChatroom: jest.fn(),
    syncStatusBroadcastButtonVisibility: jest.fn(),
    ...overrides,
  };
}

const originalLog = console.log;

beforeEach(() => {
  document.body.innerHTML = '<div id="chatroom-info"></div>';
  console.log = jest.fn();
});

afterEach(() => {
  console.log = originalLog;
});

describe('updateChatroomInfo', () => {
  it('updates the current chatroom tracking when info.id is present', () => {
    const d = deps();
    updateChatroomInfo({ id: 'global', name: 'Global' }, d);
    expect(d.setCurrentChatroom).toHaveBeenCalledWith('global');
  });

  it('does not update current chatroom tracking when info.id is absent', () => {
    const d = deps();
    updateChatroomInfo({ name: 'Global' }, d);
    expect(d.setCurrentChatroom).not.toHaveBeenCalled();
  });

  it('always syncs the status broadcast button visibility', () => {
    const d = deps();
    updateChatroomInfo({}, d);
    expect(d.syncStatusBroadcastButtonVisibility).toHaveBeenCalledTimes(1);
  });

  it('renders the chatroom title and connected status when id and name are both present', () => {
    updateChatroomInfo({ id: 'global', name: 'Global Room' }, deps());
    const html = document.getElementById('chatroom-info')!.innerHTML;
    expect(html).toContain('Global Room');
    expect(html).toContain('Connected');
  });

  it('logs instead of rendering when id or name is missing', () => {
    updateChatroomInfo({ id: 'global' }, deps());
    expect(document.getElementById('chatroom-info')!.innerHTML).toBe('');
    expect(console.log).toHaveBeenCalledWith('Chatroom updated:', { id: 'global' });
  });

  it('logs instead of rendering when the chatroom-info element is absent', () => {
    document.body.innerHTML = '';
    expect(() => updateChatroomInfo({ id: 'global', name: 'Global' }, deps())).not.toThrow();
    expect(console.log).toHaveBeenCalled();
  });
});
