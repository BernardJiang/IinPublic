/** @jest-environment node */

// Talk exchange by Gun sync (spec §31.9, REQ-GRAPH-30..35, OPEN-106): real Gun instances joined by
// direct graph links carry a Talk as encrypted nodes, the answer back, edits and deletions; the
// hub and a third person see none of it; a broken log is detected.

import { randomBytes } from 'crypto';
import Gun from 'gun';
import SEA from 'gun/sea';
import { installSharingPolicy } from '../../core/sharing-policy';
import { createAnswerGraph } from '../../core/device-graph/answers';
import { createArrivalGraph } from '../../core/device-graph/arrivals';
import { createEventIdSource } from '../../core/device-graph/event-id';
import { gunNodeStore } from '../../core/device-graph/node-store';
import { createTalkGraph } from '../../core/device-graph/talk-events';
import { talkStructureOf } from '../../core/device-graph/talk-structure';
import { createGraphSync, type GraphCrypto, type SeaPair } from '../../core/device-graph/sync/graph-sync';
import { userTag } from '../../core/device-graph/sync/wire-names';
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

const tennis = (title = 'Tennis partner') => ({
  title, type: 'flow', language: 'en', isAdult: false,
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

const HUB = 'https://hub.example/gun';
const keys = new Map<string, { pub: string; epub: string }>();
const devices: any[] = [];

async function device(userId: string) {
  const pair = (await (SEA as any).pair()) as SeaPair;
  keys.set(userId, { pub: pair.pub, epub: pair.epub });
  const gun = (Gun as any)({ peers: [], sharingRelayPeers: [HUB], localStorage: false, radisk: false, memoryStore: true, axe: false, multicast: false });
  const hubWire: string[] = [];
  gun._.opt.peers[HUB] = { id: HUB, url: HUB, wire: { send: (raw: string) => hubWire.push(raw) } };
  const heard: string[] = [];
  const store = gunNodeStore(gun, { missWaitMs: 60, readWaitMs: 10 });
  let saved: { deviceId?: string; counter?: number } = {};
  const ids = createEventIdSource({ state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(randomBytes(n)) });
  const graph = { talks: createTalkGraph(store, ids), arrivals: createArrivalGraph(store, ids), answers: createAnswerGraph(store, ids) };
  const events: Array<[string, string, string]> = [];
  const sync = createGraphSync({
    gun, store, me: { userId, pair }, crypto, graph, remoteReadMs: 150,
    peerKeys: async (id) => keys.get(id),
    events: {
      onTalk: (talkId, from) => events.push(['talk', talkId, from]),
      onAnswer: (talkId, from) => events.push(['answer', talkId, from]),
      onTalkDeleted: (talkId, from) => events.push(['talk-deleted', talkId, from]),
      onAnswerDeleted: (talkId, from) => events.push(['answer-deleted', talkId, from]),
      onDeclined: (talkId, from) => events.push(['declined', talkId, from]),
    },
  });
  await sync.start();
  const d = { userId, gun, store, graph, sync, events, hubWire, heard };
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
        if (target?.sync.openLinks().includes(from.userId)) { target.heard.push(raw); target.sync.hear(from.userId, raw); }
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

/**
 * A storage adapter that answers every read, found or not, as Radisk does (Radisk itself does not
 * load under Jest). Without one, a read of a node nobody has never answers.
 */
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

describe('Talk exchange by Gun sync', () => {

  it('carries a Talk, the answer, an edit and both deletions; the hub and a third person see nothing of it', async () => {
    const [adam, eve, carol] = [await device('adam'), await device('eve'), await device('carol')];
    void pump();

    const talkId = await adam.graph.talks.create(tennis());
    // Links come up only between Adam and Eve, and between Adam and Carol later.
    await Promise.all([adam.sync.open('eve'), eve.sync.open('adam')]);
    expect(await adam.sync.offerTalk(talkId, ['eve', 'carol'])).toBe(2);
    expect(await adam.sync.offerTalk(talkId, ['eve'])).toBe(0); // already offered this version

    await until(async () => !!(await eve.graph.arrivals.read(talkId)));
    const received = (await eve.graph.arrivals.read(talkId))!;
    expect(received).toMatchObject({ id: talkId, title: 'Tennis partner', senders: ['adam'] });
    expect(talkStructureOf(received)).toEqual(talkStructureOf(tennis()));
    expect(eve.events).toContainEqual(['talk', talkId, 'adam']);

    // Eve answers; the answer reaches Adam as keys, checked against his Talk.
    const answerId = await eve.graph.answers.answer({ talkId, structure: received, withUser: 'adam', mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    await eve.sync.sendAnswer(answerId);
    await until(async () => (await adam.graph.answers.theirs(talkId)).eve === answerId);
    expect(await adam.graph.answers.answerSet(answerId)).toEqual(await eve.graph.answers.answerSet(answerId));

    // Eve's head says she read Adam's log, so Adam owes her nothing more (no link is wanted).
    await until(() => !adam.sync.owed().includes('eve'));
    // Carol was offered the Talk but had no link: nothing reached her, and Adam still owes her.
    expect(await carol.graph.arrivals.read(talkId)).toBeUndefined();
    expect(adam.sync.owed()).toContain('carol');
    await Promise.all([adam.sync.open('carol'), carol.sync.open('adam')]);
    await until(async () => !!(await carol.graph.arrivals.read(talkId)));
    await until(() => !adam.sync.owed().includes('carol'));
    expect((await adam.sync.status('carol')).theirRead).toBe((await adam.sync.status('carol')).sentUpTo);

    // An edit is a new version, offered again.
    await adam.graph.talks.edit(talkId, tennis('Tennis buddy'));
    expect(await adam.sync.offerTalk(talkId, ['eve'])).toBe(1);
    await until(async () => (await eve.graph.arrivals.read(talkId))?.title === 'Tennis buddy');

    // Eve deletes her answer: it leaves Adam's indexes.
    const answerDeletion = await eve.graph.answers.remove(talkId);
    await eve.sync.sendAnswerDeletion(talkId, answerDeletion!);
    await until(async () => !(await adam.graph.answers.theirs(talkId)).eve);

    // Adam deletes the Talk: it leaves Eve's and Carol's lists.
    const deletion = await adam.graph.talks.remove(talkId);
    expect(await adam.sync.sendTalkDeletion(talkId, deletion!)).toBe(2);
    await until(async () => !(await eve.graph.arrivals.read(talkId)) && !(await carol.graph.arrivals.read(talkId)));
    expect(await eve.graph.arrivals.incoming()).toEqual([]);

    // The hub saw no graph soul from anyone.
    for (const d of devices) expect(d.hubWire.join('')).not.toMatch(/"g\//);
    // Carol never heard Eve's souls or Adam's log to Eve; nothing she heard is readable text.
    const carolHeard = carol.heard.join('');
    expect(carolHeard).not.toContain(`g/${userTag('eve')}`);
    expect(carolHeard).not.toContain('tennis');
    expect(carolHeard).not.toContain('Weekly');
    expect(Object.keys(carol.gun._.graph).filter((soul) => soul.startsWith(`g/${userTag('eve')}`))).toEqual([]);
    expect((await eve.sync.status('adam')).broken).toBeUndefined();
  });

  it('a link refuses souls the other person may not write, and a broken log stops with a reason', async () => {
    const [bob, dan] = [await device('bob'), await device('dan')];
    await Promise.all([bob.sync.open('dan'), dan.sync.open('bob')]);
    // Dan tries to write into Bob's part of the graph over the link.
    const forged = `g/${userTag('bob')}/t/${'f'.repeat(32)}`;
    const cipher = String(await (SEA as any).encrypt('x', 'k'));
    bob.sync.hear('dan', JSON.stringify({ '#': 'forge', put: { [forged]: { _: { '#': forged, '>': { head: Date.now() } }, head: cipher } } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bob.gun._.graph[forged]).toBeUndefined();

    // Bob's log loses an entry's link to the one before: Dan applies up to it and stops.
    const talkId = await bob.graph.talks.create(tennis('First'));
    await bob.sync.offerTalk(talkId, ['dan']);
    await until(async () => (await dan.sync.status('bob')).appliedUpTo === 0);
    await bob.store.put('local/sync/out/dan', { hash: 'not-the-real-hash' });
    const second = await bob.graph.talks.create(tennis('Second'));
    await bob.sync.offerTalk(second, ['dan']);
    await until(async () => !!(await dan.sync.status('bob')).broken);
    expect((await dan.sync.status('bob')).broken).toMatch(/does not follow/);
    expect(await dan.graph.arrivals.read(second)).toBeUndefined();
  });

  it('a Talk the receiver\'s intake refused is declined back to its author', async () => {
    const [ann, ben] = [await device('ann-d'), await device('ben-d')];
    void pump();
    const talkId = await ann.graph.talks.create(tennis('Adult tennis'));
    await Promise.all([ann.sync.open('ben-d'), ben.sync.open('ann-d')]);
    expect(await ann.sync.offerTalk(talkId, ['ben-d'])).toBe(1);
    await until(async () => !!(await ben.graph.arrivals.read(talkId)));
    await ben.sync.sendDecline('ann-d', talkId, (await ben.graph.arrivals.read(talkId))!.versionId);
    await until(() => ann.events.some((e) => e[0] === 'declined' && e[1] === talkId && e[2] === 'ben-d'));
  });
});
