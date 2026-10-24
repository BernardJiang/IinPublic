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
  NEARBY_V3_GROUPS_STORAGE_KEY,
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
  let linkReady = true;
  let hubDown = false;
  const posted: NearbyCard[] = [];
  const link: NearbyV3Link = {
    ready: () => linkReady,
    async request(to, message) {
      const phone = phones.get(to.pub);
      const from = (message as { card?: NearbyCard }).card?.pub ?? '';
      // An offline phone reaches no one, and no one reaches it.
      if (!phone?.online || phones.get(from)?.online === false) return null;
      if (dropNext > 0) {
        dropNext -= 1;
        return null;
      }
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
        async heartbeat(card) {
          if (hubDown || !phone.online) throw new Error('hub unreachable');
          heartbeats.push(card.pub);
          hub.ingest(card, nowMs);
        },
        async introductions(input) {
          if (hubDown || !phone.online) throw new Error('hub unreachable');
          return hub.introductions({ ...input, now: new Date(nowMs) }).cards;
        },
      },
      link,
      // The board as Gun peered over a LAN: every other phone reads what one posts.
      localBoard: {
        post(card) {
          posted.push(card);
          for (const other of phones.values()) if (other !== phone && other.online) void other.service.localCard(card);
        },
        watch() {},
      },
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
    /** The hub cannot be reached (no Internet). */
    setHubDown(down: boolean) { hubDown = down; },
    posted,
    /** The mesh is between rooms: nothing can be sent. */
    setLinkReady(ready: boolean) { linkReady = ready; },
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
    expect(p2.service.entries()).toEqual([]);
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

  it('never holds more than C, and a move to another point starts at group 1 again', async () => {
    const net = network(config({ capacity: 4 }), Array.from({ length: 12 }, () => SD));
    for (let i = 0; i < 6; i += 1) await net.round();
    const p0 = net.phones.get('p0')!;
    expect(p0.service.entries()).toHaveLength(4);
    await p0.service.meetNewPeople();
    for (let i = 0; i < 6; i += 1) await net.round();
    expect(p0.service.entries()).toHaveLength(4); // a new group, not a bigger one
    expect(p0.service.groupInfo().group).toBe(2);
    p0.position = { ...p0.position, point: LA };
    await p0.service.refresh();
    expect(p0.service.groupInfo().group).toBe(1);
  });

  it('does not count swaps it could not send while the mesh was between rooms, and announces after', async () => {
    // Found on real phones (native-app/38): right after re-entering Nearby the mesh had not joined
    // yet, both announce swaps "failed" in 0 ms, and a live person was dropped and tombstoned.
    const net = network(config(), [SD, SD]);
    const p0 = net.phones.get('p0')!;
    const p1 = net.phones.get('p1')!;
    await p0.service.tick();
    net.setLinkReady(false);
    await p1.service.refresh();
    expect(p1.service.stats().failedSwaps).toBe(0);
    expect(p0.service.entries()).toHaveLength(0);
    net.setLinkReady(true);
    await p1.service.tick();
    expect(p1.service.entries().map((entry) => entry.card.pub)).toEqual(['p0']);
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
  });

  it('takes back a dropped person at once when they reach me directly (proof they are alive)', async () => {
    const net = network(config(), [SD, SD]);
    for (const phone of net.phones.values()) await phone.service.tick();
    const p0 = net.phones.get('p0')!;
    const p1 = net.phones.get('p1')!;
    p0.service.reportUnreachable('p1');
    expect(p0.service.entries()).toHaveLength(0);
    // The same card from the hub stays out (the tombstone)…
    await p0.service.offerCard({ ...p1.service.card()!, pub: 'p1' }).catch(() => undefined);
    // …offerCard is a knock, i.e. p1 itself: that is direct contact, so p1 is back.
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
    p0.service.reportUnreachable('p1');
    await p1.service.gossipNow(); // p1 swaps with p0
    expect(p0.service.entries().map((entry) => entry.card.pub)).toEqual(['p1']);
  });

  it('finds people nearby without the hub through the local board, and stops posting once it is back', async () => {
    const net = network(config(), [SD, SD, SD]);
    net.setHubDown(true);
    const [p0, p1, p2] = ['p0', 'p1', 'p2'].map((pub) => net.phones.get(pub)!);
    for (const phone of [p0, p1, p2]) await phone!.service.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const phone of [p0, p1, p2]) {
      expect(phone!.service.isHubReachable()).toBe(false);
      expect(phone!.service.entries().map((entry) => entry.card.pub).sort()).toEqual(
        ['p0', 'p1', 'p2'].filter((pub) => pub !== phone!.service.card()!.pub),
      );
    }
    const postsWhileOffline = net.posted.length;
    expect(postsWhileOffline).toBeGreaterThanOrEqual(3);
    net.setHubDown(false);
    net.advance(NEARBY_V3_DEFAULTS.cardReissueMs);
    for (const phone of [p0, p1, p2]) await phone!.service.tick();
    expect(p0.service.isHubReachable()).toBe(true);
    net.advance(NEARBY_V3_DEFAULTS.gossipPeriodMs);
    for (const phone of [p0, p1, p2]) await phone!.service.tick();
    expect(net.posted.length).toBe(postsWhileOffline);
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

  it('a phone back from an outage rejoins at once, not at the next reissue (native-app/13)', async () => {
    const net = network(config(), [SD, SD, SD]);
    const [p0, p1, p2] = ['p0', 'p1', 'p2'].map((pub) => net.phones.get(pub)!);
    for (const phone of [p0, p1, p2]) await phone.service.tick();
    for (const phone of [p0, p1, p2]) await phone.service.tick();
    const listOf = (phone: Phone) => phone.service.entries().map((entry) => entry.card.pub).sort();
    expect(listOf(p1)).toEqual(['p0', 'p2']);

    // p0 loses its network: the others find it silent, and it finds them silent.
    p0.online = false;
    for (let i = 0; i < 12 && (listOf(p0).length || listOf(p1).includes('p0') || listOf(p2).includes('p0')); i += 1) {
      net.advance(NEARBY_V3_DEFAULTS.gossipPeriodMs);
      for (const phone of [p0, p1, p2]) await phone.service.tick();
    }
    expect(listOf(p0)).toEqual([]);
    expect(listOf(p1)).toEqual(['p2']);
    await p0.service.tick(); // an empty list asks the hub, which it cannot reach
    expect(p0.service.isHubReachable()).toBe(false);

    // Back online, well inside one reissue period: two passes put everyone back on every list.
    p0.online = true;
    net.advance(1_000);
    await p0.service.tick();
    await p0.service.tick();
    expect(p0.service.isHubReachable()).toBe(true);
    expect(listOf(p0)).toEqual(['p1', 'p2']);
    expect(listOf(p1)).toEqual(['p0', 'p2']);
    expect(listOf(p2)).toEqual(['p0', 'p1']);
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

describe('leaving a Place while a swap hangs (phone-path J-PLACE-11)', () => {
  it('posts my new card at once instead of after the swaps time out', async () => {
    const nowMs = START;
    const cfg = config();
    const hub = new HubStore(cfg, nowMs);
    const other = await fakeSign({ userId: 'user-o', pair: { pub: 'o' } as SeaSigningPair, point: SD, scope: 'place:cafe', lifetimeMs: cfg.cardLifetimeMs, now: new Date(nowMs) });
    hub.ingest(other, nowMs);
    const pending: Array<() => void> = [];
    let left = false;
    let position: NearbyV3Position = { point: SD, traveler: false, scope: 'place:cafe' };
    const service = new NearbyV3Service({
      config: () => cfg,
      identity: () => ({ userId: 'user-me', pair: { pub: 'me', priv: 'x' } as SeaSigningPair }),
      position: () => position,
      hub: {
        async heartbeat(card) { hub.ingest(card, nowMs); },
        async introductions(input) { return hub.introductions({ ...input, now: new Date(nowMs) }).cards; },
      },
      // The other person has left: the announce swap hangs until its timeout.
      link: { request: () => (left ? Promise.resolve(null) : new Promise((resolve) => { pending.push(() => resolve(null)); })) },
      sign: fakeSign as never,
      verify: async () => true,
      now: () => nowMs,
      log: () => undefined,
    });
    const placeIntro = () => hub.introductions({ point: SD, scope: 'place:cafe', now: new Date(nowMs) }).cards.map((card) => card.pub);

    const entering = service.tick(); // posts my Place card, finds o, announces (and hangs)
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(placeIntro()).toContain('me');

    position = { point: SD, traveler: false, scope: 'nearby' };
    const leaving = service.refresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(placeIntro()).not.toContain('me');
    expect(service.card()?.scope).toBe('nearby');

    left = true;
    pending.forEach((resolve) => resolve());
    await Promise.all([entering, leaving]);
  });
});

describe('a page whose mesh joins Nearby only when the list pushes its roster (stage2/01)', () => {
  it('pushes the roster while waiting for the mesh, so the search is not stuck', async () => {
    let nowMs = START;
    const hub = new HubStore(NEARBY_V3_DEFAULTS, nowMs);
    const searches: number[] = [];
    let meshJoined = false;
    const service = new NearbyV3Service({
      config: () => NEARBY_V3_DEFAULTS,
      identity: () => ({ userId: 'user-me', pair: { pub: 'me', priv: 'x' } as SeaSigningPair }),
      position: () => ({ point: SD, traveler: false, scope: 'nearby' }),
      hub: {
        async heartbeat(card) { hub.ingest(card, nowMs); },
        async introductions(input) { searches.push(nowMs); return hub.introductions({ ...input, now: new Date(nowMs) }).cards; },
      },
      // The app's mesh joins Nearby when the roster (my list) is pushed: onChange below.
      link: { ready: () => meshJoined, request: async () => null },
      onChange: () => { meshJoined = true; },
      sign: fakeSign as never,
      verify: async () => true,
      now: () => nowMs,
      log: () => undefined,
    });
    await service.tick();
    nowMs += 1_000;
    await service.tick();
    expect(meshJoined).toBe(true);
    // Searched on both ticks: nobody else is around, so the empty list asks the hub again.
    expect(searches.length).toBeGreaterThan(0);
  });
});

describe('meeting new people in groups (§3.7)', () => {
  /** Run passes until every list stops changing. */
  async function settle(net: ReturnType<typeof network>, rounds = 12): Promise<void> {
    for (let i = 0; i < rounds; i += 1) await net.round();
  }
  const listOf = (phone: Phone) => phone.service.entries().map((entry) => entry.card.pub).sort();

  it('swaps the whole group for the next C people until everyone was met, then goes back to group 1', async () => {
    // Seven people in one square (an arena in miniature) and C = 2: my order has six others. The
    // hub's sample holds them all (a real cell samples 64; this harness heartbeats in a fixed order,
    // so a smaller sample would always be the same few).
    const net = network(config({ capacity: 2, hubCellSample: 8 }), Array.from({ length: 7 }, () => SD));
    const me = net.phones.get('p0')!;
    await settle(net);
    const group1 = listOf(me);
    expect(group1).toHaveLength(2);
    expect(me.service.groupInfo()).toEqual({ group: 1, exhausted: false });

    const met = new Set(group1);
    for (const group of [2, 3]) {
      expect(await me.service.meetNewPeople()).toBe(true);
      await settle(net);
      const people = listOf(me);
      expect(me.service.groupInfo()).toEqual({ group, exhausted: false });
      expect(people).toHaveLength(2);
      for (const pub of people) expect(met.has(pub)).toBe(false); // nobody from an earlier group
      for (const pub of people) met.add(pub);
    }
    expect(met.size).toBe(6); // groups 1–3 covered everyone

    // Past the last group: nobody left, and the bar can say so.
    expect(await me.service.meetNewPeople()).toBe(true);
    await settle(net);
    expect(listOf(me)).toEqual([]);
    expect(me.service.groupInfo()).toEqual({ group: 4, exhausted: true });
    expect(await me.service.meetNewPeople()).toBe(false); // nothing to move on from

    await me.service.backToFirstGroup();
    await settle(net);
    expect(me.service.groupInfo()).toEqual({ group: 1, exhausted: false });
    expect(listOf(me)).toEqual(group1);
  });

  it('keeps the group across a restart the same day, and starts over at group 1 the next day', async () => {
    const cfg = config({ capacity: 2, hubCellSample: 8 });
    const net = network(cfg, Array.from({ length: 5 }, () => SD));
    const me = net.phones.get('p0')!;
    await settle(net);
    const group1 = listOf(me);
    await me.service.meetNewPeople();
    await settle(net);
    const group2 = listOf(me);
    expect(JSON.parse(me.storage.get(NEARBY_V3_GROUPS_STORAGE_KEY) || '{}')).not.toEqual({});

    // Restart: a new service on the same storage is still in group 2 and keeps group 1 off its list.
    me.online = false;
    const restarted = net.add('p0', SD, me.storage);
    await settle(net);
    expect(restarted.service.groupInfo().group).toBe(2);
    expect(listOf(restarted).some((pub) => group1.includes(pub))).toBe(false);
    expect(listOf(restarted)).toEqual(group2);

    // A new day reorders everyone: group 1 again.
    net.advance(24 * 3_600_000);
    await settle(net);
    expect(restarted.service.groupInfo()).toEqual({ group: 1, exhausted: false });
    expect(listOf(restarted)).toHaveLength(2);
  });

  it('a Place and Nearby keep their own group', async () => {
    const net = network(config({ capacity: 1, hubCellSample: 8 }), Array.from({ length: 4 }, () => SD));
    const me = net.phones.get('p0')!;
    await settle(net);
    await me.service.meetNewPeople();
    await settle(net);
    expect(me.service.groupInfo().group).toBe(2);
    for (const phone of net.phones.values()) phone.position = { ...phone.position, scope: 'place:cafe' };
    await settle(net);
    expect(me.service.groupInfo().group).toBe(1);
    for (const phone of net.phones.values()) phone.position = { ...phone.position, scope: 'nearby' };
    await settle(net);
    expect(me.service.groupInfo().group).toBe(2);
  });
});
