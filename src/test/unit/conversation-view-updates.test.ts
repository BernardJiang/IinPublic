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

  // talks-matching/08-retraction: a re-sync after the author retracted kept 'withdrawn' but
  // dropped retractedAt, so the list lost the "match gone" time.
  it('keeps a withdrawn conversation\'s retraction time when it is re-synced', () => {
    const conversations: Record<string, any> = {
      c1: {
        conversationId: 'c1',
        otherUserId: 'author',
        talkId: 'talk-1',
        status: 'withdrawn',
        retractedAt: '2026-10-14T12:00:00.000Z',
        createdAt: '2026-10-14T11:00:00.000Z',
      },
    };

    addNewConversation({ conversationId: 'c1', otherUserId: 'author', otherUserName: 'Tom', talkId: 'talk-1' }, listDeps(conversations));

    expect(conversations.c1).toEqual(expect.objectContaining({
      status: 'withdrawn',
      retractedAt: '2026-10-14T12:00:00.000Z',
    }));
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

  it('a re-synced conversation record keeps its thread previews (stage2/69)', () => {
    const conversations: Record<string, any> = {
      c1: { conversationId: 'c1', otherUserId: 'peer', otherUserName: 'Peer', talkId: 'talk-a' },
    };
    const deps = listDeps(conversations);
    syncConversationMessageSummary('c1', [
      { id: 'r', senderId: 'me', text: 'thread reply', talkId: 'talk-a', timestamp: '2026-09-12T01:05:00.000Z' },
      { id: 'd', senderId: 'peer', text: 'direct', timestamp: '2026-09-12T01:06:00.000Z' },
    ], 'me', deps);

    // The Gun conversation record arrives again (match/thread metadata update).
    addNewConversation({ conversationId: 'c1', otherUserId: 'peer', otherUserName: 'Peer', talkId: 'talk-a' }, deps);

    expect(conversations.c1.threadSummaries['talk-a']).toEqual(expect.objectContaining({ lastMessage: 'thread reply' }));
    expect(conversations.c1.unreadCount).toBe(1);
  });
});
