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

async function device(userId: string, deviceCrypto: GraphCrypto = crypto) {
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
    gun, store, me: { userId, pair }, crypto: deviceCrypto, graph, remoteReadMs: 150,
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
// `dropped` (`from>to`) loses them, as a data channel that is reconnecting does.
const dropped = new Set<string>();
// `droppedBlocks` loses only log-block writes: their head arrives, the entry it names does not.
const droppedBlocks = new Set<string>();
let pumping = true;
async function pump() {
  while (pumping) {
    for (const from of devices) {
      for (const { to, raw } of await from.sync.pull(0)) {
        const target = devices.find((d) => d.userId === to);
        if (dropped.has(`${from.userId}>${to}`) || (droppedBlocks.has(`${from.userId}>${to}`) && raw.includes('/log/'))) continue;
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

  it('an entry their head names but whose push was lost is asked for again (e2e mass/02)', async () => {
    const [amy, bob] = [await device('amy-d'), await device('bob-d')];
    void pump();
    await Promise.all([amy.sync.open('bob-d'), bob.sync.open('amy-d')]);
    const first = await amy.graph.talks.create(tennis('First tennis'));
    expect(await amy.sync.offerTalk(first, ['bob-d'])).toBe(1);
    await until(async () => !!(await bob.graph.arrivals.read(first)));
    // Amy's next log entry is pushed while the link loses it, but her new head gets through. Gun
    // never resends the entry, and Bob's reads were answered from the block he already holds.
    droppedBlocks.add('amy-d>bob-d');
    const second = await amy.graph.talks.create(tennis('Second tennis'));
    expect(await amy.sync.offerTalk(second, ['bob-d'])).toBe(1);
    await until(async () => (await bob.sync.status('amy-d')).theirHead === 1);
    droppedBlocks.delete('amy-d>bob-d');
    await until(async () => !!(await bob.graph.arrivals.read(second)));
  });

  it('knows only people whose keys it holds, so an offer to someone never linked can wait', async () => {
    const [kim, lee] = [await device('kim-d'), await device('lee-d')];
    expect(await kim.sync.knows(lee.userId)).toBe(true);
    expect(await kim.sync.knows('never-met-d')).toBe(false);
  });

  it('a read receipt that arrives while the last one is being checked still clears what is owed (e2e 05-mailbox)', async () => {
    // Joe's checks of signed read receipts can be held, as a busy device's are.
    let hold: Promise<void> | undefined;
    let release = () => {};
    let held = false;
    const joeCrypto: GraphCrypto = {
      ...crypto,
      verify: async (sig, data, pub) => {
        let receipt = false;
        try { const parsed = JSON.parse(data); receipt = Object.keys(parsed).sort().join() === 'hash,n,when'; } catch { /* not JSON */ }
        if (receipt && hold) { held = true; await hold; }
        return crypto.verify(sig, data, pub);
      },
    };
    const [joe, ivy] = [await device('joe-d', joeCrypto), await device('ivy-d')];
    void pump();
    await Promise.all([joe.sync.open('ivy-d'), ivy.sync.open('joe-d')]);
    const first = await joe.graph.talks.create(tennis('First squash'));
    expect(await joe.sync.offerTalk(first, ['ivy-d'])).toBe(1);
    await until(() => !joe.sync.owed().includes('ivy-d'));

    // Joe's second entry reaches Ivy's device only later, so Joe owes it to her.
    droppedBlocks.add('joe-d>ivy-d');
    const second = await joe.graph.talks.create(tennis('Second squash'));
    expect(await joe.sync.offerTalk(second, ['ivy-d'])).toBe(1);
    expect(joe.sync.owed()).toContain('ivy-d');

    // Ivy writes to Joe: his device catches up and starts checking her old receipt, slowly.
    hold = new Promise<void>((resolve) => { release = resolve; });
    await ivy.sync.sendDecline('joe-d', first, (await ivy.graph.arrivals.read(first))!.versionId);
    await until(() => held);

    // Meanwhile Ivy reads the second entry and her new receipt reaches Joe.
    droppedBlocks.delete('joe-d>ivy-d');
    await until(async () => (await ivy.sync.status('joe-d')).appliedUpTo === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    hold = undefined;
    release();
    // At once, not on a retry timer (that fires a second or more later, and only after a stall).
    await until(() => !joe.sync.owed().includes('ivy-d'), 600);
  });
});
