/** @jest-environment jsdom */

import {
  endMatchCollectionSession,
  getActiveMatchCollectionSession,
  listMatchCollectionSessions,
  MATCH_COLLECTION_STORE_KEY,
  recordMatchCollectionDelivery,
  recordMatchCollectionExchange,
  startMatchCollectionSession,
} from '../../web/services/match-collection-session';

describe('match collection sessions', () => {
  beforeEach(() => localStorage.clear());

  it('persists one active outing with its Talk and blurred location snapshot', () => {
    const started = startMatchCollectionSession({
      label: 'Westfield',
      scopeId: 'nearby-v3',
      talkIds: ['talk-a', 'talk-a', 'talk-b'],
      point: { latitude: 32.7, longitude: -117.1, precisionMeters: 1_000 },
    }, new Date('2026-10-20T10:00:00Z'), () => 0.25);

    expect(started.id).toBe('collection_mvgii4g0_hra0hs');
    expect(started.talkIds).toEqual(['talk-a', 'talk-b']);
    expect(getActiveMatchCollectionSession()).toEqual(started);
  });

  it('links intended delivery pairs and keeps a late result under an ended outing', () => {
    const started = startMatchCollectionSession({ label: 'Subway', scopeId: 'nearby-v3' }, new Date('2026-10-20T10:00:00Z'));
    recordMatchCollectionDelivery({
      talkIds: ['talk-a', 'talk-b'],
      peerIds: ['alice', 'bob'],
      talkReceiverIds: { 'talk-a': ['alice'], 'talk-b': ['alice', 'bob'] },
    }, new Date('2026-10-20T10:01:00Z'));
    endMatchCollectionSession(new Date('2026-10-20T10:30:00Z'));

    expect(recordMatchCollectionExchange('bob', 'talk-a', 'match')).toBeNull();
    expect(recordMatchCollectionExchange('bob', 'talk-b', 'match', new Date('2026-10-20T11:00:00Z'))).toEqual({
      collectionSessionId: started.id,
      collectionLabel: 'Subway',
      collectionStartedAt: '2026-10-20T10:00:00.000Z',
    });
    expect(listMatchCollectionSessions()[0]).toMatchObject({
      endedAt: '2026-10-20T10:30:00.000Z',
      talkIds: ['talk-a', 'talk-b'],
      reachedPeerIds: ['alice', 'bob'],
      results: [{ peerId: 'bob', talkId: 'talk-b', outcome: 'match', capturedAt: '2026-10-20T11:00:00.000Z' }],
    });
  });

  it('moves a repeated peer + Talk association to the newest outing without rewriting history', () => {
    const first = startMatchCollectionSession({ label: 'Mall', scopeId: 'nearby-v3' }, new Date('2026-10-20T10:00:00Z'));
    recordMatchCollectionDelivery({ talkIds: ['talk-a'], peerIds: ['alice'] });
    endMatchCollectionSession(new Date('2026-10-20T10:30:00Z'));
    const second = startMatchCollectionSession({ label: 'Train', scopeId: 'nearby-v3' }, new Date('2026-10-21T10:00:00Z'));
    recordMatchCollectionDelivery({ talkIds: ['talk-a'], peerIds: ['alice'] });

    expect(recordMatchCollectionExchange('alice', 'talk-a', 'mismatch')?.collectionSessionId).toBe(second.id);
    expect(listMatchCollectionSessions().find((session) => session.id === first.id)?.results).toEqual([]);
  });

  it('ends an earlier active outing when a new one starts and ignores corrupt storage', () => {
    const first = startMatchCollectionSession({ label: 'Mall', scopeId: 'nearby-v3' }, new Date('2026-10-20T10:00:00Z'));
    startMatchCollectionSession({ label: 'Station', scopeId: 'place:station' }, new Date('2026-10-20T11:00:00Z'));
    expect(listMatchCollectionSessions().find((session) => session.id === first.id)?.endedAt).toBe('2026-10-20T11:00:00.000Z');

    localStorage.setItem(MATCH_COLLECTION_STORE_KEY, 'not json');
    expect(getActiveMatchCollectionSession()).toBeNull();
    expect(listMatchCollectionSessions()).toEqual([]);
  });
});
