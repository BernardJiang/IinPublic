/** @jest-environment jsdom */
/** OPEN-87 S5: exchange-only people beyond the Contacts cap are pruned; relationships always stay. */
import {
  DEFAULT_CONTACTS_CAP,
  applyContactsPrune,
  getContactsCap,
  getPrunedPeerIds,
  planContactsPrune,
  setContactsCap,
  unprunePeer,
} from '../../web/services/contacts-prune';
import type { PeerSummary } from '../../shared/peer-summary-types';
import { readExchanges } from '../../web/services/exchange-view';

const peer = (peerId: string, daysAgo: number): PeerSummary => ({
  peerId,
  stageName: peerId,
  lastInteractionAt: new Date(Date.UTC(2026, 9, 24) - daysAgo * 86_400_000).toISOString(),
  stats: { sent: { talks: 1, matches: 0 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 0, mutualTagCount: 0, totalTalks: 1 },
});

const base = {
  conversations: {
    c1: { otherUserId: 'messaged', lastMessage: 'hi' },
    c2: { otherUserId: 'silent-match', lastMessage: null },
    c3: { otherUserId: 'support', supportChannel: true },
  },
  knownPeopleIds: new Set(['friend']),
  isBlocked: (id: string) => id === 'blocked',
  pinnedIds: new Set(['pinned']),
  sharedTags: (id: string) => (id === 'old-but-similar' ? 3 : 0),
};

describe('contacts prune', () => {
  beforeEach(() => localStorage.clear());

  it('keeps relationships and caps the rest by shared tags, then recency', () => {
    const peers = ['messaged', 'support', 'friend', 'blocked', 'pinned', 'silent-match'].map((id) => peer(id, 50))
      .concat([peer('recent', 1), peer('old-but-similar', 90), peer('old', 60), peer('older', 80)]);
    const { drop, keepAlways } = planContactsPrune({ ...base, peers, cap: 3 });
    // Candidates: silent-match(50d), recent(1d), old-but-similar(90d, 3 tags), old(60d), older(80d).
    // Kept: old-but-similar (most shared tags), recent, silent-match. Dropped: the two oldest.
    expect(drop.sort()).toEqual(['old', 'older']);
    expect(['messaged', 'support', 'friend', 'pinned'].every((id) => keepAlways.has(id))).toBe(true);
    expect(drop).not.toContain('blocked');
  });

  it('prunes nothing within the cap', () => {
    expect(planContactsPrune({ ...base, peers: [peer('a', 1), peer('b', 2)], cap: 5 }).drop).toEqual([]);
  });

  it('deletes the dropped people’s exchange records, hides them, and brings back a returning person', () => {
    localStorage.setItem('localTalkExchanges', JSON.stringify({
      'old::t1': { peerId: 'old', talkId: 't1' },
      'old::t2': { peerId: 'old', talkId: 't2' },
      'recent::t1': { peerId: 'recent', talkId: 't1' },
    }));
    applyContactsPrune(['old'], new Set());
    // The log lives in the device core; the GUI's view no longer has 'old' (OPEN-91 P1).
    expect(readExchanges().map((record) => `${record.peerId}::${record.talkId}`)).toEqual(['recent::t1']);
    expect(getPrunedPeerIds().has('old')).toBe(true);

    unprunePeer('old');
    expect(getPrunedPeerIds().has('old')).toBe(false);

    applyContactsPrune(['x'], new Set());
    applyContactsPrune([], new Set(['x']));
    expect(getPrunedPeerIds().has('x')).toBe(false);
  });

  it('offers 500 / 1,000 / 2,000 with 1,000 by default', () => {
    expect(getContactsCap()).toBe(DEFAULT_CONTACTS_CAP);
    setContactsCap(2_000);
    expect(getContactsCap()).toBe(2_000);
    setContactsCap(7);
    expect(getContactsCap()).toBe(2_000);
  });
});
