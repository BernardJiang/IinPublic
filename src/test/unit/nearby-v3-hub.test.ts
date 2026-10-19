/**
 * Nearby v3 hub (§3.7 "The hub: counts and introductions, not lists") and the production list code
 * converging by gossip from the hub's introductions — the same check as the model's unit gate
 * (nearby-gossip-personal-lists.test.ts), on the real modules.
 */
import SEA from 'gun/sea';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';
import { NEARBY_V3_DEFAULTS, type NearbyV3Config } from '../../shared/nearby-v3-config';
import { createNearbyCard, type NearbyCard } from '../../shared/nearby-v3-card';
import { nearbyDailyBeacon, publicPointDistanceMeters } from '../../shared/nearby-v3-ranking';
import { NearbyList } from '../../shared/nearby-v3-list';
import { pyramidCellIds } from '../../shared/nearby-v3-pyramid';
import { NearbyV3Hub } from '../../server/services/nearby-v3-hub';
import { seededRandom } from '../support/nearby-capacity-model';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);

function config(overrides: Partial<NearbyV3Config> = {}): NearbyV3Config {
  return { ...NEARBY_V3_DEFAULTS, ...overrides };
}

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
    expiresAt: new Date(issuedAtMs + NEARBY_V3_DEFAULTS.cardLifetimeMs).toISOString(),
    proof: { pub } as NearbyCard['proof'],
  };
}

describe('Nearby v3 hub', () => {
  it('verifies heartbeats, counts each key once per window and binds a userId to one key', async () => {
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
    await expect(hub.heartbeat(thief, now)).rejects.toThrow('held by another key');
  });

  it('keeps counts for one full window after the last heartbeat, then forgets them', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    const window = NEARBY_V3_DEFAULTS.cardReissueMs;
    const start = Math.floor(NOW / window) * window;
    expect(hub.online(start + window + 1)).toBe(1);
    expect(hub.online(start + 2 * window + 1)).toBe(0);
  });

  it('keeps a bounded sample per cell and introduces a newcomer to the nearest crowd', () => {
    const hub = new NearbyV3Hub(config({ capacity: 20, hubCellSample: 8 }), NOW);
    for (let i = 0; i < 30; i += 1) hub.ingest(card(`sd${i}`, SD), NOW);
    hub.ingest(card('la', LA), NOW);
    const intro = hub.introductions({ point: LA, excludePub: 'la', now: new Date(NOW) });
    expect(intro.online).toBe(31);
    expect(intro.cards.map((entry) => entry.pub)).not.toContain('la');
    expect(intro.cards.length).toBeGreaterThanOrEqual(8);
    expect(intro.cards.length).toBeLessThanOrEqual(8 * 9 * intro.steps.length);
    expect(intro.steps.at(-1)!.people).toBeGreaterThanOrEqual(20);
    // In the crowd itself the first block is enough.
    expect(hub.introductions({ point: SD, now: new Date(NOW) }).steps).toHaveLength(1);
  });

  it('keeps Places separate from Nearby and shows heat cells for a map view', () => {
    const hub = new NearbyV3Hub(config(), NOW);
    hub.ingest(card('a', SD), NOW);
    hub.ingest(card('b', SD, NOW, 'place:cafe'), NOW);
    expect(hub.online(NOW)).toBe(1);
    expect(hub.introductions({ point: SD, scope: 'place:cafe', now: new Date(NOW) }).cards.map((entry) => entry.pub)).toEqual(['b']);
    expect(hub.introductions({ point: SD, now: new Date(NOW) }).cards.map((entry) => entry.pub)).toEqual(['a']);
    const stats = hub.stats({ west: -118, south: 32, east: -116, north: 34 }, NOW);
    expect(stats.heat).toEqual([expect.objectContaining({ count: 1 })]);
    expect(hub.stats({ west: 0, south: 0, east: 10, north: 10 }, NOW).heat).toEqual([]);
  });
});

describe('Nearby v3 lists converge by gossip from the hub\'s introductions', () => {
  it('reaches the true nearest-C distance band within a few periods', () => {
    const C = 32;
    const cfg = config({ capacity: C, hubCellSample: 16, swapCards: 12 });
    const random = seededRandom(7);
    const beacon = nearbyDailyBeacon(NOW);
    // 240 people in and around San Diego (a few km), 60 scattered across Southern California.
    const points: PublicLocation[] = [];
    for (let i = 0; i < 240; i += 1) {
      points.push(snapPublicLocation({ latitude: 32.70 + random() * 0.08, longitude: -117.20 + random() * 0.08 }, 1_000));
    }
    for (let i = 0; i < 60; i += 1) {
      points.push(snapPublicLocation({ latitude: 32.5 + random() * 2.5, longitude: -119 + random() * 3 }, 1_000));
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
