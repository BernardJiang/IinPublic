/** @jest-environment jsdom */

import { getPeerNameCache, rememberPeerName } from '../../web/ui/peer-name-cache';

beforeEach(() => {
  localStorage.clear();
});

describe('getPeerNameCache', () => {
  it('returns an empty object when nothing is cached', () => {
    expect(getPeerNameCache()).toEqual({});
  });

  it('returns an empty object when the stored value is malformed JSON', () => {
    localStorage.setItem('peerNameCache', 'not json');
    expect(getPeerNameCache()).toEqual({});
  });

  it('returns the parsed cache', () => {
    localStorage.setItem('peerNameCache', JSON.stringify({ u1: 'Alice' }));
    expect(getPeerNameCache()).toEqual({ u1: 'Alice' });
  });
});

describe('rememberPeerName', () => {
  it('does nothing for a blank userId or stageName', () => {
    rememberPeerName('', 'Alice', () => ({}));
    rememberPeerName('u1', '  ', () => ({}));
    expect(getPeerNameCache()).toEqual({});
  });

  it('caches a new name, trimmed', () => {
    rememberPeerName(' u1 ', ' Alice ', () => ({}));
    expect(getPeerNameCache()).toEqual({ u1: 'Alice' });
  });

  it('is a no-op (does not rewrite storage) when the cached name is already current', () => {
    localStorage.setItem('peerNameCache', JSON.stringify({ u1: 'Alice' }));
    const getMyConversations = jest.fn(() => ({}));
    rememberPeerName('u1', 'Alice', getMyConversations);
    // Storage untouched means the conversation-sync branch is also skipped (not called).
    expect(getMyConversations).not.toHaveBeenCalled();
  });

  it('syncs a fresher name into matching stored conversations', () => {
    const conversations = {
      c1: { otherUserId: 'u1', otherUserName: 'OldName', supportChannel: false },
      c2: { otherUserId: 'u2', otherUserName: 'Someone Else' },
    };
    localStorage.setItem('myConversations', JSON.stringify(conversations));
    rememberPeerName('u1', 'NewName', () => conversations);

    const stored = JSON.parse(localStorage.getItem('myConversations')!);
    expect(stored.c1.otherUserName).toBe('NewName');
    expect(stored.c2.otherUserName).toBe('Someone Else');
  });

  it('never overwrites a support-channel conversation\'s name', () => {
    const conversations = {
      c1: { otherUserId: 'u1', otherUserName: 'OldName', supportChannel: true },
    };
    rememberPeerName('u1', 'NewName', () => conversations);
    expect(conversations.c1.otherUserName).toBe('OldName');
  });

  it('does not write myConversations back when nothing actually changed', () => {
    const conversations = { c1: { otherUserId: 'u2', otherUserName: 'Unrelated' } };
    rememberPeerName('u1', 'NewName', () => conversations);
    expect(localStorage.getItem('myConversations')).toBeNull();
  });

  it('swallows a getMyConversations failure — the cache write above still succeeds', () => {
    const getMyConversations = (): Record<string, any> => {
      throw new Error('boom');
    };
    expect(() => rememberPeerName('u1', 'Alice', getMyConversations)).not.toThrow();
    expect(getPeerNameCache()).toEqual({ u1: 'Alice' });
  });
});
