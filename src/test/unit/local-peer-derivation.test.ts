/**
 * @jest-environment jsdom
 *
 * Unit tests for src/web/services/local-peer-derivation.ts (P0 step 5).
 *
 * Covers:
 *   - peersFromLocalTalkExchanges: accumulates sent/match stats per peer
 *   - peersFromLocalConversations: accumulates conversation-match stats
 *   - peersFromKnownPeople: always includes labeled contacts
 *   - mergePeerSummaryLists: precedence rules (primary wins on stats, latest date wins)
 *   - deriveLocalPeers: full merge order (exchanges > conversations > knownPeople)
 *   - computeMatchPercent: formula parity with peer-routes.ts#computeRelationshipStats
 *   - localTalkHistoryForPeer: merge and dedup from conversations + exchanges
 *   - deriveLocalCreatorReplies: derives reply rows from sent exchanges
 *   - Self-exclusion and TechSupport exclusion
 */

import {
  peersFromLocalTalkExchanges,
  peersFromLocalConversations,
  peersFromKnownPeople,
  mergePeerSummaryLists,
  deriveLocalPeers,
  computeMatchPercent,
  localTalkHistoryForPeer,
  deriveLocalCreatorReplies,
} from '../../web/services/local-peer-derivation';
import type { KnownPerson } from '../../shared/types';

const SELF_ID = 'user-self';
const PEER_A = 'peer-a';
const PEER_B = 'peer-b';

function setExchanges(entries: Array<{
  peerId: string;
  peerName?: string;
  talkId: string;
  title?: string;
  outcome: 'match' | 'mismatch' | 'ignore';
  direction?: 'sent' | 'received';
  date?: string;
}>): void {
  const exchanges: Record<string, unknown> = {};
  for (const e of entries) {
    exchanges[`${e.peerId}::${e.talkId}`] = {
      peerId: e.peerId,
      peerName: e.peerName ?? 'Unknown',
      talkId: e.talkId,
      title: e.title ?? 'Talk',
      outcome: e.outcome,
      direction: e.direction ?? 'sent',
      date: e.date ?? new Date().toISOString(),
    };
  }
  localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
}

beforeEach(() => {
  localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// peersFromLocalTalkExchanges
// ─────────────────────────────────────────────────────────────────────────────

describe('peersFromLocalTalkExchanges', () => {
  it('returns empty array when localStorage is empty', () => {
    expect(peersFromLocalTalkExchanges(SELF_ID)).toEqual([]);
  });

  it('excludes self from results', () => {
    setExchanges([{ peerId: SELF_ID, talkId: 'talk1', outcome: 'match' }]);
    expect(peersFromLocalTalkExchanges(SELF_ID)).toEqual([]);
  });

  it('accumulates sent talk count and matches per peer', () => {
    setExchanges([
      { peerId: PEER_A, talkId: 'talk1', outcome: 'match' },
      { peerId: PEER_A, talkId: 'talk2', outcome: 'mismatch' },
      { peerId: PEER_A, talkId: 'talk3', outcome: 'ignore' },
    ]);
    const peers = peersFromLocalTalkExchanges(SELF_ID);
    expect(peers).toHaveLength(1);
    expect(peers[0].peerId).toBe(PEER_A);
    expect(peers[0].stats.sent.talks).toBe(3);
    expect(peers[0].stats.sent.matches).toBe(1);
    expect(peers[0].stats.totalTalks).toBe(3);
  });

  it('handles multiple peers independently', () => {
    setExchanges([
      { peerId: PEER_A, talkId: 'talk1', outcome: 'match' },
      { peerId: PEER_B, talkId: 'talk2', outcome: 'mismatch' },
    ]);
    const peers = peersFromLocalTalkExchanges(SELF_ID);
    expect(peers).toHaveLength(2);
    const a = peers.find((p) => p.peerId === PEER_A)!;
    const b = peers.find((p) => p.peerId === PEER_B)!;
    expect(a.stats.sent.matches).toBe(1);
    expect(b.stats.sent.matches).toBe(0);
  });

  it('takes the latest date as lastInteractionAt', () => {
    setExchanges([
      { peerId: PEER_A, talkId: 'talk1', outcome: 'match', date: '2026-01-01T00:00:00.000Z' },
      { peerId: PEER_A, talkId: 'talk2', outcome: 'mismatch', date: '2026-06-01T00:00:00.000Z' },
    ]);
    const peers = peersFromLocalTalkExchanges(SELF_ID);
    expect(peers[0].lastInteractionAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// peersFromLocalConversations
// ─────────────────────────────────────────────────────────────────────────────

describe('peersFromLocalConversations', () => {
  it('returns empty array when conversations is empty', () => {
    expect(peersFromLocalConversations({}, SELF_ID)).toEqual([]);
  });

  it('excludes self and support channels', () => {
    const conversations = {
      'conv-self': { otherUserId: SELF_ID, otherUserName: 'Self' },
      'conv-support': { otherUserId: PEER_B, otherUserName: 'Support', supportChannel: true },
    };
    expect(peersFromLocalConversations(conversations, SELF_ID)).toEqual([]);
  });

  it('counts each conversation as one match', () => {
    const conversations = {
      'conv-a': { otherUserId: PEER_A, otherUserName: 'Alice', createdAt: '2026-05-01T00:00:00.000Z' },
    };
    const peers = peersFromLocalConversations(conversations, SELF_ID);
    expect(peers).toHaveLength(1);
    expect(peers[0].peerId).toBe(PEER_A);
    expect(peers[0].stats.sent.matches).toBe(1);
    expect(peers[0].stats.totalTalks).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// peersFromKnownPeople
// ─────────────────────────────────────────────────────────────────────────────

describe('peersFromKnownPeople', () => {
  it('returns empty array for empty list', () => {
    expect(peersFromKnownPeople([], SELF_ID)).toEqual([]);
  });

  it('excludes self', () => {
    const known: KnownPerson[] = [{ userId: SELF_ID, labels: ['friend'], addedAt: new Date() }];
    expect(peersFromKnownPeople(known, SELF_ID)).toEqual([]);
  });

  it('always includes a labeled contact even with zero exchange stats', () => {
    const known: KnownPerson[] = [{
      userId: PEER_A,
      labels: ['friend'],
      nickname: 'Alice',
      addedAt: new Date('2026-04-01T00:00:00.000Z'),
    }];
    const peers = peersFromKnownPeople(known, SELF_ID);
    expect(peers).toHaveLength(1);
    expect(peers[0].peerId).toBe(PEER_A);
    expect(peers[0].stats.totalTalks).toBe(0);
    expect(peers[0].stats.sent.matches).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergePeerSummaryLists — precedence
// ─────────────────────────────────────────────────────────────────────────────

describe('mergePeerSummaryLists', () => {
  it('primary stats win over secondary via Math.max', () => {
    const primary = [{
      peerId: PEER_A,
      stageName: 'Alice',
      lastInteractionAt: '2026-01-01T00:00:00.000Z',
      stats: { sent: { talks: 5, matches: 3 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 3, mutualTagCount: 0, totalTalks: 5 },
    }];
    const secondary = [{
      peerId: PEER_A,
      stageName: 'A (old)',
      lastInteractionAt: '2025-01-01T00:00:00.000Z',
      stats: { sent: { talks: 2, matches: 1 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 1, mutualTagCount: 0, totalTalks: 2 },
    }];
    const merged = mergePeerSummaryLists(primary, secondary);
    expect(merged).toHaveLength(1);
    // primary stats dominate
    expect(merged[0].stats.sent.talks).toBe(5);
    expect(merged[0].stats.sent.matches).toBe(3);
    // stageName from primary preserved
    expect(merged[0].stageName).toBe('Alice');
    // lastInteractionAt: latest wins
    expect(merged[0].lastInteractionAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('adds new peers from secondary that are not in primary', () => {
    const primary = [{ peerId: PEER_A, stageName: 'Alice', lastInteractionAt: '2026-01-01T00:00:00.000Z', stats: { sent: { talks: 1, matches: 1 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 1, mutualTagCount: 0, totalTalks: 1 } }];
    const secondary = [{ peerId: PEER_B, stageName: 'Bob', lastInteractionAt: '2026-01-01T00:00:00.000Z', stats: { sent: { talks: 0, matches: 0 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 0, mutualTagCount: 0, totalTalks: 0 } }];
    const merged = mergePeerSummaryLists(primary, secondary);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.peerId)).toContain(PEER_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveLocalPeers — full merge (P0 step 5 main entry point)
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveLocalPeers', () => {
  it('returns empty when all sources are empty', () => {
    expect(deriveLocalPeers({ currentUserId: SELF_ID, conversations: {}, knownPeople: [] })).toEqual([]);
  });

  it('excludes self from all sources', () => {
    setExchanges([{ peerId: SELF_ID, talkId: 'talk1', outcome: 'match' }]);
    const peers = deriveLocalPeers({
      currentUserId: SELF_ID,
      conversations: { 'c1': { otherUserId: SELF_ID } },
      knownPeople: [{ userId: SELF_ID, labels: ['friend'], addedAt: new Date() }],
    });
    expect(peers).toEqual([]);
  });

  it('merge priority: exchanges > conversations > knownPeople', () => {
    // exchanges: PEER_A has 3 sent, 2 matches
    setExchanges([
      { peerId: PEER_A, talkId: 'talk1', outcome: 'match', date: '2026-06-01T00:00:00.000Z' },
      { peerId: PEER_A, talkId: 'talk2', outcome: 'match', date: '2026-06-01T00:00:01.000Z' },
      { peerId: PEER_A, talkId: 'talk3', outcome: 'mismatch', date: '2026-06-01T00:00:02.000Z' },
    ]);
    // conversations: PEER_A has 1 match (lower priority — Math.max with exchanges wins)
    const conversations = { 'conv1': { otherUserId: PEER_A, otherUserName: 'Alice', createdAt: '2026-05-01T00:00:00.000Z' } };
    // knownPeople: PEER_B — only appears via knownPeople
    const knownPeople: KnownPerson[] = [
      { userId: PEER_B, labels: ['friend'], nickname: 'Bob', addedAt: new Date('2026-04-01T00:00:00.000Z') },
    ];

    const peers = deriveLocalPeers({ currentUserId: SELF_ID, conversations, knownPeople });
    expect(peers).toHaveLength(2);

    const a = peers.find((p) => p.peerId === PEER_A)!;
    // exchange stats win (3 talks, 2 matches)
    expect(a.stats.sent.talks).toBe(3);
    expect(a.stats.sent.matches).toBe(2);

    const b = peers.find((p) => p.peerId === PEER_B)!;
    // knownPeople stub: zero stats
    expect(b.stats.totalTalks).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMatchPercent — formula parity with peer-routes.ts#computeRelationshipStats
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMatchPercent', () => {
  it('returns 0 when totalTalks is 0', () => {
    expect(computeMatchPercent({ sent: { talks: 0, matches: 0 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 0, mutualTagCount: 0, totalTalks: 0 })).toBe(0);
  });

  it('returns 100 when all talks matched', () => {
    expect(computeMatchPercent({ sent: { talks: 2, matches: 2 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 2, mutualTagCount: 0, totalTalks: 2 })).toBe(100);
  });

  it('returns 80 for 8/10 matched (mirrors server computeRelationshipStats formula)', () => {
    // Server: matchRate = (sent.matches + received.matches) / totalTalks = 8/10 = 0.8
    // matchPercent = round(0.8 * 100) = 80
    expect(computeMatchPercent({ sent: { talks: 10, matches: 8 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 8, mutualTagCount: 0, totalTalks: 10 })).toBe(80);
  });

  it('rounds correctly for partial percentages', () => {
    // 1 match out of 3 talks = 33.33% → rounds to 33
    expect(computeMatchPercent({ sent: { talks: 3, matches: 1 }, received: { talks: 0, matches: 0 }, mutualMatchedTalks: 1, mutualTagCount: 0, totalTalks: 3 })).toBe(33);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localTalkHistoryForPeer
// ─────────────────────────────────────────────────────────────────────────────

describe('localTalkHistoryForPeer', () => {
  it('returns empty when no conversations or exchanges for peer', () => {
    const history = localTalkHistoryForPeer(PEER_A, {}, {}, 'Untitled');
    expect(history).toEqual([]);
  });

  it('derives history from conversations as direction=sent outcome=match', () => {
    const conversations = {
      'conv1': { otherUserId: PEER_A, talkId: 'talk1', createdAt: '2026-05-01T00:00:00.000Z' },
    };
    const myTalks = { 'talk1': { title: 'Tennis Talk' } };
    const history = localTalkHistoryForPeer(PEER_A, conversations, myTalks, 'Untitled');
    expect(history).toHaveLength(1);
    expect(history[0].talkId).toBe('talk1');
    expect(history[0].title).toBe('Tennis Talk');
    expect(history[0].direction).toBe('sent');
    expect(history[0].outcome).toBe('match');
  });

  it('derives history from localTalkExchanges', () => {
    setExchanges([
      { peerId: PEER_A, talkId: 'talk2', title: 'Chess Talk', outcome: 'mismatch', date: '2026-06-01T00:00:00.000Z' },
    ]);
    const history = localTalkHistoryForPeer(PEER_A, {}, {}, 'Untitled');
    expect(history).toHaveLength(1);
    expect(history[0].talkId).toBe('talk2');
    expect(history[0].outcome).toBe('mismatch');
  });

  it('exchanges overwrite conversation-derived entries for the same talkId', () => {
    const conversations = {
      'conv1': { otherUserId: PEER_A, talkId: 'talk1', createdAt: '2026-05-01T00:00:00.000Z' },
    };
    setExchanges([
      { peerId: PEER_A, talkId: 'talk1', title: 'Tennis Override', outcome: 'mismatch', date: '2026-06-01T00:00:00.000Z' },
    ]);
    const history = localTalkHistoryForPeer(PEER_A, conversations, {}, 'Untitled');
    expect(history).toHaveLength(1);
    // Exchange wins
    expect(history[0].outcome).toBe('mismatch');
    expect(history[0].title).toBe('Tennis Override');
  });

  it('only includes history for the specified peer', () => {
    setExchanges([
      { peerId: PEER_A, talkId: 'talk1', outcome: 'match' },
      { peerId: PEER_B, talkId: 'talk2', outcome: 'match' },
    ]);
    const history = localTalkHistoryForPeer(PEER_A, {}, {}, 'Untitled');
    expect(history.every((h) => h.talkId === 'talk1')).toBe(true);
    expect(history).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveLocalCreatorReplies
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveLocalCreatorReplies', () => {
  it('returns empty when no exchanges', () => {
    expect(deriveLocalCreatorReplies(SELF_ID)).toEqual([]);
  });

  it('returns empty for empty userId', () => {
    expect(deriveLocalCreatorReplies('')).toEqual([]);
  });

  it('derives reply rows from sent exchanges', () => {
    setExchanges([
      { peerId: PEER_A, peerName: 'Alice', talkId: 'talk1', title: 'Tennis', outcome: 'match', direction: 'sent', date: '2026-06-01T00:00:00.000Z' },
    ]);
    const replies = deriveLocalCreatorReplies(SELF_ID);
    expect(replies).toHaveLength(1);
    expect(replies[0].responderId).toBe(PEER_A);
    expect(replies[0].responderName).toBe('Alice');
    expect(replies[0].talkId).toBe('talk1');
    expect(replies[0].outcome).toBe('match');
  });

  it('maps ignore outcome correctly', () => {
    setExchanges([
      { peerId: PEER_B, talkId: 'talk2', outcome: 'ignore', direction: 'sent' },
    ]);
    const replies = deriveLocalCreatorReplies(SELF_ID);
    expect(replies[0].outcome).toBe('ignore');
  });

  it('maps mismatch outcome correctly', () => {
    setExchanges([
      { peerId: PEER_B, talkId: 'talk3', outcome: 'mismatch', direction: 'sent' },
    ]);
    const replies = deriveLocalCreatorReplies(SELF_ID);
    expect(replies[0].outcome).toBe('mismatch');
  });

  it('deduplicates by responseId (peerId::talkId)', () => {
    // Two entries with same peerId::talkId key are overwritten in localStorage
    const exchanges = {
      [`${PEER_A}::talk1`]: { peerId: PEER_A, peerName: 'Alice', talkId: 'talk1', title: 'T1', outcome: 'match', direction: 'sent', date: '2026-06-01T00:00:00.000Z' },
    };
    localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
    const replies = deriveLocalCreatorReplies(SELF_ID);
    expect(replies).toHaveLength(1);
  });

  it('excludes self from reply rows', () => {
    setExchanges([
      { peerId: SELF_ID, talkId: 'talk1', outcome: 'match', direction: 'sent' },
    ]);
    // SELF_ID equals currentUserId so it should be excluded
    expect(deriveLocalCreatorReplies(SELF_ID)).toEqual([]);
  });
});
