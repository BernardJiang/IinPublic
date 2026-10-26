/** OPEN-91 P4: how a conversation record changes, as the core decides it. */
import { endConversation, mergeConversationRecord, otherDealConversationIds, supersedeConversations, withdrawConversation } from '../../core/conversation-state';

const names = (_id: string, fallback?: string) => fallback || 'Unknown';
const NOW = '2026-10-26T10:00:00.000Z';

describe('conversation records', () => {
  it('a new match is unread, carries its Talk, and is created now', () => {
    const record = mergeConversationRecord(undefined, { conversationId: 'c1', otherUserId: 'ann', otherUserName: 'Ann', talkId: 't1' }, names, NOW);
    expect(record).toMatchObject({ conversationId: 'c1', otherUserName: 'Ann', talkId: 't1', relatedTalkIds: ['t1'], unread: true, createdAt: NOW, respondedByBot: false });
  });

  it('a re-sync keeps what it must never drop, keeps the better name, and unions the Talks', () => {
    const existing = {
      otherUserName: 'Ann', talkId: 't1', relatedTalkIdsJson: JSON.stringify(['t1']), respondedByBot: true, dealEligible: true,
      unread: false, unreadCount: 3, threadSummaries: { t1: {} }, status: 'withdrawn', retractedAt: NOW, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const record = mergeConversationRecord(existing, { conversationId: 'c1', otherUserId: 'ann', otherUserName: 'Unknown', talkId: 't2' }, names, NOW);
    expect(record).toMatchObject({
      otherUserName: 'Ann', talkId: 't2', respondedByBot: true, dealEligible: true, unread: false, unreadCount: 3,
      status: 'withdrawn', retractedAt: NOW, createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(record.relatedTalkIds.sort()).toEqual(['t1', 't2']);
  });

  it('a support channel has no Talk and is never unread', () => {
    const record = mergeConversationRecord(undefined, { conversationId: 's', otherUserId: 'ts', otherUserName: 'TechSupport', talkId: 'direct', supportChannel: true }, names, NOW);
    expect(record.talkId).toBeUndefined();
    expect(record.unread).toBe(false);
  });

  it('withdraws, ends and supersedes, and says when nothing changed', () => {
    const conversations: Record<string, any> = { c1: { otherUserId: 'ann', talkId: 't1' }, c2: { otherUserId: 'bob', talkId: 't1' }, c3: { otherUserId: 'cy', talkId: 't9', status: 'ignored' } };
    expect(withdrawConversation(conversations, 'ann', 't1', Date.parse(NOW))).toBe(true);
    expect(conversations.c1.status).toBe('withdrawn');
    expect(endConversation(conversations, 'bob', 't1', NOW)).toBe(true);
    expect(conversations.c2.status).toBe('ignored');
    expect(endConversation(conversations, 'zed', 't1', NOW)).toBe(false);
    expect(otherDealConversationIds(conversations, 't1', 'ann')).toEqual(['c2']);
    expect(supersedeConversations(conversations, ['c1', 'c3'], NOW)).toBe(false);
  });
});
