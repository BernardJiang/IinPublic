/**
 * Nearby v3 core (docs/design/nearby-and-place-chatrooms.md §3.7): manifest tunables, the pyramid,
 * signed cards, ranking, and one person's list with digests and gossip offers.
 */
import SEA from 'gun/sea';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';
import { NEARBY_V3_DEFAULTS, nearbyV3ConfigFromManifest } from '../../shared/nearby-v3-config';
import {
  parsePyramidCellId,
  pyramidBlock,
  pyramidCell,
  pyramidCellId,
  pyramidCellIds,
  pyramidSearch,
} from '../../shared/nearby-v3-pyramid';
import { createNearbyCard, verifyNearbyCard, type NearbyCard } from '../../shared/nearby-v3-card';
import { nearbyDailyBeacon, nearbyRankTie, publicPointDistanceMeters } from '../../shared/nearby-v3-ranking';
import { NearbyList, parseNearbyDigest } from '../../shared/nearby-v3-list';

const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const SD_NEXT = snapPublicLocation({ latitude: 32.7257, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);
const NOW = Date.parse('2026-10-19T12:00:00Z');
const LIFETIME = NEARBY_V3_DEFAULTS.cardLifetimeMs;
const BEACON = nearbyDailyBeacon(NOW);

/** An unsigned card for list logic (the list holds only cards the caller already verified). */
function card(pub: string, point: PublicLocation, issuedAtMs = NOW, scope: NearbyCard['scope'] = 'nearby'): NearbyCard {
  return {
    version: 1,
    kind: 'nearby-card',
    userId: `user-${pub}`,
    pub,
    point,
    traveler: false,
    scope,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + LIFETIME).toISOString(),
    proof: { pub } as NearbyCard['proof'],
  };
}

function owner(pub: string, point: PublicLocation = SD, scope: NearbyCard['scope'] = 'nearby') {
  return { pub, point, scope, beacon: BEACON };
}

describe('Nearby v3 config', () => {
  it('takes C from the manifest and other tunables from its nearby-v3 extension', () => {
    const config = nearbyV3ConfigFromManifest({
      chatroomCapacity: 200,
      extensions: { 'nearby-v3': { gossipPeriodMs: 60_000, swapCards: 16, unknown: 3 } },
    });
    expect(config.capacity).toBe(200);
    expect(config.gossipPeriodMs).toBe(60_000);
    expect(config.swapCards).toBe(16);
    expect(config.cardLifetimeMs).toBe(NEARBY_V3_DEFAULTS.cardLifetimeMs);
  });

  it('ignores out-of-range values and a card lifetime too short for its reissue period', () => {
    const config = nearbyV3ConfigFromManifest({
      chatroomCapacity: 1,
      extensions: { 'nearby-v3': { swapCards: 100_000, cardLifetimeMs: 120_000, cardReissueMs: 100_000 } },
    });
    expect(config.capacity).toBe(NEARBY_V3_DEFAULTS.capacity);
    expect(config.swapCards).toBe(NEARBY_V3_DEFAULTS.swapCards);
    expect(config.cardLifetimeMs).toBe(NEARBY_V3_DEFAULTS.cardLifetimeMs);
    expect(config.cardReissueMs).toBe(NEARBY_V3_DEFAULTS.cardReissueMs);
    expect(nearbyV3ConfigFromManifest(null)).toEqual(NEARBY_V3_DEFAULTS);
  });
});

describe('Nearby v3 pyramid', () => {
  it('names cells consistently and parses them back', () => {
    const cell = pyramidCell(SD, 15);
    expect(parsePyramidCellId(pyramidCellId(cell))).toEqual(cell);
    expect(pyramidCellIds(SD, 15)).toHaveLength(16);
    expect(pyramidCellIds(SD, 15).at(-1)).toBe('0/0/0');
    expect(parsePyramidCellId('3/8/0')).toBeNull();
  });

  it('wraps the 3×3 block across the date line and stops at the poles', () => {
    const east = pyramidBlock({ latitude: 0, longitude: 179.99 }, 4);
    expect(east).toHaveLength(9);
    expect(east).toContain('4/0/8');
    expect(pyramidBlock({ latitude: 89.99, longitude: 0 }, 4)).toHaveLength(6);
  });

  it('stops at the first level whose block holds C people, and climbs for a lone person', () => {
    const crowd = new Map<string, number>();
    for (const id of pyramidCellIds(SD, 15)) crowd.set(id, 600);
    const dense = pyramidSearch({ point: SD, finestLevel: 15, target: 498, count: (id) => crowd.get(id) ?? 0 });
    expect(dense).toHaveLength(1);

    // One person in Los Angeles, nobody else until the San Diego crowd is inside the block.
    const counts = new Map<string, number>(crowd);
    for (const id of pyramidCellIds(LA, 15)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const lone = pyramidSearch({ point: LA, finestLevel: 15, target: 498, count: (id) => counts.get(id) ?? 0, self: 1 });
    expect(lone.length).toBeGreaterThan(5);
    expect(lone.at(-1)!.people).toBeGreaterThanOrEqual(498);
    expect(lone.slice(0, -1).every((step) => step.people < 498)).toBe(true);
  });
});

describe('Nearby v3 cards', () => {
  let pair: SeaSigningPair;
  beforeAll(async () => { pair = await SEA.pair() as SeaSigningPair; });

  it('verifies a signed card and rejects tampering, an expired card and an over-long lifetime', async () => {
    const now = new Date(NOW);
    const signed = await createNearbyCard({ userId: 'u1', pair, point: SD, lifetimeMs: LIFETIME, now });
    expect(await verifyNearbyCard(signed, { maxLifetimeMs: LIFETIME, now })).toEqual({ ok: true, card: signed });
    expect((await verifyNearbyCard({ ...signed, point: LA }, { maxLifetimeMs: LIFETIME, now })).ok).toBe(false);
    expect((await verifyNearbyCard({ ...signed, scope: 'place:cafe' }, { maxLifetimeMs: LIFETIME, now })).ok).toBe(false);
    expect((await verifyNearbyCard(signed, { maxLifetimeMs: LIFETIME, now: new Date(NOW + LIFETIME + 1) })).ok).toBe(false);
    expect((await verifyNearbyCard(signed, { maxLifetimeMs: LIFETIME / 2, now })).ok).toBe(false);
    await expect(createNearbyCard({
      userId: 'u1', pair, point: { latitude: 32.7157, longitude: -117.1611, precisionMeters: 1_000 }, lifetimeMs: LIFETIME,
    })).rejects.toThrow('public grid centre');
  });
});

describe('Nearby v3 list', () => {
  it('ranks nearer people first, then by the owner\'s own hash order, and keeps only C', () => {
    const list = new NearbyList(owner('me'), { capacity: 3 });
    list.merge([card('la', LA), card('a', SD), card('b', SD), card('c', SD_NEXT)], NOW);
    const pubs = list.entries().map((entry) => entry.card.pub);
    expect(pubs).toHaveLength(3);
    expect(pubs).not.toContain('la');
    expect(pubs.at(-1)).toBe('c');
    const sameSquare = ['a', 'b'].sort((x, y) => (nearbyRankTie('me', x, BEACON) < nearbyRankTie('me', y, BEACON) ? -1 : 1));
    expect(pubs.slice(0, 2)).toEqual(sameSquare);
    expect(publicPointDistanceMeters(SD, SD)).toBe(0);
  });

  it('keeps the freshest copy, drops expired cards and removes a person who stopped answering', () => {
    const list = new NearbyList(owner('me'), { capacity: 10 });
    list.merge([card('a', SD, NOW - 60_000), card('b', SD, NOW - LIFETIME + 1_000)], NOW);
    expect(list.merge([card('a', SD, NOW - 120_000)], NOW).refreshed).toBe(0);
    expect(list.merge([card('a', SD, NOW)], NOW).refreshed).toBe(1);
    expect(list.prune(NOW + 2_000)).toBe(1);
    expect(list.remove('a')).toBe(true);
    expect(list.size).toBe(0);
    list.merge([card('me', SD), card('x', SD, NOW, 'place:cafe')], NOW);
    expect(list.size).toBe(0);
  });

  it('says which incoming cards are useful: new and good enough, or fresher', () => {
    const list = new NearbyList(owner('me'), { capacity: 2 });
    list.merge([card('a', SD), card('b', SD_NEXT)], NOW);
    const useful = list.useful([card('la', LA), card('a', SD, NOW - 1), card('b', SD_NEXT, NOW + 1), card('c', SD)], NOW + 1);
    expect(useful.map((entry) => entry.pub).sort()).toEqual(['b', 'c']);
  });

  it('offers a partner its own card, then what the partner lacks, best first by the partner\'s order', () => {
    const sender = new NearbyList(owner('s'), { capacity: 10 });
    sender.merge([card('a', SD), card('b', SD), card('c', SD_NEXT), card('la', LA), card('r', SD)], NOW);
    const receiver = new NearbyList(owner('r'), { capacity: 10 });
    receiver.merge([card('a', SD)], NOW);
    const digest = receiver.digest(NOW);
    expect(parseNearbyDigest(digest, NOW).size).toBe(1);
    const own = card('s', SD);
    const offer = sender.offerFor({
      receiver: owner('r'), digest, ownCard: own, swapCards: 3, refreshMs: NEARBY_V3_DEFAULTS.cardRefreshMs, nowMs: NOW,
    });
    expect(offer[0]).toBe(own);
    expect(offer.map((entry) => entry.pub)).not.toContain('a');
    expect(offer.map((entry) => entry.pub)).not.toContain('r');
    const expected = ['b', 'c'];
    expect(offer.slice(1).map((entry) => entry.pub)).toEqual(expected);

    // A copy the receiver holds is sent again only when the sender's is much fresher.
    const later = NOW + NEARBY_V3_DEFAULTS.cardRefreshMs + 120_000;
    sender.merge([card('a', SD, later)], later);
    const refresh = sender.offerFor({
      receiver: owner('r'), digest, ownCard: null, swapCards: 10, refreshMs: NEARBY_V3_DEFAULTS.cardRefreshMs, nowMs: later,
    });
    expect(refresh.map((entry) => entry.pub)).toContain('a');
  });

  it('ranks a Place list by hash order alone and empties on a scope change', () => {
    const scope = 'place:cafe' as const;
    const list = new NearbyList(owner('me', SD, scope), { capacity: 10 });
    list.merge([card('far', LA, NOW, scope), card('near', SD, NOW, scope)], NOW);
    const expected = ['far', 'near'].sort((x, y) => (nearbyRankTie('me', x, BEACON) < nearbyRankTie('me', y, BEACON) ? -1 : 1));
    expect(list.entries().map((entry) => entry.card.pub)).toEqual(expected);
    list.setOwner(owner('me', SD));
    expect(list.size).toBe(0);
  });
});
