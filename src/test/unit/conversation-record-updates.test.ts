/** @jest-environment jsdom */

import {
  markConversationWithdrawn,
  markConversationEnded,
  markOtherDealConversationsEnded,
} from '../../web/ui/conversation-record-updates';

function deps(overrides: Partial<Parameters<typeof markConversationWithdrawn>[3]> = {}) {
  return {
    getMyConversations: jest.fn(() => ({} as Record<string, any>)),
    updateMatchBadge: jest.fn(),
    syncStatusBarMatchCount: jest.fn(),
    refreshConversationsListIfActive: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('markConversationWithdrawn', () => {
  it('is a no-op when no conversation matches otherUserId+talkId or talkId alone', () => {
    const d = deps({ getMyConversations: jest.fn(() => ({ c1: { otherUserId: 'other', talkId: 'other-talk' } })) });
    markConversationWithdrawn('u1', 't1', Date.now(), d);
    expect(d.updateMatchBadge).not.toHaveBeenCalled();
  });

  it('finds by otherUserId+talkId and sets status/retractedAt/lastMessage', () => {
    const conversations: any = { c1: { otherUserId: 'u1', talkId: 't1' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    const retractedAt = Date.parse('2026-01-01T00:00:00Z');
    markConversationWithdrawn('u1', 't1', retractedAt, d);

    expect(conversations.c1.status).toBe('withdrawn');
    expect(conversations.c1.retractedAt).toBe(new Date(retractedAt).toISOString());
    expect(conversations.c1.lastMessage).toContain('Author removed this talk');
    expect(conversations.c1.lastMessageTime).toBe(new Date(retractedAt).toISOString());
  });

  it('falls back to matching by talkId alone (author side) when otherUserId does not match', () => {
    const conversations: any = { c1: { otherUserId: 'someone-else', talkId: 't1' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markConversationWithdrawn('u1', 't1', Date.now(), d);
    expect(conversations.c1.status).toBe('withdrawn');
  });

  it('persists to localStorage and refreshes badge/status-bar always, list only when Me tab is active', () => {
    const conversations: any = { c1: { otherUserId: 'u1', talkId: 't1' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markConversationWithdrawn('u1', 't1', Date.now(), d);
    expect(JSON.parse(localStorage.getItem('myConversations')!).c1.status).toBe('withdrawn');
    expect(d.updateMatchBadge).toHaveBeenCalledTimes(1);
    expect(d.syncStatusBarMatchCount).toHaveBeenCalledTimes(1);
    expect(d.refreshConversationsListIfActive).not.toHaveBeenCalled();

    document.body.innerHTML = '<button class="nav-btn active" data-view="me"></button>';
    markConversationWithdrawn('u1', 't1', Date.now(), d);
    expect(d.refreshConversationsListIfActive).toHaveBeenCalledTimes(1);
  });
});

describe('markConversationEnded', () => {
  it('is a no-op when no conversation matches otherUserId (with or without talkId)', () => {
    const d = deps({ getMyConversations: jest.fn(() => ({ c1: { otherUserId: 'someone-else' } })) });
    markConversationEnded('u1', 't1', new Date().toISOString(), d);
    expect(d.updateMatchBadge).not.toHaveBeenCalled();
  });

  it('finds by otherUserId+talkId and sets status/changedAt/lastMessage', () => {
    const conversations: any = { c1: { otherUserId: 'u1', talkId: 't1' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    const changedAt = new Date('2026-02-01T00:00:00Z').toISOString();
    markConversationEnded('u1', 't1', changedAt, d);

    expect(conversations.c1.status).toBe('ignored');
    expect(conversations.c1.changedAt).toBe(changedAt);
    expect(conversations.c1.lastMessage).toContain('Answer changed');
    expect(conversations.c1.lastMessageTime).toBe(changedAt);
  });

  it('falls back to matching by otherUserId alone when talkId does not match', () => {
    const conversations: any = { c1: { otherUserId: 'u1', talkId: 'different-talk' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markConversationEnded('u1', 't1', new Date().toISOString(), d);
    expect(conversations.c1.status).toBe('ignored');
  });

  it('refreshes badge/status-bar always, list only when Me tab is active', () => {
    document.body.innerHTML = '<button class="nav-btn active" data-view="me"></button>';
    const conversations: any = { c1: { otherUserId: 'u1', talkId: 't1' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markConversationEnded('u1', 't1', new Date().toISOString(), d);
    expect(d.updateMatchBadge).toHaveBeenCalledTimes(1);
    expect(d.refreshConversationsListIfActive).toHaveBeenCalledTimes(1);
  });
});

describe('markOtherDealConversationsEnded', () => {
  it('ignores every other conversation for the same talkId, leaving the kept one untouched', () => {
    const conversations: any = {
      keep: { otherUserId: 'winner', talkId: 't1', status: 'matched' },
      other: { otherUserId: 'loser', talkId: 't1', status: 'matched' },
    };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    const changedAt = new Date('2026-03-01T00:00:00Z').toISOString();
    markOtherDealConversationsEnded('t1', 'winner', changedAt, d);

    expect(conversations.keep.status).toBe('matched');
    expect(conversations.other.status).toBe('ignored');
    expect(conversations.other.changedAt).toBe(changedAt);
    expect(conversations.other.lastMessage).toContain('deal was confirmed with someone else');
    expect(conversations.other.lastMessageTime).toBe(changedAt);
  });

  it('skips conversations for a different talkId', () => {
    const conversations: any = { c1: { otherUserId: 'x', talkId: 'different-talk', status: 'matched' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markOtherDealConversationsEnded('t1', 'winner', new Date().toISOString(), d);
    expect(conversations.c1.status).toBe('matched');
    expect(d.updateMatchBadge).not.toHaveBeenCalled();
  });

  it('skips conversations already ignored or withdrawn', () => {
    const conversations: any = {
      c1: { otherUserId: 'x', talkId: 't1', status: 'ignored' },
      c2: { otherUserId: 'y', talkId: 't1', status: 'withdrawn' },
    };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markOtherDealConversationsEnded('t1', 'winner', new Date().toISOString(), d);
    expect(d.updateMatchBadge).not.toHaveBeenCalled();
  });

  it('is a no-op (no persist, no refresh) when nothing changed', () => {
    const conversations: any = { c1: { otherUserId: 'winner', talkId: 't1', status: 'matched' } };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markOtherDealConversationsEnded('t1', 'winner', new Date().toISOString(), d);
    expect(localStorage.getItem('myConversations')).toBeNull();
    expect(d.updateMatchBadge).not.toHaveBeenCalled();
  });

  it('persists to localStorage and refreshes badge/status-bar always when something changed', () => {
    const conversations: any = {
      keep: { otherUserId: 'winner', talkId: 't1', status: 'matched' },
      other: { otherUserId: 'loser', talkId: 't1', status: 'matched' },
    };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markOtherDealConversationsEnded('t1', 'winner', new Date().toISOString(), d);
    expect(JSON.parse(localStorage.getItem('myConversations')!).other.status).toBe('ignored');
    expect(d.updateMatchBadge).toHaveBeenCalledTimes(1);
    expect(d.syncStatusBarMatchCount).toHaveBeenCalledTimes(1);
    expect(d.refreshConversationsListIfActive).not.toHaveBeenCalled();
  });

  it('refreshes the conversations list too when the Me tab is active', () => {
    document.body.innerHTML = '<button class="nav-btn active" data-view="me"></button>';
    const conversations: any = {
      keep: { otherUserId: 'winner', talkId: 't1', status: 'matched' },
      other: { otherUserId: 'loser', talkId: 't1', status: 'matched' },
    };
    const d = deps({ getMyConversations: jest.fn(() => conversations) });
    markOtherDealConversationsEnded('t1', 'winner', new Date().toISOString(), d);
    expect(d.refreshConversationsListIfActive).toHaveBeenCalledTimes(1);
  });
});
