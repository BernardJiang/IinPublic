/**
 * Meeting new people in groups (docs/design/nearby-and-place-chatrooms.md §3.7): a group boundary
 * on the list, on the wire, and in what a partner offers.
 */
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';
import { NEARBY_V3_DEFAULTS } from '../../shared/nearby-v3-config';
import type { NearbyCard } from '../../shared/nearby-v3-card';
import { nearbyDailyBeacon, parseNearbyRankKey } from '../../shared/nearby-v3-ranking';
import { NearbyList } from '../../shared/nearby-v3-list';
import { parseNearbyGossipMessage } from '../../shared/nearby-v3-gossip';

const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const NOW = Date.parse('2026-10-20T12:00:00Z');
const BEACON = nearbyDailyBeacon(NOW);

function card(pub: string, point: PublicLocation = SD): NearbyCard {
  return {
    version: 1,
    kind: 'nearby-card',
    userId: `user-${pub}`,
    pub,
    point,
    traveler: false,
    scope: 'nearby',
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + NEARBY_V3_DEFAULTS.cardLifetimeMs).toISOString(),
    proof: { pub, timestamp: new Date(NOW).toISOString() } as NearbyCard['proof'],
  };
}

const crowd = Array.from({ length: 12 }, (_, i) => card(`member-${i}`));
const owner = { pub: 'me', point: SD, scope: 'nearby' as const, beacon: BEACON };

describe('a group boundary on the list', () => {
  it('pages through my order: group 2 is the next C people, disjoint from group 1', () => {
    const everyone = new NearbyList(owner, { capacity: 100 });
    everyone.merge(crowd, NOW);
    const order = everyone.entries().map((entry) => entry.card.pub);

    const list = new NearbyList(owner, { capacity: 4 });
    list.merge(crowd, NOW);
    expect(list.entries().map((entry) => entry.card.pub)).toEqual(order.slice(0, 4));

    // "Meet new people": everyone at or before the last person leaves at once.
    list.setOwner({ ...owner, after: list.lastKey()! });
    expect(list.size).toBe(0);
    list.merge(crowd, NOW); // the same people offered again: only those past the boundary enter
    expect(list.entries().map((entry) => entry.card.pub)).toEqual(order.slice(4, 8));
    expect(list.useful([crowd.find((c) => c.pub === order[0])!], NOW)).toEqual([]);

    list.setOwner({ ...owner, after: list.lastKey()! });
    list.merge(crowd, NOW);
    expect(list.entries().map((entry) => entry.card.pub)).toEqual(order.slice(8, 12));

    // Back to group 1: no boundary.
    list.setOwner(owner);
    list.merge(crowd, NOW);
    expect(list.entries().map((entry) => entry.card.pub)).toEqual(order.slice(0, 4));
  });

  it('does not repeat an earlier group when a late beacon changes the rank order', () => {
    const list = new NearbyList(owner, { capacity: 4 });
    list.merge(crowd, NOW);
    const group1 = list.entries().map((entry) => entry.card.pub);
    const after = list.lastKey()!;

    // Attestation may replace the UTC fallback beacon after the first group was already shown.
    // The boundary belongs to the old order, so exact exclusions are required as well.
    list.setOwner({
      ...owner,
      beacon: 'signed-beacon-with-a-different-order',
      after,
      excludedPubs: group1,
    });
    list.merge(crowd, NOW);

    expect(list.entries()).toHaveLength(4);
    expect(list.entries().some((entry) => group1.includes(entry.card.pub))).toBe(false);
  });

  it('a partner offers only people past my boundary', () => {
    const partner = new NearbyList({ pub: 'partner', point: SD, scope: 'nearby', beacon: BEACON }, { capacity: 100 });
    partner.merge(crowd, NOW);
    const mine = new NearbyList(owner, { capacity: 4 });
    mine.merge(crowd, NOW);
    const after = mine.lastKey()!;
    const offer = partner.offerFor({
      receiver: { ...owner, after },
      digest: null,
      ownCard: null,
      swapCards: 32,
      refreshMs: 60_000,
      nowMs: NOW,
    });
    const ranked = new NearbyList({ ...owner, after }, { capacity: 100 });
    for (const offered of offer) expect(ranked.useful([offered], NOW)).toHaveLength(1);
    expect(offer).toHaveLength(8);
  });
});

describe('a group boundary on the wire', () => {
  it('rides along in requests and replies, and malformed ones are ignored', () => {
    const after = { distanceMeters: 0, newcomer: true, tie: '0123456789abcdef' };
    const digest = { version: 1, at: NOW, entries: '' };
    expect(parseNearbyGossipMessage({ kind: 'nearby-gossip-request', version: 1, card: crowd[0], digest, after }))
      .toMatchObject({ after });
    expect(parseNearbyGossipMessage({ kind: 'nearby-gossip-reply', version: 1, card: crowd[0], digest, cards: [], after }))
      .toMatchObject({ after });
    const bad = parseNearbyGossipMessage({ kind: 'nearby-gossip-request', version: 1, card: crowd[0], digest, after: { ...after, tie: 'zz' } });
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty('after');
    expect(parseNearbyRankKey({ distanceMeters: -1, newcomer: false, tie: '0123456789abcdef' })).toBeNull();
  });
});
