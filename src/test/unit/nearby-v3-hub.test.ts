/**
 * Nearby v3 hub (§3.7 "The hub: counts and introductions, not lists") and the production list code
 * converging by gossip from the hub's introductions — the same check as the model's unit gate
 * (nearby-gossip-personal-lists.test.ts), on the real modules.
 */
import SEA from 'gun/sea';
import { buildLinkAttestation, type LinkCrypto } from '../../shared/identity-linking';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';
import { NEARBY_V3_DEFAULTS, type NearbyV3Config } from '../../shared/nearby-v3-config';
import { createNearbyCard, nearbyCountAnchor, type NearbyCard } from '../../shared/nearby-v3-card';
import { nearbyDailyBeacon, publicPointDistanceMeters } from '../../shared/nearby-v3-ranking';
import { NearbyList } from '../../shared/nearby-v3-list';
import { pyramidCellIds } from '../../shared/nearby-v3-pyramid';
import { NearbyV3Hub } from '../../server/services/nearby-v3-hub';
import { seededRandom } from '../support/seeded-random';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);

function config(overrides: Partial<NearbyV3Config> = {}): NearbyV3Config {
  return { ...NEARBY_V3_DEFAULTS, ...overrides };
}

function linkCrypto(pair: SeaSigningPair): LinkCrypto {
  return {
    sign: async (data) => String(await SEA.sign(data, pair)),
    verify: async (data, signature, pub) => await SEA.verify(signature, pub) === data,
    hash: async (data) => String(await SEA.work(data, null, null, { name: 'SHA-256' })),
    randomSecret: () => 'not-used',
  };
}

function card(pub: string, point: PublicLocation, issuedAtMs = NOW, scope: NearbyCard['scope'] = 'nearby'): NearbyCard {
  return {
    version: 1,
    kind: 'nearby-card',
    userId: `user-${pub}`,
    pub,
    countKey: pub,
    scopeRevision: issuedAtMs,
    point,
    traveler: false,
    scope,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + NEARBY_V3_DEFAULTS.cardLifetimeMs).toISOString(),
    proof: { pub } as NearbyCard['proof'],
  };
}

describe('Nearby v3 hub', () => {
  it('verifies heartbeats and counts two unlinked devices separately even with one login id', async () => {
    const hub = new NearbyV3Hub(config(), NOW);
    const pair = await SEA.pair() as SeaSigningPair;
    const now = new Date(NOW);
    const signed = await createNearbyCard({ userId: 'u1', pair, point: SD, lifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs, now });
    await hub.heartbeat(signed, now);
    await hub.heartbeat(signed, now);
    expect(hub.online(NOW)).toBe(1);
    expect(hub.count(pyramidCellIds(SD, 15)[0]!, NOW)).toBe(1);
    await expect(hub.heartbeat({ ...signed, point: LA }, now)).rejects.toThrow();
    const thief = await createNearbyCard({ userId: 'u1', pair: await SEA.pair() as SeaSigningPair, point: SD, lifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs, now });
    await expect(hub.heartbeat(thief, now)).resolves.toMatchObject({ online: 2, nearby: 1 });
  });

  it('keeps a lease for two heartbeat periods after the last heartbeat, then expires it', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    const window = NEARBY_V3_DEFAULTS.cardReissueMs;
    const start = Math.floor(NOW / window) * window;
    expect(hub.online(start + window + 1)).toBe(1);
    expect(hub.online(start + 2 * window + 1)).toBe(0);
  });

  it('answers which users are online: a heartbeat within two reissue periods, by user id only', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    hub.ingest(card('b', LA, NOW, 'place:cafe'), NOW);
    expect(hub.onlineUserIds(['user-a', 'user-b', 'user-nobody'], NOW + 1)).toEqual(['user-a', 'user-b']);
    const stale = NOW + 2 * NEARBY_V3_DEFAULTS.cardReissueMs + 1;
    expect(hub.onlineUserIds(['user-a', 'user-b'], stale)).toEqual([]);
  });

  it('reports the whole local crowd separately from the global online total', () => {
    const hub = new NearbyV3Hub(config({ capacity: 3 }), NOW);
    for (let index = 0; index < 14; index += 1) hub.ingest(card(`sd-${index}`, SD), NOW);
    for (let index = 0; index < 6; index += 1) hub.ingest(card(`la-${index}`, LA), NOW);

    const result = hub.ingest(card('sd-0', SD), NOW + 1);
    expect(result).toMatchObject({ nearby: 13, online: 20 });
    const losAngelesResult = hub.ingest(card('la-0', LA), NOW + 2);
    expect(losAngelesResult).toMatchObject({ nearby: 5, online: 20 });
  });

  it('uses each viewer\'s selected blurred cell when precision choices differ', () => {
    const hub = new NearbyV3Hub(config({ capacity: 1 }), NOW);
    const regional = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 50_000);
    const closeNorth = snapPublicLocation({
      latitude: regional.latitude + 0.01,
      longitude: regional.longitude,
    }, 400);
    const closeSouth = snapPublicLocation({
      latitude: regional.latitude - 0.01,
      longitude: regional.longitude,
    }, 400);
    hub.ingest(card('regional', regional), NOW);
    hub.ingest(card('north', closeNorth), NOW);
    hub.ingest(card('south', closeSouth), NOW);

    expect(hub.ingest(card('regional', regional), NOW + 1)).toMatchObject({ nearby: 2, online: 3 });
    expect(hub.ingest(card('north', closeNorth), NOW + 1)).toMatchObject({ nearby: 1, online: 3 });
  });

  it('counts a mutually linked device pair once and keeps it live until both writers leave', async () => {
    const hub = new NearbyV3Hub(config({ capacity: 3 }), NOW);
    const first = await SEA.pair() as SeaSigningPair;
    const second = await SEA.pair() as SeaSigningPair;
    const anchor = nearbyCountAnchor(first.pub, second.pub) === first.pub ? first : second;
    const member = anchor === first ? second : first;
    const secret = 'one-explicit-link-secret';
    const memberToAnchor = await buildLinkAttestation({
      selfPub: member.pub,
      peerPub: anchor.pub,
      secret,
      crypto: linkCrypto(member),
      now: NOW,
    });
    const anchorToMember = await buildLinkAttestation({
      selfPub: anchor.pub,
      peerPub: member.pub,
      secret,
      crypto: linkCrypto(anchor),
      now: NOW,
    });
    const now = new Date(NOW);
    const anchorCard = await createNearbyCard({
      userId: 'same-person-anchor', pair: anchor, point: SD, scopeRevision: 10,
      lifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs, now,
    });
    const memberCard = await createNearbyCard({
      userId: 'same-person-member', pair: member, point: SD, scopeRevision: 10,
      countIdentity: {
        countKey: anchor.pub,
        proof: { version: 1, anchorPub: anchor.pub, memberToAnchor, anchorToMember },
      },
      lifetimeMs: NEARBY_V3_DEFAULTS.cardLifetimeMs,
      now,
    });

    await expect(hub.heartbeat(anchorCard, now)).resolves.toMatchObject({ online: 1, nearby: 0 });
    await expect(hub.heartbeat(memberCard, now)).resolves.toMatchObject({ online: 1, nearby: 0 });
    expect(hub.countRevision(NOW)).toBe(1);
    await expect(hub.leave(memberCard, now)).resolves.toMatchObject({ online: 1, countRevision: 1 });
    await expect(hub.leave(anchorCard, now)).resolves.toMatchObject({ online: 0, countRevision: 2 });
  });

  it('atomically moves one lease and rejects stale or conflicting scope revisions', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    const nearby = { ...card('a', SD), scopeRevision: 10 };
    const place = { ...card('a', SD, NOW + 1, 'place:cafe'), scopeRevision: 11 };
    expect(hub.ingest(nearby, NOW)).toMatchObject({ online: 1, countRevision: 1 });
    expect(hub.ingest(place, NOW + 1)).toMatchObject({ online: 1, nearby: 1, countRevision: 2 });
    expect(hub.placeCounts(NOW + 1)).toEqual([{ placeId: 'cafe', count: 1 }]);
    expect(() => hub.ingest(nearby, NOW + 2)).toThrow('stale Nearby scope revision');
    expect(() => hub.ingest({ ...place, point: LA }, NOW + 2)).toThrow('conflicting Nearby scope');
    expect(hub.online(NOW + 2)).toBe(1);
    expect(hub.countRevision(NOW + 2)).toBe(2);
  });

  it('stops introducing a phone that missed two heartbeats, although its card is still valid', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    const later = NOW + 2 * NEARBY_V3_DEFAULTS.cardReissueMs + 1;
    expect(later).toBeLessThan(NOW + NEARBY_V3_DEFAULTS.cardLifetimeMs);
    expect(hub.introductions({ point: SD, now: new Date(NOW + 1) }).cards).toHaveLength(1);
    expect(hub.introductions({ point: SD, now: new Date(later) }).cards).toHaveLength(0);
  });

  it('keeps bounded per-cell samples and uses wider pyramid cells for the sparse fallback', () => {
    const hub = new NearbyV3Hub(config({ capacity: 20, hubCellSample: 8 }), NOW);
    for (let i = 0; i < 30; i += 1) hub.ingest(card(`sd${i}`, SD), NOW);
    hub.ingest(card('la', LA), NOW);
    const intro = hub.introductions({ point: LA, excludePub: 'la', now: new Date(NOW) });
    expect(intro.online).toBe(31);
    expect(intro.cards.length).toBeGreaterThan(0);
    expect(intro.cards.every((entry) => entry.pub.startsWith('sd'))).toBe(true);
    expect(intro.steps.at(-1)!.people).toBeGreaterThanOrEqual(20);
    // In the crowd itself the first block is enough.
    const local = hub.introductions({ point: SD, now: new Date(NOW) });
    expect(local.steps).toHaveLength(1);
    expect(local.cards.length).toBeGreaterThanOrEqual(8);
    expect(local.cards.length).toBeLessThanOrEqual(8 * 9);
  });

  it('keeps Places separate from Nearby and shows heat cells for a map view', () => {
    const active: string[] = [];
    const hub = new NearbyV3Hub(config(), NOW, (placeId) => active.push(placeId));
    hub.ingest(card('a', SD), NOW);
    hub.ingest(card('b', SD, NOW, 'place:cafe'), NOW);
    // Everyone online counts once, whichever list they are on; a Place's count feeds the room list.
    expect(hub.online(NOW)).toBe(2);
    expect(hub.placeCounts(NOW)).toEqual([{ placeId: 'cafe', count: 1 }]);
    expect(active).toEqual(['cafe']);
    expect(hub.introductions({ point: SD, scope: 'place:cafe', now: new Date(NOW) }).cards.map((entry) => entry.pub)).toEqual(['b']);
    expect(hub.introductions({ point: SD, now: new Date(NOW) }).cards.map((entry) => entry.pub)).toEqual(['a']);
    const stats = hub.stats({ west: -118, south: 32, east: -116, north: 34 }, NOW);
    expect(stats.heat).toEqual([expect.objectContaining({ count: 1 })]);
    expect(hub.stats({ west: 0, south: 0, east: 10, north: 10 }, NOW).heat).toEqual([]);
  });
});

describe('Nearby v3 hub when a card moves between lists', () => {
  const intro = (hub: NearbyV3Hub, scope?: string) =>
    hub.introductions({ point: SD, ...(scope ? { scope } : {}), now: new Date(NOW + 2_000) }).cards.map((entry) => entry.pub);

  it('stops introducing me where I was as soon as I heartbeat somewhere else', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    hub.ingest(card('b', SD), NOW);
    // a enters a Place: she is introduced there, and no longer in Nearby.
    hub.ingest(card('a', SD, NOW + 1_000, 'place:cafe'), NOW + 1_000);
    expect(intro(hub, 'place:cafe')).toEqual(['a']);
    expect(intro(hub)).toEqual(['b']);
    // …and back home: out of the Place's sample at once.
    hub.ingest(card('a', SD, NOW + 2_000), NOW + 2_000);
    expect(intro(hub, 'place:cafe')).toEqual([]);
    expect(intro(hub).sort()).toEqual(['a', 'b']);
    // Moving to another city leaves the old cells and the old city's local introductions too.
    hub.ingest(card('a', LA, NOW + 3_000), NOW + 3_000);
    const fine = pyramidCellIds(SD, NEARBY_V3_DEFAULTS.pyramidFinestLevel)[0]!;
    expect(hub.count(fine, NOW + 3_000)).toBe(1); // only b remains in San Diego
    expect(hub.introductions({ point: LA, now: new Date(NOW + 3_000) }).cards.map((entry) => entry.pub)).toContain('a');
  });

  it('counts me in a Place I enter mid-window, and once in the online total', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    hub.ingest(card('a', SD, NOW + 1_000, 'place:cafe'), NOW + 1_000);
    expect(hub.placeCounts(NOW + 1_000)).toEqual([{ placeId: 'cafe', count: 1 }]);
    expect(hub.online(NOW + 1_000)).toBe(1);
    // Back home: the Place is empty at once, not two count windows later (phone-path J-PLACE-11).
    hub.ingest(card('a', SD, NOW + 2_000), NOW + 2_000);
    expect(hub.placeCounts(NOW + 2_000)).toEqual([]);
  });
});

describe('Nearby v3 lists converge by gossip from the hub\'s introductions', () => {
  it('reaches the true nearest-C distance band within a few periods', () => {
    const C = 32;
    const cfg = config({ capacity: C, hubCellSample: 16, swapCards: 12 });
    const random = seededRandom(7);
    const beacon = nearbyDailyBeacon(NOW);
    // 300 people in and around San Diego (a few km), all inside the local Nearby radius.
    const points: PublicLocation[] = [];
    for (let i = 0; i < 300; i += 1) {
      points.push(snapPublicLocation({ latitude: 32.70 + random() * 0.08, longitude: -117.20 + random() * 0.08 }, 1_000));
    }
    const pubs = points.map((_, i) => `p${i}`);
    const hub = new NearbyV3Hub(cfg, NOW);
    const lists = points.map((point, i) => new NearbyList({ pub: pubs[i]!, point, scope: 'nearby', beacon }, { capacity: C }));
    const cards = points.map((point, i) => card(pubs[i]!, point));
    // Everyone arrives at once (the hardest start): heartbeat, then ask for introductions.
    cards.forEach((entry) => hub.ingest(entry, NOW));
    lists.forEach((list, i) => list.merge(hub.introductions({ point: points[i]!, excludePub: pubs[i]!, now: new Date(NOW) }).cards, NOW));

    const quality = () => {
      let total = 0;
      points.forEach((point, i) => {
        const distances = points.filter((_, j) => j !== i).map((other) => publicPointDistanceMeters(point, other)).sort((a, b) => a - b);
        const cutoff = distances[C - 1]!;
        const inBand = lists[i]!.entries().filter((entry) => publicPointDistanceMeters(point, entry.card.point) <= cutoff).length;
        total += Math.min(1, inBand / C);
      });
      return total / points.length;
    };

    const start = quality();
    let rounds = 0;
    let nowMs = NOW;
    while (quality() < 0.95 && rounds < 20) {
      rounds += 1;
      nowMs += cfg.gossipPeriodMs;
      for (let i = 0; i < lists.length; i += 1) {
        const list = lists[i]!;
        if (!list.size) continue;
        const partner = list.entries()[Math.floor(random() * list.size)]!.card.pub;
        const j = pubs.indexOf(partner);
        const other = lists[j]!;
        const toPartner = list.offerFor({
          receiver: other.ownerInfo, digest: other.digest(nowMs), ownCard: cards[i]!, swapCards: cfg.swapCards, refreshMs: cfg.cardRefreshMs, nowMs,
        });
        const toMe = other.offerFor({
          receiver: list.ownerInfo, digest: list.digest(nowMs), ownCard: cards[j]!, swapCards: cfg.swapCards, refreshMs: cfg.cardRefreshMs, nowMs,
        });
        other.merge(other.useful(toPartner, nowMs), nowMs);
        list.merge(list.useful(toMe, nowMs), nowMs);
      }
    }
    expect(start).toBeLessThan(0.95);
    expect(quality()).toBeGreaterThanOrEqual(0.95);
    expect(rounds).toBeLessThanOrEqual(10);
    expect(lists.every((list) => list.size === C)).toBe(true);
  });
});
