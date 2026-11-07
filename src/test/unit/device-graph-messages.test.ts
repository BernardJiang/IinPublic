/** @jest-environment node */

// Chat messages as chained graph events over the pair log (OPEN-110 slice 1, REQ-GRAPH-49 message
// half): the sender's own event is chained with `by` → itself, the receiver writes its own private
// event with its own clock and a `re` link to the sender's event, the conversation's state node is
// created once on each side, `ix/conv/<id>` reads the messages in order, a repeated delivery writes
// one event, the receiver's signed ack covers the message entry, `rebuildIndexes` puts the
// conversation indexes back, and a message event trims like any other event.

import { randomBytes } from 'crypto';
import Gun from 'gun';
import SEA from 'gun/sea';
import { installSharingPolicy } from '../../core/sharing-policy';
import { createAnswerGraph } from '../../core/device-graph/answers';
import { createArrivalGraph } from '../../core/device-graph/arrivals';
import { verifyChain } from '../../core/device-graph/chain';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { createEventIdSource } from '../../core/device-graph/event-id';
import { rebuildIndexes } from '../../core/device-graph/events';
import { readIndex } from '../../core/device-graph/index-buckets';
import { gunNodeStore, linkSoul } from '../../core/device-graph/node-store';
import { personSoul } from '../../core/device-graph/people-graph';
import { createTalkGraph } from '../../core/device-graph/talk-events';
import { canonicalJson } from '../../core/device-graph/keys';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { trimHistory } from '../../core/device-graph/trim';
import { createGraphHost } from '../../core/device-graph/sync/graph-host';
import { createGraphSync, type GraphCrypto, type SeaPair } from '../../core/device-graph/sync/graph-sync';
import { portableEcdsaSign, portableEcdsaVerify } from '../../shared/portable-ecdsa';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(60_000);

const crypto: GraphCrypto = {
  secret: async (epub, pair) => (await (SEA as any).secret(epub, pair)) || undefined,
  encrypt: async (data, key) => String(await (SEA as any).encrypt(data, key)),
  decrypt: async (data, key) => (SEA as any).decrypt(data, key),
  sign: portableEcdsaSign,
  verify: portableEcdsaVerify,
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
};

const souls = graphSouls('local/');
const HUB = 'https://hub.example/gun';
const keys = new Map<string, { pub: string; epub: string }>();
const devices: any[] = [];

async function device(userId: string) {
  const pair = (await (SEA as any).pair()) as SeaPair;
  keys.set(userId, { pub: pair.pub, epub: pair.epub });
  const gun = (Gun as any)({ peers: [], sharingRelayPeers: [HUB], localStorage: false, radisk: false, memoryStore: true, axe: false, multicast: false });
  gun._.opt.peers[HUB] = { id: HUB, url: HUB, wire: { send: () => undefined } };
  const store = gunNodeStore(gun, { missWaitMs: 60, readWaitMs: 10 });
  let saved: { deviceId?: string; counter?: number } = {};
  const ids = createEventIdSource({ state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(randomBytes(n)) });
  const graph = { talks: createTalkGraph(store, ids), arrivals: createArrivalGraph(store, ids), answers: createAnswerGraph(store, ids) };
  const chain = { sign: (message: string) => portableEcdsaSign(message, pair.priv), pub: pair.pub };
  const sync = createGraphSync({
    gun, store, me: { userId, pair }, crypto, graph, ids, chain, remoteReadMs: 150,
    peerKeys: async (id) => keys.get(id),
  });
  await sync.start();
  const d = { userId, pair, gun, store, graph, ids, chain, sync };
  devices.push(d);
  return d;
}

// Moves Gun messages between linked devices, as the page does over a WebRTC data channel.
let pumping = true;
async function pump() {
  while (pumping) {
    for (const from of devices) {
      for (const { to, raw } of await from.sync.pull(0)) {
        const target = devices.find((d) => d.userId === to);
        if (target?.sync.openLinks().includes(from.userId)) target.sync.hear(from.userId, raw);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const until = async (check: () => Promise<boolean> | boolean, ms = 15_000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out');
};

/** A storage adapter that answers every read, found or not, as Radisk does. */
function installMemoryStore(G: any) {
  G.on('create', function (this: any, root: any) {
    this.to.next(root);
    if (!root.opt.memoryStore) return;
    const disk = new Map<string, any>();
    root.on('put', function (this: any, msg: any) {
      this.to.next(msg);
      if (msg._?.rad) return;
      const p = msg.put;
      const node = disk.get(p['#']) || { _: { '#': p['#'], '>': {} } };
      node[p['.']] = p[':'];
      node._['>'][p['.']] = p['>'];
      disk.set(p['#'], node);
      root.on('in', { '@': msg['#'], ok: 1 });
    });
    root.on('get', function (this: any, msg: any) {
      this.to.next(msg);
      const soul = msg.get?.['#'];
      if (typeof soul !== 'string') return;
      const node = disk.get(soul);
      const faith: any = function () { /* from storage */ };
      faith.faith = true;
      faith.rad = msg.get;
      root.on('in', { '@': msg['#'], put: node ? { [soul]: JSON.parse(JSON.stringify(node)) } : undefined, _: faith });
    });
  });
}

beforeAll(() => { installSharingPolicy(Gun); installMemoryStore(Gun); });
afterAll(() => { pumping = false; for (const d of devices) d.gun.off?.(); });

const convEntries = (d: any, conv: string) => readIndex(d.store, souls.index(`conv/${conv}`));

describe('chat messages as chained graph events', () => {

  it('sends: my chained event and the conv node; the receiver writes its own event and acks it', async () => {
    const [adam, eve] = [await device('adam-m1'), await device('eve-m1')];
    void pump();
    await Promise.all([adam.sync.open('eve-m1'), eve.sync.open('adam-m1')]);

    const started = Date.now();
    const { eventId } = await adam.sync.sendMessage('eve-m1', 'c-1', 'hello eve');

    // My chained event: §31.5's `by, with, conv, text`, `conv` a link to the conv state node.
    const mine = (await adam.store.get(souls.event(eventId)))!;
    expect(mine.v).toBe(1);
    expect(linkSoul(mine.by)).toBe(personSoul('local/', 'adam-m1'));
    expect(linkSoul(mine.with)).toBe(personSoul('local/', 'eve-m1'));
    expect(linkSoul(mine.conv)).toBe(souls.mine('conv/c-1'));
    expect(mine.text).toBe('hello eve');
    expect(mine.seq).toBe(0); // chained (ownBy): my first event on this device
    expect(typeof mine.sig).toBe('string');
    expect(mine.device).toBe(await adam.ids.deviceId());

    // The conv state node is created once and never overwritten.
    const convNode = (await adam.store.get(souls.mine('conv/c-1')))!;
    expect(linkSoul(convNode.with)).toBe(personSoul('local/', 'eve-m1'));
    expect(typeof convNode.startedAt).toBe('number');
    await adam.sync.sendMessage('eve-m1', 'c-1', 'again');
    expect((await adam.store.get(souls.mine('conv/c-1')))!.startedAt).toBe(convNode.startedAt);
    expect((await convEntries(adam, 'c-1')).length).toBe(2);
    expect((await adam.store.get(souls.index('convs')))!['c-1']).toBeDefined();

    // The receiver applies: its OWN private event, its own clock, no `by`, `re` → my event.
    await until(async () => (await convEntries(eve, 'c-1')).length === 2);
    const receivedId = (await convEntries(eve, 'c-1'))[1]!.key; // oldest first = first message
    const received = (await eve.store.get(souls.event(receivedId)))!;
    expect(received.by).toBeUndefined();
    expect(linkSoul(received.with)).toBe(personSoul('local/', 'adam-m1'));
    expect(linkSoul(received.conv)).toBe(souls.mine('conv/c-1'));
    expect(received.text).toBe('hello eve');
    expect(linkSoul(received.re)).toBe(souls.event(eventId));
    expect(typeof received.seq).toBe('number'); // the receiver's own chain covers it
    expect(Math.abs(Number(received.when) - Date.now())).toBeLessThan(30_000);
    expect(Number(received.when)).toBeGreaterThanOrEqual(started - 1_000);
    expect(linkSoul((await eve.store.get(souls.mine('conv/c-1')))!.with)).toBe(personSoul('local/', 'adam-m1'));

    // The signed ack covers the message entry (n 0 and 1: two sends) and clears what Adam owed.
    await until(() => !adam.sync.owed().includes('eve-m1'));
    const sent = (await adam.store.get('local/sync/out/eve-m1'))!;
    expect(sent.n).toBe(1);
    const ack = JSON.parse(String((await adam.store.get(souls.index('ack/eve-m1')))!['1']));
    expect(ack.n).toBe(1);
    expect(ack.hash).toBe(sent.hash);
    expect(await portableEcdsaVerify(ack.sig, canonicalJson({ n: ack.n, hash: ack.hash, when: ack.when }), keys.get('eve-m1')!.pub)).toBe(true);
    expect((await adam.sync.status('eve-m1')).lastAck?.n).toBe(1);
  });

  it('reads chained messages in order, and a repeated delivery writes one event', async () => {
    const [adam, eve] = [await device('adam-m2'), await device('eve-m2')];
    await Promise.all([adam.sync.open('eve-m2'), eve.sync.open('adam-m2')]);

    const first = await adam.sync.sendMessage('eve-m2', 'c-2', 'one');
    const second = await adam.sync.sendMessage('eve-m2', 'c-2', 'two', first.eventId);

    // The sender's second event chains to the first through `re`.
    expect(linkSoul((await adam.store.get(souls.event(second.eventId)))!.re)).toBe(souls.event(first.eventId));

    await until(async () => (await convEntries(eve, 'c-2')).length === 2);
    // Newest first from the bucketed index; the receiver's own ids order by its clock.
    const entries = await convEntries(eve, 'c-2');
    const texts = await Promise.all(entries.map((entry) => eve.store.get(entry.target).then((e: any) => e.text)));
    expect(texts).toEqual(['two', 'one']);
    // Each received event names the sender's event it came from.
    expect(linkSoul((await eve.store.get(entries[0]!.target))!.re)).toBe(souls.event(second.eventId));
    expect(linkSoul((await eve.store.get(entries[1]!.target))!.re)).toBe(souls.event(first.eventId));

    // A repeated delivery (the in-state reset, the whole log re-read) writes no second event.
    await eve.store.put('local/sync/in/adam-m2', { next: 0, hash: '' });
    await eve.sync.catchUp('adam-m2');
    await until(async () => Number((await eve.store.get('local/sync/in/adam-m2'))?.next) === 2);
    expect((await convEntries(eve, 'c-2')).length).toBe(2);
  });

  it('rebuildIndexes puts ix/conv, ix/convs and the dedupe marker back after the index is wiped', async () => {
    const [adam, eve] = [await device('adam-m3'), await device('eve-m3')];
    await Promise.all([adam.sync.open('eve-m3'), eve.sync.open('adam-m3')]);
    await adam.sync.sendMessage('eve-m3', 'c-3', 'rebuild me');
    await until(async () => (await convEntries(eve, 'c-3')).length === 1);
    const before = await convEntries(eve, 'c-3');

    // Wipe everything the message write put under ix/.
    const listSoul = souls.index('conv/c-3');
    const directory = (await eve.store.get(listSoul))!;
    for (const value of Object.values(directory)) {
      const bucketSoul = linkSoul(value);
      const node = bucketSoul ? await eve.store.get(bucketSoul) : null;
      if (bucketSoul && node) await eve.store.put(bucketSoul, Object.fromEntries(Object.keys(node).map((key) => [key, null])));
    }
    await eve.store.put(listSoul, Object.fromEntries(Object.keys(directory).map((key) => [key, null])));
    await eve.store.put(souls.index('convs'), { 'c-3': null });
    const seenSoul = souls.index('conv-seen/c-3');
    const seen = (await eve.store.get(seenSoul))!;
    await eve.store.put(seenSoul, Object.fromEntries(Object.keys(seen).map((key) => [key, null])));
    expect(await convEntries(eve, 'c-3')).toEqual([]);

    await rebuildIndexes(eve.store, {});
    expect((await convEntries(eve, 'c-3')).map((entry) => entry.key)).toEqual(before.map((entry) => entry.key));
    expect((await eve.store.get(souls.index('convs')))!['c-3']).toBeDefined();
    const restored = (await eve.store.get(seenSoul))!;
    expect(Object.values(restored).some((value) => linkSoul(value) === souls.event(before[0]!.key))).toBe(true);
  });

  it('a message event trims like any other event and the chain still verifies', async () => {
    const [adam, eve] = [await device('adam-m4'), await device('eve-m4')];
    await Promise.all([adam.sync.open('eve-m4'), eve.sync.open('adam-m4')]);
    await adam.sync.sendMessage('eve-m4', 'c-4', 'trim me');
    await until(async () => (await convEntries(eve, 'c-4')).length === 1);
    const eventId = (await convEntries(eve, 'c-4'))[0]!.key;
    // Eve never appended a log entry, so no unacknowledged log body keeps her message event.
    expect(await eve.store.get('local/sync/owed')).toBeNull();

    // Past the keep window the message event trims like any other event (checkpoint first).
    const DAY = 86_400_000;
    const result = await trimHistory(eve.store, souls, eve.chain, {
      usage: async () => 100, limitBytes: 100, now: () => Date.now() + 40 * DAY,
    });
    expect(result.events).toBe(1);
    expect(result.checkpoint).toBeDefined();
    const trimmed = await eve.store.get(souls.event(eventId));
    expect(trimmed?.text ?? null).toBeNull(); // every field nulled (Gun has no delete)

    // The chain verifies checkpoint-scoped over what remains (the head rests on the checkpoint).
    const loaded: Array<{ id: string; event: any }> = [];
    for (const entry of await readIndex(eve.store, souls.index('day'))) {
      const event = await eve.store.get(entry.target);
      if (event) loaded.push({ id: entry.key, event });
    }
    const chain = await verifyChain(eve.store, souls, { verify: portableEcdsaVerify }, { pub: eve.pair.pub, deviceId: await eve.ids.deviceId() }, async () => loaded);
    expect(chain.ok).toBe(true);
  });

  it('the graph.sendMessage host request sends a message', async () => {
    const hostDevice = async (userId: string) => {
      const pair = (await (SEA as any).pair()) as SeaPair;
      keys.set(userId, { pub: pair.pub, epub: pair.epub });
      const gun = (Gun as any)({ peers: [], sharingRelayPeers: [HUB], localStorage: false, radisk: false, memoryStore: true, axe: false, multicast: false });
      gun._.opt.peers[HUB] = { id: HUB, url: HUB, wire: { send: () => undefined } };
      const store = gunNodeStore(gun, { missWaitMs: 60, readWaitMs: 10 });
      const graph = createDeviceGraph(store, { randomBytes: (n) => new Uint8Array(randomBytes(n)) });
      const host = createGraphHost({ gun, store, graph, crypto });
      await host.handle({ name: 'graph.identity', userId, pair });
      const d = { userId, pair, gun, store, graph, host, sync: host.sync()! };
      devices.push(d);
      return d;
    };
    const [adam, eve] = [await hostDevice('adam-m5'), await hostDevice('eve-m5')];
    await Promise.all([
      adam.host.handle({ name: 'graph.open', peerUserId: 'eve-m5', ...keys.get('eve-m5')! }),
      eve.host.handle({ name: 'graph.open', peerUserId: 'adam-m5', ...keys.get('adam-m5')! }),
    ]);
    const result = await adam.host.handle({ name: 'graph.sendMessage', peerUserId: 'eve-m5', conv: 'c-5', text: 'hi via host' });
    expect(typeof (result as { eventId: string }).eventId).toBe('string');
    await until(async () => (await convEntries(eve, 'c-5')).length === 1);
    const received = (await eve.store.get(souls.event((await convEntries(eve, 'c-5'))[0]!.key)))!;
    expect(received.text).toBe('hi via host');
    expect(linkSoul(received.with)).toBe(personSoul('local/', 'adam-m5'));
  });
});
