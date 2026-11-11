/** @jest-environment node */

// Nearby encounters and Place visits as chained graph events (OPEN-110 slice 2, REQ-GRAPH-49
// nearby half): an encounter is a chained event with `with` → the person, a visit with `place` →
// the place's state node; both take the blurred-cell `where` through the locator path and keep the
// exact point in the private gps/<eventId> sidecar only. The place/outing state nodes are written
// once, a repeat inside the window writes no new event, ix/cell/<region>/ev lists every
// where-carrying event and rebuilds after a wipe, the chain verifies, and a where-carrying event
// trims like any other.

import { randomBytes } from 'crypto';
import SEA from 'gun/sea';
import { verifyChain } from '../../core/device-graph/chain';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { rebuildIndexes } from '../../core/device-graph/events';
import { readIndex } from '../../core/device-graph/index-buckets';
import type { GpsPoint } from '../../core/device-graph/location-graph';
import { NEARBY_REPEAT_WINDOW_MS } from '../../core/device-graph/nearby-events';
import { linkSoul, memoryNodeStore, type GraphNode } from '../../core/device-graph/node-store';
import { personSoul } from '../../core/device-graph/people-graph';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { trimHistory } from '../../core/device-graph/trim';
import { createGraphHost } from '../../core/device-graph/sync/graph-host';
import { portableEcdsaSign, portableEcdsaVerify } from '../../shared/portable-ecdsa';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(30_000);

type SeaPair = { pub: string; priv: string; epub: string; epriv: string };

// Golden Gate Park, San Francisco — far from any test-default location.
const POINT: GpsPoint = { latitude: 37.7694, longitude: -122.4862, accuracy: 12, source: 'gps' };
const DAY = 86_400_000;

const tennis = () => ({
  title: 'Tennis partner', type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [
      { id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' },
      { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_1', text: 'How often do you play?', answers: [
      { id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true },
      { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true },
    ] },
  ],
});

async function setup(options: { locate?: () => Promise<GpsPoint | undefined>; now?: () => number; chain?: boolean } = {}) {
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, {
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    ...(options.locate ? { locate: options.locate } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const pair = (await (SEA as any).pair()) as SeaPair;
  const signer = { sign: (message: string) => portableEcdsaSign(message, pair.priv), pub: pair.pub };
  if (options.chain !== false) graph.setChain(signer);
  const souls = graphSouls(graph.prefix);
  return { store, graph, pair, signer, souls };
}

const readEvents = async (store: ReturnType<typeof memoryNodeStore>, souls: ReturnType<typeof graphSouls>) => {
  const out: Array<{ id: string; event: GraphNode }> = [];
  for (const entry of await readIndex(store, souls.index('day'))) {
    const event = await store.get(entry.target);
    if (event) out.push({ id: entry.key, event });
  }
  return out;
};

describe('Nearby encounters and Place visits as events (REQ-GRAPH-49)', () => {

  it('an encounter is a chained event with `with` and the blurred-cell `where`; the exact point stays in the gps sidecar', async () => {
    const { store, graph, souls } = await setup({ locate: async () => POINT });
    const talkEventId = `1700000000000-${'a'.repeat(32)}-0`;
    const eventId = await graph.nearby.recordEncounter({ personUserId: 'zoe', re: talkEventId });

    const event = (await store.get(souls.event(eventId)))!;
    expect(linkSoul(event.with)).toBe(personSoul(graph.prefix, 'zoe'));
    expect(linkSoul(event.re)).toBe(souls.event(talkEventId));
    // `re` must be a real event id — it becomes a Gun link (a fresh person: the dedupe window
    // above would return the standing event before validation).
    await expect(graph.nearby.recordEncounter({ personUserId: 'rex', re: 'not/an/event' })).rejects.toThrow('invalid encounter re');
    const region = linkSoul(event.where)?.slice(`${graph.prefix}cell/`.length);
    expect(region).toMatch(/^cell_/);
    // Chained like an arrival: mine (no `by`), first seq on this device.
    expect(event.by).toBeUndefined();
    expect(event.seq).toBe(0);
    expect(typeof event.sig).toBe('string');
    // The exact point is only in the private sidecar, nowhere on the event.
    expect(await store.get(`${graph.prefix}gps/${eventId}`)).toMatchObject({ latitude: POINT.latitude, longitude: POINT.longitude, source: 'gps' });
    expect(JSON.stringify(event)).not.toContain(String(POINT.latitude));
    // The person is known now; a first encounter for someone new writes their node once.
    expect(await store.get(personSoul(graph.prefix, 'zoe'))).toMatchObject({ userId: 'zoe' });
    expect((await readIndex(store, souls.index('person/zoe/ev'))).map((entry) => entry.key)).toContain(eventId);
  });

  it('a visit links the place, creates its state node once with the cell anchor, and an outing once', async () => {
    const { store, graph, souls } = await setup({ locate: async () => POINT });
    const first = await graph.nearby.recordVisit({ placeId: 'cafe-blue', name: 'Blue Café', outingId: 'outing-1' });

    const event = (await store.get(souls.event(first)))!;
    expect(linkSoul(event.place)).toBe(`${graph.prefix}place/cafe-blue`);
    expect(linkSoul(event.outing)).toBe(`${graph.prefix}outing/outing-1`);
    const cell = linkSoul(event.where);
    expect(cell).toContain(`${graph.prefix}cell/`);

    const place = (await store.get(`${graph.prefix}place/cafe-blue`))!;
    expect(place.name).toBe('Blue Café');
    expect(linkSoul(place.anchor)).toBe(cell);
    expect(typeof place.firstSeen).toBe('number');
    const outing = (await store.get(`${graph.prefix}outing/outing-1`))!;
    expect(typeof outing.startedAt).toBe('number');
    expect(outing.endedAt).toBeUndefined(); // its end is the outing feature's, later
  });

  it('a second visit never overwrites the place node', async () => {
    let clock = 1_000_000_000;
    const { store, graph } = await setup({ locate: async () => POINT, now: () => clock });
    await graph.nearby.recordVisit({ placeId: 'cafe-blue', name: 'Blue Café' });
    clock += NEARBY_REPEAT_WINDOW_MS + 1_000;
    await graph.nearby.recordVisit({ placeId: 'cafe-blue', name: 'Renamed Café' });
    const place = (await store.get(`${graph.prefix}place/cafe-blue`))!;
    expect(place.name).toBe('Blue Café');
    expect(place.firstSeen).toBe(1_000_000_000);
  });

  it('two encounters with the same person inside the window write one event; after the window, a second', async () => {
    let clock = 2_000_000_000;
    const { graph } = await setup({ locate: async () => POINT, now: () => clock });
    const first = await graph.nearby.recordEncounter({ personUserId: 'zoe' });
    const repeat = await graph.nearby.recordEncounter({ personUserId: 'zoe' });
    expect(repeat).toBe(first);
    clock += NEARBY_REPEAT_WINDOW_MS + 1_000;
    const later = await graph.nearby.recordEncounter({ personUserId: 'zoe' });
    expect(later).not.toBe(first);
    // The visit window dedupes the same way, keyed by place.
    const visitA = await graph.nearby.recordVisit({ placeId: 'park' });
    expect(await graph.nearby.recordVisit({ placeId: 'park' })).toBe(visitA);
    clock += NEARBY_REPEAT_WINDOW_MS + 1_000;
    expect(await graph.nearby.recordVisit({ placeId: 'park' })).not.toBe(visitA);
  });

  it('ix/cell/<region>/ev lists the where-carrying events, and rebuildIndexes restores it after a wipe', async () => {
    const { store, graph, souls } = await setup({ locate: async () => POINT });
    const encounter = await graph.nearby.recordEncounter({ personUserId: 'zoe' });
    const visit = await graph.nearby.recordVisit({ placeId: 'cafe-blue' });
    const region = linkSoul((await store.get(souls.event(encounter)))!.where)!.slice(`${graph.prefix}cell/`.length);
    const cellList = souls.index(`cell/${region}/ev`);
    expect((await readIndex(store, cellList)).map((entry) => entry.key).sort()).toEqual([encounter, visit].sort());

    // Wipe the cell index and rebuild: the entries come back from the events' `where` (§31.8).
    const directory = (await store.get(cellList))!;
    for (const value of Object.values(directory)) {
      const bucketSoul = linkSoul(value);
      const bucket = bucketSoul ? await store.get(bucketSoul) : null;
      if (bucketSoul && bucket) await store.put(bucketSoul, Object.fromEntries(Object.keys(bucket).map((key) => [key, null])));
    }
    await store.put(cellList, Object.fromEntries(Object.keys(directory).map((key) => [key, null])));
    expect(await readIndex(store, cellList)).toEqual([]);

    await rebuildIndexes(store, {});
    expect((await readIndex(store, cellList)).map((entry) => entry.key).sort()).toEqual([encounter, visit].sort());
    // A second rebuild has nothing left to repair.
    expect((await rebuildIndexes(store, {})).repaired).toBe(0);
  });

  it('a Talk version carrying where is never cell-indexed — not at write, not after a rebuild', async () => {
    const { store, graph, souls } = await setup({ locate: async () => POINT });
    const talkId = await graph.talks.create(tennis());
    const event = (await store.get(souls.event(talkId)))!;
    const region = linkSoul(event.where)?.slice(`${graph.prefix}cell/`.length);
    expect(region).toMatch(/^cell_/); // the locator stamped it, exactly like an encounter…

    // …but the Talk shape is not cell-indexed at write time (only encounters/visits are)…
    const cellList = souls.index(`cell/${region}/ev`);
    expect(await readIndex(store, cellList)).toEqual([]);
    // …and a rebuild does not invent an entry for it either (write/rebuild symmetry).
    await rebuildIndexes(store, {});
    expect(await readIndex(store, cellList)).toEqual([]);
  });

  it('the chain verifies after several records', async () => {
    const { store, graph, pair, souls } = await setup({ locate: async () => POINT });
    await graph.nearby.recordEncounter({ personUserId: 'zoe' });
    await graph.nearby.recordVisit({ placeId: 'cafe-blue', name: 'Blue Café' });
    await graph.nearby.recordEncounter({ personUserId: 'ann' });

    const result = await verifyChain(store, souls, { verify: portableEcdsaVerify },
      { pub: pair.pub, deviceId: await graph.ids.deviceId() }, () => readEvents(store, souls));
    expect(result).toMatchObject({ ok: true, checked: 3 });
  });

  it('a where-carrying encounter event trims cleanly (checkpoint first, fields and gps nulled)', async () => {
    const BASE = Date.parse('2026-11-06T12:00:00Z');
    let clock = BASE;
    const { store, graph, signer, souls } = await setup({ locate: async () => POINT, now: () => clock });
    const eventId = await graph.nearby.recordEncounter({ personUserId: 'zoe' });

    clock = BASE + 40 * DAY; // past the 30-day keep window
    const usage = async () => {
      let total = 0;
      for (const soul of store.souls()) total += JSON.stringify(await store.get(soul)).length;
      return total;
    };
    const result = await trimHistory(store, souls, signer, {
      usage, limitBytes: Math.floor((await usage()) / 0.92), now: () => clock, allSouls: async () => store.souls(),
    });
    expect(result.checkpoint).toBeDefined();
    expect(result.events).toBe(1);
    const trimmed = (await store.get(souls.event(eventId)))!;
    expect(trimmed.with ?? null).toBeNull();
    expect(trimmed.where ?? null).toBeNull();
    expect((await store.get(`${graph.prefix}gps/${eventId}`))?.latitude).toBeNull();
    // The cell index entry went with it.
    expect((await readIndex(store, souls.index('day'))).length).toBe(0);
    expect(await readIndex(store, souls.index('person/zoe/ev'))).toEqual([]);
  });

  it('the graph.recordEncounter and graph.recordVisit host requests record events', async () => {
    const { store, graph, souls } = await setup({ locate: async () => POINT });
    const crypto = {
      secret: async (epub: string, pair: any) => (await (SEA as any).secret(epub, pair)) || undefined,
      encrypt: async (data: unknown, key: string) => String(await (SEA as any).encrypt(data, key)),
      decrypt: async (data: unknown, key: string) => (SEA as any).decrypt(data, key),
      sign: portableEcdsaSign, verify: portableEcdsaVerify,
      randomHex: (bytes: number) => randomBytes(bytes).toString('hex'),
    };
    // No identity/link needed: recording is local-only, so a bare host answers both requests.
    const host = createGraphHost({ gun: {} as any, store, graph, crypto });

    const encounter = (await host.handle({ name: 'graph.recordEncounter', personUserId: 'zoe' })) as { eventId: string };
    expect(linkSoul((await store.get(souls.event(encounter.eventId)))!.with)).toBe(personSoul(graph.prefix, 'zoe'));
    const history = await host.handle({ name: 'graph.personHistory', userId: 'zoe' }) as Array<Record<string, unknown>>;
    expect(history).toEqual([expect.objectContaining({
      eventId: encounter.eventId,
      kind: 'encounter',
      withUserId: 'zoe',
    })]);
    const visit = (await host.handle({ name: 'graph.recordVisit', placeId: 'cafe-blue', placeName: 'Blue Café' })) as { eventId: string };
    expect(linkSoul((await store.get(souls.event(visit.eventId)))!.place)).toBe(`${graph.prefix}place/cafe-blue`);
    expect((await store.get(`${graph.prefix}place/cafe-blue`))!.name).toBe('Blue Café');
  });

  it('persists ranked Nearby scopes and builds the tab snapshot only from graph indexes', async () => {
    const { store, graph } = await setup({ locate: async () => POINT });
    const crypto = {
      secret: async (epub: string, pair: any) => (await (SEA as any).secret(epub, pair)) || undefined,
      encrypt: async (data: unknown, key: string) => String(await (SEA as any).encrypt(data, key)),
      decrypt: async (data: unknown, key: string) => (SEA as any).decrypt(data, key),
      sign: portableEcdsaSign, verify: portableEcdsaVerify,
      randomHex: (bytes: number) => randomBytes(bytes).toString('hex'),
    };
    const host = createGraphHost({ gun: {} as any, store, graph, crypto });
    const talkId = await graph.talks.create(tennis());
    const edited = await graph.talks.edit(talkId, { ...tennis(), title: 'Tennis this weekend' });
    await graph.messages.importMessage('me', {
      conversationId: 'dm-zoe', otherUserId: 'zoe', sourceMessageId: 'message-1',
      senderId: 'zoe', text: 'Saturday?', when: Date.now(),
    });
    expect(await host.handle({
      name: 'graph.recordConversation', conversationId: 'dm-zoe', otherUserId: 'zoe', talkIds: [talkId],
    })).toMatchObject({ talks: 1 });
    await host.handle({ name: 'graph.recordConversation', conversationId: 'dm-zoe', otherUserId: 'zoe' });

    expect(await host.handle({
      name: 'graph.recordNearbyScope', scopeId: 'nearby-v3', kind: 'home',
      members: [{ userId: 'zoe', online: true }, { userId: 'max' }, { userId: 'zoe' }],
    })).toMatchObject({ members: 2 });
    const scope = (await store.get(`${graph.prefix}mine/nearby/nearby-v3`))!;
    const scopeMembers = (await store.get(linkSoul(scope.members)!))!;
    expect(linkSoul(scopeMembers.zoe)).toBe(personSoul(graph.prefix, 'zoe'));
    expect(linkSoul(scopeMembers.max)).toBe(personSoul(graph.prefix, 'max'));

    const snapshot = await host.handle({ name: 'graph.tabSnapshot' }) as any;
    expect(snapshot.talks).toEqual([expect.objectContaining({
      talkId, versionId: edited, versionHistory: [edited, talkId],
      talk: expect.objectContaining({ title: 'Tennis this weekend', graphVersionId: edited }),
    })]);
    expect(snapshot.conversations).toEqual([expect.objectContaining({
      conversationId: 'dm-zoe', otherUserId: 'zoe', lastMessage: 'Saturday?', talkIds: [talkId],
    })]);
    expect(snapshot.people).toEqual([expect.objectContaining({
      userId: 'zoe', conversationIds: ['dm-zoe'],
    })]);
    expect(snapshot.nearbyScopes).toEqual([{
      scopeId: 'nearby-v3', kind: 'home', updatedAt: expect.any(Number),
      members: [
        { userId: 'zoe', online: true, rank: 0 },
        { userId: 'max', online: false, rank: 1 },
      ],
    }]);
  });
});
