/** @jest-environment jsdom */

import { showConversationDetail, type ConversationDetailViewDeps } from '../../web/ui/conversation-detail-view';
import {
  addNewConversation,
  syncConversationMessageSummary,
  updateConversationMessage,
  type ConversationListUpdatesDeps,
} from '../../web/ui/conversation-list-updates';
import { uiText } from '../../web/ui/ui-translations';

function listDeps(
  conversations: Record<string, any>,
  overrides: Partial<ConversationListUpdatesDeps> = {},
): ConversationListUpdatesDeps {
  return {
    getMyConversations: () => conversations,
    getPeerName: (_userId, fallback) => fallback || 'Unknown',
    updateMatchBadge: jest.fn(),
    syncStatusBarMatchCount: jest.fn(),
    emit: jest.fn(),
    getTotalMatches: () => Object.keys(conversations).length,
    t: (key) => uiText('en', key),
    tf: (key, values) => `${uiText('en', key)} ${Object.values(values).join(' ')}`,
    isSupportNotificationsMuted: () => false,
    showNotification: jest.fn(),
    displayContactsList: jest.fn(),
    displayConversationsList: jest.fn(),
    getCurrentConversationId: () => undefined,
    getCurrentThreadTalkId: () => undefined,
    refreshOpenPeerThreadList: jest.fn(),
    lastNotifiedMessageIdByConversation: new Map(),
    ...overrides,
  };
}

describe('conversation view and list update extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('leaves the detail view untouched when the conversation is unknown', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = { getMyConversations: () => ({}) } as unknown as ConversationDetailViewDeps;

    showConversationDetail('missing', undefined, deps);

    expect(warning).toHaveBeenCalledWith('showConversationDetail: conversation not found', 'missing');
    warning.mockRestore();
  });

  it('adds a conversation while preserving sticky match metadata', () => {
    const conversations: Record<string, any> = {
      c1: {
        conversationId: 'c1',
        otherUserId: 'peer',
        otherUserName: 'Old name',
        respondedByBot: true,
        dealEligible: true,
        relatedTalkIds: ['talk-old'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const deps = listDeps(conversations);

    addNewConversation({
      conversationId: 'c1',
      otherUserId: 'peer',
      otherUserName: 'Fresh name',
      talkId: 'talk-new',
    }, deps);

    expect(conversations.c1).toEqual(expect.objectContaining({
      otherUserName: 'Fresh name',
      respondedByBot: true,
      dealEligible: true,
      relatedTalkIds: ['talk-old', 'talk-new'],
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    expect(deps.emit).toHaveBeenCalledWith('conversationAdded', expect.objectContaining({ isNew: false }));
    expect(deps.showNotification).not.toHaveBeenCalled();
  });

  it('marks a new message unread only when its conversation is closed', () => {
    const conversations = {
      c1: { conversationId: 'c1', supportChannel: false, unread: false },
    };
    const deps = listDeps(conversations, { getCurrentConversationId: () => 'other' });

    updateConversationMessage('c1', 'hello', '2026-09-12T01:00:00.000Z', deps);

    expect(conversations.c1).toEqual(expect.objectContaining({
      lastMessage: 'hello',
      lastMessageTime: '2026-09-12T01:00:00.000Z',
      unread: true,
    }));
    expect(deps.updateMatchBadge).toHaveBeenCalledTimes(1);
    expect(deps.syncStatusBarMatchCount).toHaveBeenCalledTimes(1);
  });

  it('keeps direct and per-talk read cursors isolated', () => {
    const conversations: Record<string, any> = {
      c1: { conversationId: 'c1', otherUserId: 'peer', otherUserName: 'Peer' },
    };
    const deps = listDeps(conversations, {
      getCurrentConversationId: () => 'c1',
      getCurrentThreadTalkId: () => 'talk-a',
    });

    syncConversationMessageSummary('c1', [
      { id: 'dm', senderId: 'peer', text: 'direct', timestamp: '2026-09-12T01:00:00.000Z' },
      { id: 'a', senderId: 'peer', text: 'thread A', talkId: 'talk-a', timestamp: '2026-09-12T01:01:00.000Z' },
      { id: 'b', senderId: 'peer', text: 'thread B', talkId: 'talk-b', timestamp: '2026-09-12T01:02:00.000Z' },
    ], 'me', deps);

    expect(conversations.c1.threadSummaries).toEqual(expect.objectContaining({
      direct: expect.objectContaining({ unreadCount: 1 }),
      'talk-a': expect.objectContaining({ unreadCount: 0 }),
      'talk-b': expect.objectContaining({ unreadCount: 1 }),
    }));
    expect(conversations.c1.unreadCount).toBe(2);
    expect(deps.refreshOpenPeerThreadList).toHaveBeenCalledTimes(1);
  });
});
