/** @jest-environment node */

// Signed acknowledgements and linked exchange sides (REQ-GRAPH-43/44/45, OPEN-108 slice 4): the
// offer's arrival event names the sender's log entry, the answer names it back (`reEntry`), the
// receiver's head carries a signed `ack` that commits to the entry it applied, the sender keeps
// the verified acknowledgement and its clock skew, and a legacy or tampered head clears nothing
// it should not.

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
import { createGraphSync, type GraphCrypto, type SeaPair } from '../../core/device-graph/sync/graph-sync';
import { graphWireSouls, pairTagOf } from '../../core/device-graph/sync/wire-names';
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

async function device(userId: string, options: { now?: () => number } = {}) {
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
    ...(options.now ? { now: options.now } : {}),
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

/** Write a head node straight into a device's Gun, as a linked peer's write would arrive. */
async function injectHead(into: any, fromUserId: string, pairTag: string, fields: Record<string, string>) {
  const soul = graphWireSouls(fromUserId).head(pairTag);
  await new Promise<void>((resolve) => { into.gun.get(soul).put(fields, () => resolve()); });
}

describe('signed acknowledgements and linked exchange sides', () => {

  it('links the offer to the answer and stores the signed ack; the skew is reported', async () => {
    // Eve's clock runs 5 s ahead, so the ack's `when` is measurably off Adam's entry's.
    const skew = 5_000;
    const [adam, eve] = [await device('adam-a'), await device('eve-a', { now: () => Date.now() + skew })];
    void pump();

    const talkId = await adam.graph.talks.create(tennis());
    await Promise.all([adam.sync.open('eve-a'), eve.sync.open('adam-a')]);
    expect(await adam.sync.offerTalk(talkId, ['eve-a'])).toBe(1);
    await until(async () => !!(await eve.graph.arrivals.read(talkId)));

    // (a) The arrival event names Adam's log entry that carried the offer.
    const sent = (await adam.store.get('local/sync/out/eve-a'))!;
    const { pairTag } = await pairOf(adam, 'eve-a');
    const offerEntry = await logEntry(adam, pairTag, (await pairOf(adam, 'eve-a')).secret, 0);
    expect(sent.n).toBe(0);
    const received = (await eve.graph.arrivals.read(talkId))!;
    const arrival = (await eve.store.get(souls.event(received.latestArrival)))!;
    expect(arrival.entryN).toBe(0);
    expect(arrival.entryHash).toBe(sent.hash);
    expect(arrival.entryWhen).toBe(offerEntry.when);

    // (b) The answer names the offer entry back: in Eve's log body and on Adam's stored event.
    const answerId = await eve.graph.answers.answer({ talkId, structure: received, withUser: 'adam-a', mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    await eve.sync.sendAnswer(answerId);
    await until(async () => (await adam.graph.answers.theirs(talkId))['eve-a'] === answerId);
    const evePair = await pairOf(eve, 'adam-a');
    const answerEntry = await logEntry(eve, evePair.pairTag, evePair.secret, 0);
    expect(answerEntry.body.answer.reEntry).toEqual({ n: 0, hash: sent.hash });
    const storedAnswer = (await adam.store.get(souls.event(answerId)))!;
    expect(storedAnswer.reEntryN).toBe(0);
    expect(storedAnswer.reEntryHash).toBe(sent.hash);

    // (c)+(d) The signed ack clears what Adam owed Eve and is stored, verifiable, on his side.
    await until(() => !adam.sync.owed().includes('eve-a'));
    const ackNode = (await adam.store.get(souls.index('ack/eve-a')))!;
    const ack = JSON.parse(String(ackNode['0']));
    expect(ack.n).toBe(0);
    expect(ack.hash).toBe(sent.hash);
    expect(typeof ack.when).toBe('number');
    expect(await portableEcdsaVerify(ack.sig, canonicalJson({ n: ack.n, hash: ack.hash, when: ack.when }), keys.get('eve-a')!.pub)).toBe(true);

    // (g) The status reports the ack with the clock skew (Eve is ~5 s ahead of Adam).
    const status = await adam.sync.status('eve-a');
    expect(status.lastAck?.n).toBe(0);
    expect(status.lastAck?.when).toBe(ack.when);
    expect(status.lastAck!.skewMs).toBeGreaterThan(skew - 2_000);
    expect(status.lastAck!.skewMs).toBeLessThan(skew + 2_000);
  });

  it('a legacy head with only an unsigned `read` still clears what is owed', async () => {
    // Ben never opens his side of the link: his "head" is injected as a pre-ack peer wrote it.
    const [ann] = [await device('ann-b')];
    await device('ben-b');
    const talkId = await ann.graph.talks.create(tennis());
    expect(await ann.sync.offerTalk(talkId, ['ben-b'])).toBe(1);
    expect(ann.sync.owed()).toContain('ben-b');
    const { secret, pairTag } = await pairOf(ann, 'ben-b');
    await injectHead(ann, 'ben-b', pairTag, { read: await crypto.encrypt(JSON.stringify({ n: 0 }), secret) });
    await ann.sync.open('ben-b');
    await until(() => !ann.sync.owed().includes('ben-b'));
    // A legacy peer left no signed acknowledgement.
    expect(await ann.store.get(souls.index('ack/ben-b'))).toBeNull();
  });

  it('a tampered ack clears nothing and is not stored', async () => {
    const [kim] = [await device('kim-c')];
    await device('lee-c');
    const talkId = await kim.graph.talks.create(tennis());
    expect(await kim.sync.offerTalk(talkId, ['lee-c'])).toBe(1);
    const { secret, pairTag } = await pairOf(kim, 'lee-c');
    const headSoul = graphWireSouls('lee-c').head(pairTag);
    const put = (fields: Record<string, string>) => new Promise<void>((resolve) => { kim.gun.get(headSoul).put(fields, () => resolve()); });

    // Wrong hash: the signature is genuine but the ack commits to no entry of Kim's log.
    const wrongHash = { n: 0, hash: '0'.repeat(64), when: Date.now() };
    await put({ ack: await crypto.encrypt(JSON.stringify({ ...wrongHash, sig: await crypto.sign(canonicalJson(wrongHash), (devices.find((d) => d.userId === 'lee-c') as any).pair.priv) }), secret) });
    await kim.sync.open('lee-c');
    await kim.sync.catchUp('lee-c');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(kim.sync.owed()).toContain('lee-c');
    expect(await kim.store.get(souls.index('ack/lee-c'))).toBeNull();

    // Bad signature: the real hash, but signed by someone else (Kim herself, not Lee).
    const sent = (await kim.store.get('local/sync/out/lee-c'))!;
    const badSig = { n: 0, hash: sent.hash, when: Date.now() };
    await put({ ack: await crypto.encrypt(JSON.stringify({ ...badSig, sig: await crypto.sign(canonicalJson(badSig), kim.pair.priv) }), secret) });
    await kim.sync.catchUp('lee-c');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(kim.sync.owed()).toContain('lee-c');
    expect(await kim.store.get(souls.index('ack/lee-c'))).toBeNull();
  });
});
