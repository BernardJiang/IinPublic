/** @jest-environment node */

// Pair-log trimming below the peer's signed acknowledgement (REQ-GRAPH-48, OPEN-109 slice 3):
// entries below the last verified ack go, a signed checkpoint on the head commits to the boundary,
// the exchange keeps working past the trim, a reader behind the checkpoint starts from it, no ack
// trims nothing, and a tampered checkpoint breaks the log instead of fast-forwarding.

import { randomBytes } from 'crypto';
import Gun from 'gun';
import SEA from 'gun/sea';
import { installSharingPolicy } from '../../core/sharing-policy';
import { createAnswerGraph } from '../../core/device-graph/answers';
import { createArrivalGraph } from '../../core/device-graph/arrivals';
import { createEventIdSource } from '../../core/device-graph/event-id';
import { gunNodeStore } from '../../core/device-graph/node-store';
import { createTalkGraph } from '../../core/device-graph/talk-events';
import { canonicalJson } from '../../core/device-graph/keys';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { createGraphHost } from '../../core/device-graph/sync/graph-host';
import { createGraphSync, type GraphCrypto, type SeaPair } from '../../core/device-graph/sync/graph-sync';
import { graphWireSouls, pairTagOf } from '../../core/device-graph/sync/wire-names';
import { portableSha256Hex } from '../../shared/portable-sha256';
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
  const sync = createGraphSync({
    gun, store, me: { userId, pair }, crypto, graph, remoteReadMs: 150,
    peerKeys: async (id) => keys.get(id),
  });
  await sync.start();
  const d = { userId, pair, gun, store, graph, sync };
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

/** The pair secret and tag as the pair itself computes them (the test plays the link). */
async function pairOf(a: any, bUserId: string) {
  const secret = (await (SEA as any).secret(keys.get(bUserId)!.epub, a.pair)) as string;
  return { secret, pairTag: pairTagOf(secret) };
}

/** Decrypt one log entry from a device's log block for a pair. */
async function logEntry(d: any, pairTag: string, secret: string, n: number) {
  const block = await d.store.get(graphWireSouls(d.userId).logBlock(pairTag, Math.floor(n / 256)));
  const plain = await (SEA as any).decrypt(block?.[String(n)], secret);
  return typeof plain === 'string' ? JSON.parse(plain) : plain;
}

/** Create a Talk and offer it: one entry on the sender's pair log. */
async function offerOne(from: any, toUserId: string): Promise<string> {
  const talkId = await from.graph.talks.create(tennis());
  expect(await from.sync.offerTalk(talkId, [toUserId])).toBe(1);
  return talkId;
}

describe('pair-log trimming below the signed acknowledgement', () => {

  it('trims below the ack, the exchange keeps working, and a wiped reader starts from the checkpoint', async () => {
    const [adam, eve] = [await device('adam-t'), await device('eve-t')];
    void pump();

    // Three offers: Adam's log for Eve holds entries 0, 1, 2 and Eve applies them all.
    const talks = [await offerOne(adam, 'eve-t'), await offerOne(adam, 'eve-t'), await offerOne(adam, 'eve-t')];
    await Promise.all([adam.sync.open('eve-t'), eve.sync.open('adam-t')]);
    await until(async () => (await Promise.all(talks.map((t) => eve.graph.arrivals.read(t)))).every(Boolean));
    const { secret, pairTag } = await pairOf(adam, 'eve-t');
    const boundaryEntry = await logEntry(adam, pairTag, secret, 1);
    const boundaryHash = portableSha256Hex(canonicalJson(boundaryEntry));

    // Eve's signed ack of entry 2 has landed and verified on Adam's side.
    await until(async () => typeof (await adam.store.get(souls.index('ack/eve-t')))?.['2'] === 'string');

    // The trim: entries 0 and 1 go, the checkpoint commits to entry 1's hash.
    await expect(adam.sync.trimLog('eve-t')).resolves.toEqual({ trimmed: 2, checkpointN: 1 });
    await until(async () => {
      const block = await adam.store.get(graphWireSouls('adam-t').logBlock(pairTag, 0));
      return block?.['0'] === null && block?.['1'] === null;
    });
    const block = (await adam.store.get(graphWireSouls('adam-t').logBlock(pairTag, 0)))!;
    expect(block['0']).toBeNull();
    expect(block['1']).toBeNull();
    expect(typeof block['2']).toBe('string');
    const headNode = (await adam.store.get(graphWireSouls('adam-t').head(pairTag)))!;
    const cpPlain = await (SEA as any).decrypt(headNode.cp, secret);
    const cp = typeof cpPlain === 'string' ? JSON.parse(cpPlain) : cpPlain;
    expect(cp.n).toBe(1);
    expect(cp.hash).toBe(boundaryHash);
    expect(typeof cp.when).toBe('number');
    expect(await portableEcdsaVerify(cp.sig, canonicalJson({ n: cp.n, hash: cp.hash, when: cp.when }), keys.get('adam-t')!.pub)).toBe(true);

    // Entry 2 (the first retained one) chains from the checkpoint's hash.
    const retained = await logEntry(adam, pairTag, secret, 2);
    expect(retained.prev).toBe(cp.hash);

    // The receiver, already past the checkpoint, ignores it and applies new entries after the trim.
    const fourth = await offerOne(adam, 'eve-t');
    await until(async () => !!(await eve.graph.arrivals.read(fourth)));
    expect((await eve.store.get('local/sync/in/adam-t'))?.broken).toBeUndefined();

    // A reader behind the checkpoint (Eve with her in-state wiped) starts from it: next = cp.n + 1,
    // the retained entries apply, and the chain does not break.
    await eve.store.put('local/sync/in/adam-t', { next: null, hash: null, broken: null });
    await eve.sync.catchUp('adam-t');
    await until(async () => {
      const state = await eve.store.get('local/sync/in/adam-t');
      return typeof state?.next === 'number' && state.next >= 4;
    });
    const state = (await eve.store.get('local/sync/in/adam-t'))!;
    expect(typeof state.broken).not.toBe('string');
    expect(await eve.graph.arrivals.read(talks[2])).toBeTruthy();
    expect(await eve.graph.arrivals.read(fourth)).toBeTruthy();
  });

  it('trims nothing without an ack', async () => {
    const [ann] = [await device('ann-t')];
    await device('ben-t');
    await offerOne(ann, 'ben-t');
    await offerOne(ann, 'ben-t');
    await expect(ann.sync.trimLog('ben-t')).resolves.toEqual({ trimmed: 0 });
    const { pairTag } = await pairOf(ann, 'ben-t');
    const block = (await ann.store.get(graphWireSouls('ann-t').logBlock(pairTag, 0)))!;
    expect(typeof block['0']).toBe('string');
    expect(typeof block['1']).toBe('string');
    const headNode = (await ann.store.get(graphWireSouls('ann-t').head(pairTag)))!;
    expect(headNode.cp).toBeUndefined();
  });

  it('a tampered checkpoint breaks the log for a reader behind it', async () => {
    const [kim, lee] = [await device('kim-t'), await device('lee-t')];
    const talkId = await offerOne(kim, 'lee-t');
    const { secret, pairTag } = await pairOf(kim, 'lee-t');
    const entry0 = await logEntry(kim, pairTag, secret, 0);
    const cp = { n: 0, hash: portableSha256Hex(canonicalJson(entry0)), when: Date.now() };
    // The fields are genuine but the signature is not the log owner's (Lee signed it, not Kim).
    const tampered = await crypto.encrypt(JSON.stringify({ ...cp, sig: await crypto.sign(canonicalJson(cp), lee.pair.priv) }), secret);
    await new Promise<void>((resolve) => { kim.gun.get(graphWireSouls('kim-t').head(pairTag)).put({ cp: tampered }, () => resolve()); });

    await Promise.all([kim.sync.open('lee-t'), lee.sync.open('kim-t')]);
    await until(async () => typeof (await lee.store.get('local/sync/in/kim-t'))?.broken === 'string');
    const state = (await lee.store.get('local/sync/in/kim-t'))!;
    expect(String(state.broken)).toContain('checkpoint 0');
    // Nothing was applied: the log cannot be proven from the checkpoint.
    expect(await lee.graph.arrivals.read(talkId)).toBeUndefined();
  });

  it('the graph.trimLog host request trims', async () => {
    const [hank, ivy] = [await device('hank-t'), await device('ivy-t')];
    await offerOne(hank, 'ivy-t');
    await offerOne(hank, 'ivy-t');
    await Promise.all([hank.sync.open('ivy-t'), ivy.sync.open('hank-t')]);
    await until(async () => typeof (await hank.store.get(souls.index('ack/ivy-t')))?.['1'] === 'string');

    // The host over Hank's Gun and store; only the identity/trimLog surface of the graph is used.
    const graph = { prefix: 'local/', setChain: () => undefined, ids: { deviceId: async () => 'hank-device' } };
    const host = createGraphHost({ gun: hank.gun, store: hank.store, graph: graph as any, crypto });
    await host.handle({ name: 'graph.identity', userId: 'hank-t', pair: hank.pair });
    await host.handle({ name: 'graph.open', peerUserId: 'ivy-t', ...keys.get('ivy-t')! });
    await expect(host.handle({ name: 'graph.trimLog', peerUserId: 'ivy-t' })).resolves.toEqual({ trimmed: 1, checkpointN: 0 });
    const { pairTag } = await pairOf(hank, 'ivy-t');
    const block = (await hank.store.get(graphWireSouls('hank-t').logBlock(pairTag, 0)))!;
    expect(block['0']).toBeNull();
    expect(typeof block['1']).toBe('string');
  });
});
