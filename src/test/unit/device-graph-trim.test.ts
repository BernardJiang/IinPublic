/** @jest-environment node */

// Trimming old history (spec §31.13 REQ-GRAPH-47, OPEN-109 slice 2): from 90% of the storage
// limit, whole days are removed oldest-first down to 80%, after a signed checkpoint
// (REQ-GRAPH-46) summarizes the chain prefix about to go. Kept: the last 30 days, active Talks'
// first+latest versions, the chatbot's remembered answers and their content, and anything an
// unacknowledged pair-log entry names.

import { randomBytes } from 'crypto';
import SEA from 'gun/sea';
import { chainHeadSoul, checkpointIndexSoul, verifyChain } from '../../core/device-graph/chain';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { rebuildIndexes } from '../../core/device-graph/events';
import { addToIndex, readIndex } from '../../core/device-graph/index-buckets';
import { link, linkSoul, memoryNodeStore, type GraphNode, type NodeStore } from '../../core/device-graph/node-store';
import { personSoul } from '../../core/device-graph/people-graph';
import { graphSouls, talkStructureOf } from '../../core/device-graph/talk-structure';
import { trimHistory, type TrimResult } from '../../core/device-graph/trim';
import { portableEcdsaSign, portableEcdsaVerify } from '../../shared/portable-ecdsa';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(30_000);

const DAY = 86_400_000;
const BASE = Date.parse('2026-11-06T12:00:00Z');
const dayAgo = (days: number) => new Date(BASE - days * DAY).toISOString().slice(0, 10);

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

// A different question text, so this structure and its answer sets hash to their own content
// (the removable events own it solely — tennis() content is shared with the kept events).
const squash = (title = 'Squash partner') => ({
  title, type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play squash?', answers: [
      { id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' },
      { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_1', text: 'How often do you play?', answers: [
      { id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true },
      { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true },
    ] },
  ],
});

type SeaPair = { pub: string; priv: string; epub: string; epriv: string };

async function setup() {
  const store = memoryNodeStore();
  let clock = BASE;
  const graph = createDeviceGraph(store, {
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    now: () => clock,
    locate: async () => ({ latitude: 37.7, longitude: -122.4, source: 'gps' }),
  });
  const pair = (await (SEA as any).pair()) as SeaPair;
  const signer = { sign: (message: string) => portableEcdsaSign(message, pair.priv), pub: pair.pub };
  graph.setChain(signer);
  const souls = graphSouls(graph.prefix);
  /** The store's approximate size: every node's JSON length summed (the plan's usage mock). */
  const usage = async () => {
    let total = 0;
    for (const soul of store.souls()) total += JSON.stringify(await store.get(soul)).length;
    return total;
  };
  const at = async <T>(daysAgo: number, write: () => Promise<T>): Promise<T> => {
    clock = BASE - daysAgo * DAY;
    try { return await write(); } finally { clock = BASE; }
  };
  const readEvents = async () => {
    const out: Array<{ id: string; event: GraphNode }> = [];
    for (const entry of await readIndex(store, souls.index('day'))) {
      const event = await store.get(entry.target);
      if (event) out.push({ id: entry.key, event });
    }
    return out;
  };
  const verify = async () => verifyChain(store, souls, { verify: portableEcdsaVerify },
    { pub: pair.pub, deviceId: await graph.ids.deviceId() }, readEvents);
  const trim = (limitBytes: number): Promise<TrimResult> =>
    trimHistory(store as NodeStore, souls, signer, { usage, limitBytes, now: () => clock, allSouls: async () => store.souls() });
  return { store, graph, souls, signer, usage, at, verify, trim };
}

describe('trim old history (REQ-GRAPH-47)', () => {

  it('trims old unreferenced days after a checkpoint, keeping what the spec keeps', async () => {
    const { store, graph, souls, usage, at, verify, trim } = await setup();

    // Day 40: an old Talk an unacknowledged pair-log entry still names (inactive, so only the
    // log reference can keep it).
    const owedTalk = await at(40, () => graph.talks.create(tennis('Owed talk')));
    await graph.talks.setState(owedTalk, { active: false });
    // Days 39/38: an old inactive Talk, both versions removable.
    const oldTalk = await at(39, () => graph.talks.create(squash('Old talk')));
    const oldEdit = await at(38, () => graph.talks.edit(oldTalk, squash('Old talk v2')));
    await graph.talks.setState(oldTalk, { active: false });
    // Day 37: a Talk answered twice; the first answer (36d ctx replaced) is removable, …
    const answeredTalk = await at(37, () => graph.talks.create(tennis('Answered talk')));
    await graph.talks.setState(answeredTalk, { active: false });
    const firstAnswer = await at(37, () => graph.answers.answer({
      talkId: answeredTalk, structure: talkStructureOf(tennis()), mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_1'] }],
    }));
    // … the second (day 36) is the chatbot's remembered answer, kept with its s/ content.
    const remembered = await at(36, () => graph.answers.answer({
      talkId: answeredTalk, structure: talkStructureOf(tennis()), mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    }));
    // Day 35: a received Talk (its copied version and my arrival), both removable.
    const theirRevSoul = await at(35, async () => {
      const result = await graph.arrivals.receive({
        talkId: 'their-talk-1', versionId: 'their-version-1', authorId: 'ann',
        when: BASE - 35 * DAY, device: 'ann-device', talk: squash('Ann talk'),
      }, { userId: 'ann' });
      expect(result.arrivalId).toBeDefined();
      return linkSoul((await store.get(souls.event('their-version-1')))?.rev);
    });
    // Days 34/33: an ACTIVE Talk whose first and latest versions are over 30 days old — kept.
    const activeTalk = await at(34, () => graph.talks.create(tennis('Active old talk')));
    const activeEdit = await at(33, () => graph.talks.edit(activeTalk, tennis('Active old talk v2')));
    // Recent days: never touched.
    const recentTalk = await at(5, () => graph.talks.create(tennis('Recent talk')));
    const recentAnswer = await at(2, () => graph.answers.answer({
      talkId: recentTalk, structure: talkStructureOf(tennis()), mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }],
    }));

    // An unacknowledged pair-log entry naming the 40-day-old Talk (crafted as graph-sync's
    // append() writes it: sync/out state, the owed marker, and the log block entry).
    const prefix = graph.prefix;
    await store.put(`${prefix}sync/out/${encodeURIComponent('bob')}`, { n: 0, hash: 'h0' });
    await store.put(`${prefix}sync/owed`, { bob: 0 });
    await store.put(`g/${'a'.repeat(32)}/p/${'b'.repeat(32)}/log/0`, {
      '0': JSON.stringify({
        n: 0, prev: '', when: BASE - 40 * DAY, by: 'me', sig: 's',
        body: { offer: { talkId: owedTalk, versionId: owedTalk, talkTag: 't', key: 'k' } },
      }),
    });

    const before = await usage();
    const limit = Math.floor(before / 0.92); // usage sits at ~92% of the limit
    const result = await trim(limit);

    // A checkpoint was written FIRST (REQ-GRAPH-46), at the chain head, before anything went.
    const head = await store.get(chainHeadSoul(souls));
    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint!.seq).toBe(Number(head!.seq));
    expect(result.checkpoint!.hash).toBe(String(head!.hash));
    expect(await store.get(checkpointIndexSoul(souls))).toMatchObject({ seq: result.checkpoint!.seq });

    // The trim removed whole old days, oldest first; usage dropped.
    expect(result.days).toEqual([dayAgo(39), dayAgo(38), dayAgo(37), dayAgo(35)]);
    expect(result.events).toBeGreaterThan(0);
    expect(result.content).toBeGreaterThan(0);
    const after = await usage();
    expect(after).toBeLessThan(before);
    expect(result.done).toBe(after < 0.8 * limit); // done exactly when the 80% target was reached

    // The day index no longer lists the trimmed events, and their fields are nulled.
    const listed = new Set((await readIndex(store, souls.index('day'))).map((entry) => entry.key));
    for (const id of [oldTalk, oldEdit, firstAnswer, 'their-version-1']) expect(listed.has(id)).toBe(false);
    for (const id of [owedTalk, answeredTalk, remembered, activeTalk, activeEdit, recentTalk, recentAnswer]) expect(listed.has(id)).toBe(true);
    const trimmedOld = await store.get(souls.event(oldTalk));
    expect(Object.values(trimmedOld!).every((value) => value === null)).toBe(true);
    // Its gps sidecar went with it.
    expect((await store.get(`${prefix}gps/${oldEdit}`))?.latitude).toBeNull();
    // The received version's structure, solely owned, was cleared.
    expect(theirRevSoul).toBeDefined();
    expect(Object.values((await store.get(theirRevSoul!))!).every((value) => value === null)).toBe(true);
    // The inactive old Talk no longer reads.
    expect(await graph.talks.read(oldTalk)).toBeUndefined();

    // KEPT: the active Talk's first + latest version events, still readable.
    expect(linkSoul((await store.get(souls.event(activeTalk)))?.rev)).toBeDefined();
    expect(linkSoul((await store.get(souls.event(activeEdit)))?.rev)).toBeDefined();
    expect((await graph.talks.read(activeTalk))?.title).toBe('Active old talk v2');
    // KEPT: the chatbot's remembered answer and the content it points to.
    expect(linkSoul((await store.get(souls.event(remembered)))?.gave)).toBeDefined();
    expect(await graph.answers.answerSet(remembered)).toBeDefined();
    // KEPT: the event the unacknowledged pair-log entry names, structure included.
    expect(linkSoul((await store.get(souls.event(owedTalk)))?.rev)).toBeDefined();
    expect(await graph.talks.read(owedTalk)).toBeDefined();
    // KEPT: the last 30 days.
    expect(linkSoul((await store.get(souls.event(recentTalk)))?.rev)).toBeDefined();
    expect(linkSoul((await store.get(souls.event(recentAnswer)))?.gave)).toBeDefined();

    // The chain still verifies, checkpoint-scoped (REQ-GRAPH-41/46).
    expect(await verify()).toMatchObject({ ok: true, fromSeq: result.checkpoint!.seq + 1 });

    // No index entry links a removed event: scan the known indexes for dangling ev links.
    const removed = new Set([oldTalk, oldEdit, firstAnswer, 'their-version-1']
      .filter((id) => !listed.has(id)).map((id) => souls.event(id)));
    const dangling: string[] = [];
    for (const soul of store.souls().filter((s) => s.startsWith(souls.index('')) || s.startsWith(souls.mine('')))) {
      const node = await store.get(soul);
      for (const value of Object.values(node || {})) {
        const target = linkSoul(value);
        if (target && removed.has(target)) dangling.push(`${soul} -> ${target}`);
      }
    }
    expect(dangling).toEqual([]);

    // The indexes rebuild from what remains, and a second rebuild has nothing left to repair.
    expect((await rebuildIndexes(store as NodeStore)).repaired).toBe(0);
  });

  it('is a no-op below 90% of the limit', async () => {
    const { graph, trim } = await setup();
    await graph.talks.create(tennis());
    const result = await trim(1_000_000_000);
    expect(result).toEqual({ days: [], events: 0, content: 0, done: true });
    expect(result.checkpoint).toBeUndefined();
  });

  it('a second run with nothing more to remove is a no-op', async () => {
    const { graph, usage, at, trim } = await setup();
    const old = await at(39, () => graph.talks.create(tennis('Old talk')));
    await graph.talks.setState(old, { active: false });
    const before = await usage();
    const limit = Math.floor(before / 0.92);
    const first = await trim(limit);
    expect(first.events).toBeGreaterThan(0);
    const second = await trim(limit);
    expect(second.days).toEqual([]);
    expect(second.events).toBe(0);
    expect(second.content).toBe(0);
  });

  it('trims an old message event: its conv entry goes, its dedupe marker stays (a re-delivery must not duplicate)', async () => {
    const { store, graph, souls, usage, at, trim } = await setup();
    const prefix = graph.prefix;
    // A 39-day-old received message (the receiveMessage shape): event, conv day-bucket entry,
    // and the conv-seen marker keyed by the SENDER's event id pointing at my copy.
    const when = BASE - 39 * DAY;
    const msgId = `${String(when).padStart(13, '0')}-${'e'.repeat(32)}-0`;
    const senderEventId = `${String(when - 1000).padStart(13, '0')}-${'f'.repeat(32)}-0`;
    await at(39, async () => {
      await store.put(souls.event(msgId), {
        v: 1, when, device: 'dev', with: link(personSoul(prefix, 'adam')),
        conv: link(souls.mine('conv/c9')), text: 'old hello', re: link(souls.event(senderEventId)),
      });
      await addToIndex(store as NodeStore, souls.index('day'), { key: msgId, target: souls.event(msgId), when }, 'hour');
      await addToIndex(store as NodeStore, souls.index('conv/c9'), { key: msgId, target: souls.event(msgId), when }, 'day');
      await store.put(souls.index('conv-seen/c9'), { [senderEventId]: link(souls.event(msgId)) });
      // Volume so the trim has something to remove past the message.
      await graph.talks.create(squash('Trim volume'));
      await graph.talks.setState((await readIndex(store as NodeStore, souls.index('mine-talks')))[0]!.key, { active: false });
    });

    const before = await usage();
    const limit = Math.floor(before / 0.92);
    const result = await trim(limit);
    expect(result.events).toBeGreaterThan(0);

    // The message event is trimmed and its conversation entry is gone…
    expect((await store.get(souls.event(msgId)))!.text).toBeNull();
    expect(await readIndex(store as NodeStore, souls.index('conv/c9'))).toEqual([]);
    // …but the dedupe marker KEEPS its link: a re-delivered copy still reads as seen.
    const marker = await store.get(souls.index('conv-seen/c9'));
    expect(linkSoul(marker![senderEventId])).toBe(souls.event(msgId));
  });

  it('reports blockedByOwedLogs when an owed peer\'s log is unreadable ciphertext (the production shape)', async () => {
    const { store, graph, souls, usage, at, trim } = await setup();
    // An old, otherwise-removable Talk…
    const old = await at(39, () => graph.talks.create(tennis('Old talk')));
    await graph.talks.setState(old, { active: false });
    // …and an owed peer whose log entries are SEA ciphertext (production shape): the keep-all
    // fallback fires and the result SAYS trimming is blocked, instead of a silent done:false.
    const prefix = graph.prefix;
    await store.put(`${prefix}sync/out/${encodeURIComponent('carol')}`, { n: 0, hash: 'h0' });
    await store.put(`${prefix}sync/owed`, { carol: 0 });
    await store.put(`g/${'c'.repeat(32)}/p/${'d'.repeat(32)}/log/0`, { '0': 'SEA{"ct":"aXk9…","iv":"…","s":"…"}' });

    const before = await usage();
    const limit = Math.floor(before / 0.92);
    const result = await trim(limit);
    expect(result.blockedByOwedLogs).toBe(true);
    expect(result.done).toBe(false);
    expect(result.days).toEqual([]);
    expect(result.events).toBe(0);
    // Nothing was removed: the old Talk still reads, chain intact.
    expect(await graph.talks.read(old)).toBeDefined();
    expect(linkSoul((await store.get(souls.event(old)))?.rev)).toBeDefined();
  });
});
