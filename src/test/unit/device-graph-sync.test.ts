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
  const appliedVersions: Array<{ versionId: string; talk: any }> = [];
  const sync = createGraphSync({
    gun, store, me: { userId, pair }, crypto: deviceCrypto, graph, remoteReadMs: 150,
    peerKeys: async (id) => keys.get(id),
    events: {
      onTalk: (talkId, from, _context, applied) => { events.push(['talk', talkId, from]); if (applied) appliedVersions.push(applied); },
      onAnswer: (talkId, from) => events.push(['answer', talkId, from]),
      onTalkDeleted: (talkId, from) => events.push(['talk-deleted', talkId, from]),
      onAnswerDeleted: (talkId, from) => events.push(['answer-deleted', talkId, from]),
      onDeclined: (talkId, from) => events.push(['declined', talkId, from]),
    },
  });
  await sync.start();
  const d = { userId, gun, store, graph, sync, events, hubWire, heard, appliedVersions };
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
        if (dropped.has(`${from.userId}>${to}`) || (droppedBlocks.has(`${from.userId}>${to}`) && raw.includes('"t":"log"'))) continue;
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
    // Amy's next log frame is lost while the link stays up. She still owes it, so she sends it
    // again once the link carries frames again.
    droppedBlocks.add('amy-d>bob-d');
    const second = await amy.graph.talks.create(tennis('Second tennis'));
    expect(await amy.sync.offerTalk(second, ['bob-d'])).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await bob.graph.arrivals.read(second)).toBeUndefined();
    droppedBlocks.delete('amy-d>bob-d');
    await until(async () => !!(await bob.graph.arrivals.read(second)));
  });

  it('an entry whose every frame was lost while the link stayed open still arrives (stage5 HR route)', async () => {
    const [eve, hal] = [await device('eve-d'), await device('hal-d')];
    void pump();
    await Promise.all([eve.sync.open('hal-d'), hal.sync.open('eve-d')]);
    const first = await eve.graph.talks.create(tennis('First padel'));
    expect(await eve.sync.offerTalk(first, ['hal-d'])).toBe(1);
    await until(async () => !!(await hal.graph.arrivals.read(first)));
    await until(() => !eve.sync.owed().includes('hal-d'));
    // The connection under the link is replaced: Eve's head and entry are both lost, the link is
    // never closed, and nothing else is written by either side afterwards.
    dropped.add('eve-d>hal-d');
    const second = await eve.graph.talks.create(tennis('Second padel'));
    expect(await eve.sync.offerTalk(second, ['hal-d'])).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    dropped.delete('eve-d>hal-d');
    await until(async () => !!(await hal.graph.arrivals.read(second)), 10_000);
    await until(() => !eve.sync.owed().includes('hal-d'), 10_000);
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

    // Joe's link comes up again: Ivy's hello brings her old receipt, and Joe checks it slowly.
    hold = new Promise<void>((resolve) => { release = resolve; });
    joe.sync.close('ivy-d');
    await joe.sync.open('ivy-d');
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

  it('a head asked for before the other side\'s link was open still arrives when it opens (e2e 05-mailbox)', async () => {
    const [tom, jerry] = [await device('tom-d'), await device('jerry-d')];
    void pump();
    await Promise.all([tom.sync.open('jerry-d'), jerry.sync.open('tom-d')]);
    const talkId = await tom.graph.talks.create(tennis('Mailbox tennis'));
    expect(await tom.sync.offerTalk(talkId, ['jerry-d'])).toBe(1);
    await until(async () => !!(await jerry.graph.arrivals.read(talkId)));
    await until(async () => (await tom.sync.status('jerry-d')).theirRead === 0);

    // Tom goes offline; Jerry answers, so his log owes Tom an entry.
    tom.sync.close('jerry-d');
    jerry.sync.close('tom-d');
    const received = (await jerry.graph.arrivals.read(talkId))!;
    const answerId = await jerry.graph.answers.answer({ talkId, structure: received, withUser: 'tom-d', mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    await jerry.sync.sendAnswer(answerId);
    expect(jerry.sync.owed()).toContain('tom-d');

    // Tom's side of the link opens first: his ask for Jerry's head reaches nobody.
    void tom.sync.open('jerry-d');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await jerry.sync.open('tom-d');
    await until(async () => (await tom.graph.answers.theirs(talkId))['jerry-d'] === answerId, 5_000);
    await until(() => !jerry.sync.owed().includes('tom-d'), 5_000);
  });

  it('offers made at the same time go in one entry that carries the Talks: the receiver reads none of mine (OPEN-114)', async () => {
    const [kim, lee] = [await device('kim-b'), await device('lee-b')];
    void pump();
    await Promise.all([kim.sync.open('lee-b'), lee.sync.open('kim-b')]);
    const ids = await Promise.all([1, 2, 3, 4, 5].map((i) => kim.graph.talks.create(tennis(`Batch tennis ${i}`))));
    await Promise.all(ids.map((id) => kim.sync.offerTalk(id, ['lee-b'])));
    await until(async () => (await Promise.all(ids.map((id) => lee.graph.arrivals.read(id)))).every(Boolean));
    // Five offers in fewer entries (the first goes alone; the rest share what follows).
    expect((await kim.sync.status('lee-b')).sentUpTo).toBeLessThan(4);
    expect((await lee.graph.arrivals.read(ids[4]!))).toMatchObject({ title: 'Batch tennis 5', senders: ['kim-b'] });
    // No Talk wire node (`g/<kim>/t/…`) was written or asked for: the Talks came inside the entries.
    expect(lee.heard.join('')).not.toContain(`g/${userTag('kim-b')}/t/`);
    // Nothing readable on the wire.
    expect(lee.heard.join('')).not.toContain('Batch tennis');
  });

  it('a large batch is its own node behind an encrypted pointer, and trimming removes it (OPEN-114)', async () => {
    const [max, ned] = [await device('max-b'), await device('ned-b')];
    void pump();
    await Promise.all([max.sync.open('ned-b'), ned.sync.open('max-b')]);
    const first = await max.graph.talks.create(tennis('Opening tennis'));
    await max.sync.offerTalk(first, ['ned-b']);
    // Offers are small (content goes in blobs): a long title makes each one large on its own.
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => max.graph.talks.create(tennis(`Large batch tennis ${i} ${'x'.repeat(5_000)}`))));
    await Promise.all(ids.map((id) => max.sync.offerTalk(id, ['ned-b'])));
    await until(async () => (await Promise.all(ids.map((id) => ned.graph.arrivals.read(id)))).every(Boolean));
    expect((await max.sync.status('ned-b')).sentUpTo).toBeLessThan(7);
    // The block holds only ciphertext (the sharing policy sends nothing else); the large entry's
    // own node exists under the pair's part.
    const own = `g/${userTag('max-b')}/p/`;
    const entryNodes = Object.keys(max.gun._.graph).filter((soul) => soul.startsWith(own) && /\/e\/\d+$/.test(soul));
    expect(entryNodes.length).toBeGreaterThan(0);
    for (const soul of Object.keys(max.gun._.graph).filter((s) => s.startsWith(own) && s.includes('/log/'))) {
      for (const [key, value] of Object.entries(max.gun._.graph[soul])) if (key !== '_' && value !== null) expect(String(value)).toMatch(/^SEA\{/);
    }
    // Once Ned acknowledged everything, trimming clears the large entries' nodes too.
    await until(() => !max.sync.owed().includes('ned-b'));
    let trimmed = 0;
    await until(async () => (trimmed = (await max.sync.trimLog('ned-b')).trimmed) > 0);
    // Entries below the last acknowledged one are trimmed (that one stays, as the boundary).
    const below = entryNodes.filter((soul) => Number(soul.split('/').pop()) < trimmed);
    expect(below.length).toBeGreaterThan(0);
    await until(async () => (await Promise.all(below.map((soul) => max.store.get(soul)))).every((node) => !node?.c));
  });

  it('answers made at the same time go back in one entry (OPEN-114)', async () => {
    const [ola, pat] = [await device('ola-b'), await device('pat-b')];
    void pump();
    await Promise.all([ola.sync.open('pat-b'), pat.sync.open('ola-b')]);
    const ids = await Promise.all([1, 2, 3, 4].map((i) => ola.graph.talks.create(tennis(`Answered tennis ${i}`))));
    await Promise.all(ids.map((id) => ola.sync.offerTalk(id, ['pat-b'])));
    await until(async () => (await Promise.all(ids.map((id) => pat.graph.arrivals.read(id)))).every(Boolean));
    const answerIds = await Promise.all(ids.map(async (id) => pat.graph.answers.answer({
      talkId: id, structure: (await pat.graph.arrivals.read(id))!, withUser: 'ola-b', mode: 'chatbot',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    })));
    await Promise.all(answerIds.map((answerId) => pat.sync.sendAnswer(answerId)));
    await until(async () => (await Promise.all(ids.map((id) => ola.graph.answers.theirs(id)))).every((by) => !!by['pat-b']));
    // Four answers in fewer entries.
    expect((await pat.sync.status('ola-b')).sentUpTo).toBeLessThan(3);
  });
  it('a link that carries only small frames (BLE-sized) gets the same Talks, in parts (OPEN-114)', async () => {
    const [ray, sue] = [await device('ray-b'), await device('sue-b')];
    void pump();
    await Promise.all([ray.sync.open('sue-b', { frameMaxChars: 300 }), sue.sync.open('ray-b', { frameMaxChars: 300 })]);
    const ids = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => ray.graph.talks.create(tennis(`Small frame tennis ${i}`))));
    const heardBefore = sue.heard.length;
    await Promise.all(ids.map((id) => ray.sync.offerTalk(id, ['sue-b'])));
    await until(async () => (await Promise.all(ids.map((id) => sue.graph.arrivals.read(id)))).every(Boolean));
    const frames = sue.heard.slice(heardBefore);
    expect(frames.every((raw: string) => raw.length <= 300)).toBe(true);
    expect(frames.some((raw: string) => raw.includes('"t":"part"'))).toBe(true);
    // And back: answers over the same small frames.
    const answerIds = await Promise.all(ids.map(async (id) => sue.graph.answers.answer({
      talkId: id, structure: (await sue.graph.arrivals.read(id))!, withUser: 'ray-b', mode: 'chatbot',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    })));
    await Promise.all(answerIds.map((answerId) => sue.sync.sendAnswer(answerId)));
    await until(async () => (await Promise.all(ids.map((id) => ray.graph.answers.theirs(id)))).every((by) => !!by['sue-b']));
  });
  it('a Talk offered to several people is one content blob; each pair gets a small offer (OPEN-114)', async () => {
    const [una, vic, wes] = [await device('una-b'), await device('vic-b'), await device('wes-b')];
    void pump();
    await Promise.all([una.sync.open('vic-b'), vic.sync.open('una-b'), una.sync.open('wes-b'), wes.sync.open('una-b')]);
    const talkId = await una.graph.talks.create(tennis('Shared tennis'));
    expect(await una.sync.offerTalk(talkId, ['vic-b', 'wes-b'])).toBe(2);
    await until(async () => !!(await vic.graph.arrivals.read(talkId)) && !!(await wes.graph.arrivals.read(talkId)));
    // One content name for the version, whoever it went to; the blob itself is never stored (the
    // Talk's own nodes are its only copy on disk).
    expect(Object.keys(una.gun._.graph).filter((soul) => soul.startsWith('local/sync/blob/'))).toHaveLength(0);
    expect(Object.keys(una.gun._.graph).filter((soul) => soul.startsWith('local/sync/version/'))).toHaveLength(1);
    // The offers in the pair logs name it; the question text travels only in the blob.
    const offerFrames = vic.heard.filter((raw: string) => raw.includes('"t":"log"'));
    const blobFrames = vic.heard.filter((raw: string) => raw.includes('"t":"blob"'));
    expect(offerFrames.length).toBeGreaterThan(0);
    expect(blobFrames).toHaveLength(1);
    expect(Math.max(...offerFrames.map((raw: string) => raw.length))).toBeLessThan(blobFrames[0]!.length * 4);
  });

  it('content I already hold (the same Talk from someone else) is not asked for again (OPEN-114)', async () => {
    const [xia, yan, zed] = [await device('xia-b'), await device('yan-b'), await device('zed-b')];
    void pump();
    await Promise.all([xia.sync.open('zed-b'), zed.sync.open('xia-b'), yan.sync.open('zed-b'), zed.sync.open('yan-b')]);
    // Xia and Yan each wrote the same questions (as everyone's starter tags are).
    const fromXia = await xia.graph.talks.create(tennis('Starter tennis'));
    expect(await xia.sync.offerTalk(fromXia, ['zed-b'])).toBe(1);
    await until(async () => !!(await zed.graph.arrivals.read(fromXia)));
    expect(xia.heard.some((raw: string) => raw.includes('"t":"want"'))).toBe(true);
    const fromYan = await yan.graph.talks.create(tennis('Starter tennis'));
    expect(await yan.sync.offerTalk(fromYan, ['zed-b'])).toBe(1);
    await until(async () => !!(await zed.graph.arrivals.read(fromYan)));
    expect((await zed.graph.arrivals.read(fromYan))).toMatchObject({ title: 'Starter tennis', senders: ['yan-b'] });
    expect(yan.heard.some((raw: string) => raw.includes('"t":"want"'))).toBe(false);
  });

  it('the version handed to the host with a Talk reads the same as the Talk read back from storage (OPEN-114)', async () => {
    const [eli, fay] = [await device('eli-b'), await device('fay-b')];
    void pump();
    await Promise.all([eli.sync.open('fay-b'), fay.sync.open('eli-b')]);
    const deal = { title: 'Phone deal', type: 'route', language: 'en', isAdult: false, matchThreshold: 2, questions: [
      { id: 'q_0', text: 'Buy', reciprocalTagContext: true, contextPath: [], answers: [
        { id: 'a_0_0', text: 'iPhone', nextQuestionIds: ['q_1'] }, { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true }] },
      { id: 'q_1', text: 'Which model?', answerSelectionMode: 'multiple', contextPath: [{ questionId: 'q_0', answerId: 'a_0_0' }], answers: [
        { id: 'a_1_0', text: '15', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Ignore', isIgnore: true, isTerminal: true }] },
    ] };
    const ids = [await eli.graph.talks.create(tennis('Same read')), await eli.graph.talks.create(deal)];
    for (const id of ids) await eli.sync.offerTalk(id, ['fay-b']);
    await until(() => ids.every((id) => fay.appliedVersions.some((a: any) => a.talk && fay.events.some((e: any) => e[1] === id))));
    for (const id of ids) {
      const applied = fay.appliedVersions.find((a: any) => a.versionId === id)!;
      expect(await fay.graph.arrivals.read(id, applied)).toEqual(await fay.graph.arrivals.read(id));
    }
  });

  it('a want names its content in `w`, so every frame keeps its head in `h` (OPEN-114)', async () => {
    const [ama, bo] = [await device('ama-b'), await device('bo-b')];
    void pump();
    await Promise.all([ama.sync.open('bo-b'), bo.sync.open('ama-b')]);
    const talkId = await ama.graph.talks.create(tennis('Want frame'));
    await ama.sync.offerTalk(talkId, ['bo-b']);
    await until(async () => !!(await bo.graph.arrivals.read(talkId)));
    const want = JSON.parse(ama.heard.find((raw: string) => raw.includes('"t":"want"'))!);
    expect(typeof want.h).toBe('number');
    expect(want.w).toEqual([expect.objectContaining({ talk: talkId, h: expect.any(String), v: expect.any(String) })]);
  });

  it('an offer still goes when the store never acknowledges who it was sent to (stage5 starter-tags)', async () => {
    const [gil, hal] = [await device('gil-b'), await device('hal-b')];
    void pump();
    await Promise.all([gil.sync.open('hal-b'), hal.sync.open('gil-b')]);
    const talkId = await gil.graph.talks.create(tennis('Sent record lost'));
    const put = gil.store.put.bind(gil.store);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(gil.store, 'put').mockImplementation((soul: string, value: any) => soul.startsWith('local/sync/sent/')
      ? Promise.reject(new Error(`storage did not acknowledge write for ${soul}`))
      : put(soul, value));
    await expect(gil.sync.offerTalk(talkId, ['hal-b'])).resolves.toBe(1);
    await until(async () => !!(await hal.graph.arrivals.read(talkId)));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('was not recorded'), expect.any(Error));
    jest.restoreAllMocks();
  });

  it('a blob nobody asked for is ignored, and a want under a name never given is not answered (OPEN-114)', async () => {
    const [cy, di] = [await device('cy-b'), await device('di-b')];
    void pump();
    await Promise.all([cy.sync.open('di-b'), di.sync.open('cy-b')]);
    await until(() => cy.heard.length > 0 && di.heard.length > 0);
    const pairOf = (raw: string) => JSON.parse(raw).p as string;
    const talkId = await cy.graph.talks.create(tennis('Made again'));
    const cyVersion = (await cy.graph.talks.read(talkId))!.versionId;
    // Content Di never asked for is not kept.
    di.sync.hear('cy-b', JSON.stringify({ gx: 1, p: pairOf(di.heard[0]), h: -1, t: 'blob', b: { forged: 'SEA{}' } }));
    await cy.sync.offerTalk(talkId, ['di-b']);
    await until(async () => !!(await di.graph.arrivals.read(talkId)));
    expect((await di.graph.arrivals.read(talkId))).toMatchObject({ title: 'Made again', versionId: cyVersion });
    // The blob Cy sent was made from the Talk's nodes (none stored), and only under its own name.
    const before = di.heard.length;
    cy.sync.hear('di-b', JSON.stringify({ gx: 1, p: pairOf(cy.heard[0]), h: -1, t: 'want', w: [{ h: 'f'.repeat(64), talk: talkId, v: cyVersion }] }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(di.heard.slice(before).some((raw: string) => raw.includes('"t":"blob"'))).toBe(false);
    expect(Object.keys(cy.gun._.graph).some((soul) => soul.startsWith('local/sync/blob/'))).toBe(false);
  });
});
