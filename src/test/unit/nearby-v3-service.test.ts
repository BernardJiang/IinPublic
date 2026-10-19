/**
 * NearbyV3Service: the phone side of Nearby v3 (§3.7) — card reissue and hub heartbeat, hub
 * introductions only when the list must start over, gossip swaps over an injected link, dropping a
 * person who does not answer, the incoming limit, and the saved list across a restart.
 */
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';
import { NEARBY_V3_DEFAULTS, type NearbyV3Config } from '../../shared/nearby-v3-config';
import type { NearbyCard } from '../../shared/nearby-v3-card';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { NearbyV3Hub as HubStore } from '../../server/services/nearby-v3-hub';
import {
  NEARBY_V3_STORAGE_KEY,
  NearbyV3Service,
  type NearbyV3Link,
  type NearbyV3Position,
} from '../../web/services/nearby-v3-service';
import { seededRandom } from '../support/seeded-random';

const START = Date.parse('2026-10-19T12:00:00Z');
const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);

/** Unsigned cards: the test injects `sign` and `verify`, so no SEA keys are needed. */
const fakeSign = async (input: {
  userId: string; pair: SeaSigningPair; stageName?: string; point: PublicLocation; traveler?: boolean; scope?: NearbyCard['scope']; lifetimeMs: number; now?: Date;
}): Promise<NearbyCard> => {
  const now = input.now ?? new Date();
  return {
    version: 1,
    kind: 'nearby-card',
    userId: input.userId,
    pub: input.pair.pub,
    ...(input.stageName ? { stageName: input.stageName } : {}),
    point: input.point,
    traveler: input.traveler === true,
    scope: input.scope ?? 'nearby',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.lifetimeMs).toISOString(),
    proof: { pub: input.pair.pub, timestamp: now.toISOString() } as NearbyCard['proof'],
  };
};

type Phone = { service: NearbyV3Service; position: NearbyV3Position; online: boolean; storage: Map<string, string>; stageName?: string };

function network(config: NearbyV3Config, points: PublicLocation[], options: { seed?: number } = {}) {
  let nowMs = START;
  const hub = new HubStore(config, nowMs);
  const phones = new Map<string, Phone>();
  const heartbeats: string[] = [];
  const random = seededRandom(options.seed ?? 3);
  let dropNext = 0;
  const link: NearbyV3Link = {
    async request(to, message) {
      const phone = phones.get(to.pub);
      if (!phone?.online) return null;
      if (dropNext > 0) {
        dropNext -= 1;
        return null;
      }
      const from = (message as { card?: NearbyCard }).card?.pub ?? '';
      return phone.service.handleMessage(from, JSON.parse(JSON.stringify(message)));
    },
  };
  const add = (pub: string, point: PublicLocation, storage = new Map<string, string>()) => {
    const phone = { position: { point, traveler: false, scope: 'nearby' as const }, online: true, storage } as Phone;
    phone.service = new NearbyV3Service({
      config: () => config,
      identity: () => ({
        userId: `user-${pub}`,
        pair: { pub, priv: 'x' } as SeaSigningPair,
        ...(phone.stageName ? { stageName: phone.stageName } : {}),
      }),
      position: () => phone.position,
      hub: {
        async heartbeat(card) { heartbeats.push(card.pub); hub.ingest(card, nowMs); },
        async introductions(input) { return hub.introductions({ ...input, now: new Date(nowMs) }).cards; },
      },
      link,
      sign: fakeSign as never,
      verify: async (card) => (card as NearbyCard).proof?.pub === (card as NearbyCard).pub,
      storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
      now: () => nowMs,
      random,
      log: () => undefined,
    });
    phones.set(pub, phone);
    return phone;
  };
  points.forEach((point, i) => add(`p${i}`, point));
  return {
    hub,
    phones,
    heartbeats,
    add,
    advance(ms: number) { nowMs += ms; },
    /** The next `count` swap requests get no answer (a link still opening, a busy phone). */
    dropRequests(count: number) { dropNext = count; },
    now: () => nowMs,
    async round() {
      nowMs += config.gossipPeriodMs;
      for (const phone of phones.values()) if (phone.online) await phone.service.tick();
    },
  };
}

function config(overrides: Partial<NearbyV3Config> = {}): NearbyV3Config {
  return { ...NEARBY_V3_DEFAULTS, capacity: 8, hubCellSample: 4, swapCards: 6, ...overrides };
}

describe('NearbyV3Service', () => {
  it('heartbeats a signed card, starts from the hub\'s introductions and fills the list by gossip', async () => {
    const points = Array.from({ length: 20 }, () => SD);
    const net = network(config(), points);
    for (const phone of net.phones.values()) await phone.service.tick();
    expect(net.hub.online(net.now())).toBe(20);
    for (let i = 0; i < 6; i += 1) await net.round();
    for (const phone of net.phones.values()) expect(phone.service.entries()).toHaveLength(8);
  });

  it('reissues its card only when due or when the point changes, and searches again after a move', async () => {
    const cfg = config();
    const net = network(cfg, [SD, SD, LA]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p2 = net.phones.get('p2')!;
    expect(net.heartbeats.filter((pub) => pub === 'p2')).toHaveLength(1);
    await net.round();
    expect(net.heartbeats.filter((pub) => pub === 'p2')).toHaveLength(1);
    net.advance(cfg.cardReissueMs);
    await p2.service.tick();
    expect(net.heartbeats.filter((pub) => pub === 'p2')).toHaveLength(2);
    expect(p2.service.entries().map((entry) => entry.card.pub).sort()).toEqual(['p0', 'p1']);
    p2.position = { ...p2.position, point: SD };
    await p2.service.refresh();
    expect(net.heartbeats.filter((pub) => pub === 'p2')).toHaveLength(3);
    expect(p2.service.card()!.point).toEqual(SD);
    expect(p2.service.entries()[0]!.key.distanceMeters).toBe(0);
  });

  it('announces a newcomer to the three nearest people at once', async () => {
    const net = network(config(), [SD, SD, SD, SD]);
    const [p0, p1, p2, p3] = ['p0', 'p1', 'p2', 'p3'].map((pub) => net.phones.get(pub)!);
    // The first three know each other; the fourth arrives later.
    for (const phone of [p0, p1, p2]) await phone.service.tick();
    for (const phone of [p0, p1, p2]) await phone.service.tick();
    await p3!.service.tick();
    for (const phone of [p0, p1, p2]) {
      expect(phone!.service.entries().map((entry) => entry.card.pub)).toContain('p3');
    }
  });

  it('sends a renamed card to the nearest person at once, not at the next period', async () => {
    const net = network(config(), [SD, SD]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p0 = net.phones.get('p0')!;
    const p1 = net.phones.get('p1')!;
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
    // Renamed seconds after boot (found by web e2e 00e): the peer showed the boot-time name.
    net.advance(1_000);
    p1.stageName = 'JerryOv';
    await p1.service.refresh();
    expect(p0.service.entries()[0]!.card.stageName).toBe('JerryOv');
  });

  it('puts a knocker on the list from the card in the knock, before any link is up', async () => {
    const net = network(config(), [SD]);
    const p0 = net.phones.get('p0')!;
    await p0.service.tick();
    expect(p0.service.entries()).toHaveLength(0);
    const knocker = net.add('k', SD);
    p0.online = false; // the knocker's own announce cannot reach p0: the link is not up yet
    await knocker.service.tick();
    p0.online = true;
    expect(p0.service.entries()).toHaveLength(0);
    await p0.service.offerCard(knocker.service.card()!);
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['k']);
  });

  it('keeps a person after one silent swap, and drops them after two in a row', async () => {
    // Found by web e2e isolated-02: under load a swap that had to open a new link timed out, and
    // dropping at once emptied six live phones' lists one by one.
    const net = network(config({ capacity: 1 }), [SD, SD]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p0 = net.phones.get('p0')!;
    net.dropRequests(1);
    await p0.service.gossipNow();
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
    net.dropRequests(2);
    await p0.service.gossipNow();
    expect(p0.service.entries()).toHaveLength(0);
  });

  it('drops a person who stops answering', async () => {
    const net = network(config({ capacity: 1 }), [SD, SD]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p0 = net.phones.get('p0')!;
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
    net.phones.get('p1')!.online = false;
    await net.round();
    expect(p0.service.entries()).toHaveLength(0);
  });

  it('does not take back a person who stopped answering until they sign a newer card', async () => {
    const cfg = config({ capacity: 1 });
    const net = network(cfg, [SD, SD]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p0 = net.phones.get('p0')!;
    net.phones.get('p1')!.online = false;
    await net.round();
    expect(p0.service.entries()).toHaveLength(0);
    // The hub still has p1's card (within two reissue periods): p0's empty list asks again.
    await p0.service.tick();
    expect(p0.service.entries()).toHaveLength(0);
    // p1 comes back and signs a new card: p0 takes it.
    net.phones.get('p1')!.online = true;
    net.advance(cfg.cardReissueMs);
    await net.phones.get('p1')!.service.tick();
    await p0.service.tick();
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
  });

  it('answers "busy" past its incoming limit', async () => {
    const net = network(config({ incomingConnections: 1 }), [SD, SD]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p0 = net.phones.get('p0')!.service;
    const own = net.phones.get('p1')!.service.card()!;
    const request = { kind: 'nearby-gossip-request', version: 1, card: own, digest: { version: 1, at: net.now(), entries: '' } };
    const [first, second] = await Promise.all([p0.handleMessage('p1', request), p0.handleMessage('p1', request)]);
    expect(first?.kind).toBe('nearby-gossip-reply');
    expect(second?.kind).toBe('nearby-gossip-busy');
    expect(await p0.handleMessage('someone-else', request)).toBeNull();
  });

  it('keeps its list across a restart', async () => {
    const net = network(config(), [SD, SD, SD]);
    await net.round();
    await net.round();
    const p0 = net.phones.get('p0')!;
    expect(JSON.parse(p0.storage.get(NEARBY_V3_STORAGE_KEY)!).cards).toHaveLength(2);
    // Restart while the hub has forgotten everyone: the saved list is still there.
    net.hub.clear(net.now());
    const restarted = net.add('p0', SD, p0.storage);
    await restarted.service.tick();
    expect(restarted.service.entries().map((entry) => entry.card.pub).sort()).toEqual(['p1', 'p2']);
  });
});
