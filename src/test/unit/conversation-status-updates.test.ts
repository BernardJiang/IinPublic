/** @jest-environment jsdom */

import {
  updateConversationTransportMode,
  setConversationOnlineStatus,
} from '../../web/ui/conversation-status-updates';

const t = (key: string): string => key;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('updateConversationTransportMode', () => {
  function deps(overrides: Partial<Parameters<typeof updateConversationTransportMode>[3]> = {}) {
    return {
      getMyConversations: jest.fn(() => ({ c1: { otherUserId: 'u1' } })),
      getCurrentConversationId: jest.fn(() => undefined as string | undefined),
      t,
      formatTransportMode: (mode: string) => `mode:${mode}`,
      formatTransportFallback: (mode: string, reason?: string | null) => `fallback:${mode}:${reason ?? ''}`,
      ...overrides,
    };
  }

  it('is a no-op when the conversation does not exist', () => {
    const d = deps({ getMyConversations: jest.fn(() => ({})) });
    expect(() => updateConversationTransportMode('missing', 'p2p', undefined, d)).not.toThrow();
  });

  it('persists the transport mode into myConversations storage', () => {
    const conversations = { c1: { otherUserId: 'u1' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    updateConversationTransportMode('c1', 'relay', undefined, d);
    const stored = JSON.parse(localStorage.getItem('myConversations')!);
    expect(stored.c1.transportMode).toBe('relay');
  });

  it('sets transportFallbackReason only when explicitly provided (not undefined)', () => {
    const conversations: any = { c1: { otherUserId: 'u1', transportFallbackReason: 'old' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    updateConversationTransportMode('c1', 'relay', undefined, d);
    expect(conversations.c1.transportFallbackReason).toBe('old');

    updateConversationTransportMode('c1', 'relay', 'webrtc-failed', d);
    expect(conversations.c1.transportFallbackReason).toBe('webrtc-failed');

    updateConversationTransportMode('c1', 'relay', null, d);
    expect(conversations.c1.transportFallbackReason).toBeNull();
  });

  it('patches the visible status line only when this is the currently open conversation', () => {
    document.body.innerHTML = `
      <span id="conversation-transport-status"></span>
      <span id="conversation-fallback-status"></span>
    `;
    const d = deps({ getCurrentConversationId: jest.fn(() => 'c1') });
    updateConversationTransportMode('c1', 'p2p', 'reason-x', d);

    const statusEl = document.getElementById('conversation-transport-status') as HTMLElement;
    expect(statusEl.dataset.transportMode).toBe('p2p');
    expect(statusEl.textContent).toBe('conversationTransport: mode:p2p');
    expect(document.getElementById('conversation-fallback-status')!.textContent).toBe('fallback:p2p:reason-x');
  });

  it('does not touch the status line when a different conversation is open', () => {
    document.body.innerHTML = '<span id="conversation-transport-status"></span>';
    const d = deps({ getCurrentConversationId: jest.fn(() => 'other-conv') });
    updateConversationTransportMode('c1', 'p2p', undefined, d);
    expect(document.getElementById('conversation-transport-status')!.textContent).toBe('');
  });
});

describe('setConversationOnlineStatus', () => {
  function deps(overrides: Partial<Parameters<typeof setConversationOnlineStatus>[1]> = {}) {
    return {
      getMyConversations: jest.fn(() => ({} as Record<string, any>)),
      refreshConversationsListIfActive: jest.fn(),
      setOnlineUserIds: jest.fn(),
      refreshContactsListIfActive: jest.fn(),
      patchPresenceIndicators: jest.fn(),
      ...overrides,
    };
  }

  it('marks matching conversations online and others offline', () => {
    const conversations: any = {
      c1: { otherUserId: 'u1', online: false },
      c2: { otherUserId: 'u2', online: true },
    };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    setConversationOnlineStatus(new Set(['u1']), d);
    expect(conversations.c1.online).toBe(true);
    expect(conversations.c2.online).toBe(false);
  });

  it('persists to storage and refreshes the conversations list only when something changed and Me tab is active', () => {
    document.body.innerHTML = '<button class="nav-btn active" data-view="me"></button>';
    const conversations: any = { c1: { otherUserId: 'u1', online: false } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    setConversationOnlineStatus(new Set(['u1']), d);
    expect(localStorage.getItem('myConversations')).not.toBeNull();
    expect(d.refreshConversationsListIfActive).toHaveBeenCalledTimes(1);
  });

  it('does not refresh or persist when nothing changed', () => {
    const conversations: any = { c1: { otherUserId: 'u1', online: true } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    setConversationOnlineStatus(new Set(['u1']), d);
    expect(localStorage.getItem('myConversations')).toBeNull();
    expect(d.refreshConversationsListIfActive).not.toHaveBeenCalled();
  });

  it('always calls setOnlineUserIds and patchPresenceIndicators', () => {
    const d = deps();
    setConversationOnlineStatus(new Set(['u1']), d);
    expect(d.setOnlineUserIds).toHaveBeenCalledWith(new Set(['u1']));
    expect(d.patchPresenceIndicators).toHaveBeenCalledTimes(1);
  });

  it('refreshes the contacts list only when the Contacts tab is active', () => {
    const d1 = deps();
    setConversationOnlineStatus(new Set(), d1);
    expect(d1.refreshContactsListIfActive).not.toHaveBeenCalled();

    document.body.innerHTML = '<button class="nav-btn active" data-view="contacts"></button>';
    const d2 = deps();
    setConversationOnlineStatus(new Set(), d2);
    expect(d2.refreshContactsListIfActive).toHaveBeenCalledTimes(1);
  });
});
