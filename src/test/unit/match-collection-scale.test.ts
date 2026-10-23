/** @jest-environment jsdom */

import {
  getMatchCollectionReviewPeople,
  MATCH_COLLECTION_STORE_KEY,
  recordMatchCollectionDelivery,
  recordMatchCollectionExchange,
  startMatchCollectionSession,
  summarizeMatchCollectionSession,
} from '../../web/services/match-collection-session';
import { simulateMatchCollectionOuting } from '../support/match-collection-outing-model';

describe('match collection qualification models', () => {
  afterEach(() => localStorage.removeItem(MATCH_COLLECTION_STORE_KEY));

  it('keeps the full deterministic 498-person audience reviewable within storage bounds', () => {
    const session = startMatchCollectionSession({ label: 'Crowd', scopeId: 'nearby-v3' });
    const peers = Array.from({ length: 498 }, (_, index) => `peer-${index}`);
    recordMatchCollectionDelivery({ talkIds: ['must-have'], peerIds: peers });
    for (let index = 0; index < peers.length; index += 3) {
      recordMatchCollectionExchange(peers[index]!, 'must-have', index % 2 ? 'match' : 'mismatch');
    }

    expect(summarizeMatchCollectionSession(session.id)).toMatchObject({
      reached: 498,
      deliveries: 498,
      replies: 166,
      pending: 332,
    });
    expect(getMatchCollectionReviewPeople(session.id)).toHaveLength(498);
    expect(JSON.parse(localStorage.getItem(MATCH_COLLECTION_STORE_KEY) || '{}').associations).toHaveLength(498);
  });

  it('models a 16-client moving outing with pending, delayed, and repeated encounters', () => {
    const model = simulateMatchCollectionOuting({
      people: 16,
      talkIds: ['must-have', 'important', 'ordinary'],
      delayedModulo: 4,
      repeatedModulo: 5,
      coldStartModulo: 4,
    });

    expect(model.deliveredPairs).toBe(48);
    expect(model.pendingPairs).toBeGreaterThan(0);
    expect(model.delayedPeople).toBe(4);
    expect(model.repeatedPeople).toBe(4);
    expect(model.coldStartPeople).toBe(4);
    expect(model.coldStartPendingPairs).toBe(12);
    expect(model.pendingPairs).toBeGreaterThanOrEqual(model.coldStartPendingPairs);
    expect(model.ranked).toHaveLength(16);
    expect(model.ranked[0]?.pinned).toBe(true);
    expect(model.ranked.at(-1)?.dismissed).toBe(true);
  });
});
