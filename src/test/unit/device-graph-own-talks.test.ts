/** @jest-environment node */

// OPEN-106 step 2e: my Talks are graph Talks. A Talk the app created under a graph id is that
// graph Talk; one the app knows by another id (a copy, a starter tag) is my new graph Talk copied
// from it; an unchanged rewrite writes nothing; a deleted Talk turned on again is a new Talk.

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { createOwnTalks } from '../../core/device-graph/sync/own-talks';
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = (title = 'Tennis partner') => ({
  title, type: 'flow', language: 'en', isAdult: false, authorId: 'me',
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true }] },
  ],
});

function setup() {
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, { randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 7) });
  const own = createOwnTalks({ store, graph });
  const entry = (talkId: string, title = 'Tennis partner', extra: Record<string, unknown> = {}) =>
    ({ talkId, title, type: 'flow', timestamp: '2026-11-04T09:00:00.000Z', role: 'created', fullTalk: { ...tennis(title), id: talkId }, ...extra });
  return { store, graph, own, entry };
}

describe('my Talks in the device graph (own-talks)', () => {
  it('a Talk saved under a graph id of this device is that graph Talk; an edit is a new version of it', async () => {
    const d = setup();
    const id = await d.graph.ids.next(Date.parse('2026-11-04T09:00:00.000Z'));
    expect(await d.own.ensure(d.entry(id))).toBe(id);
    expect(await d.graph.talks.read(id)).toMatchObject({ id, title: 'Tennis partner', createdAt: Date.parse('2026-11-04T09:00:00.000Z') });
    // The app rewrites entries often: unchanged, nothing is written.
    await d.own.onUpsert({ [id]: { ...d.entry(id), lastInteraction: 'now' } });
    expect(await d.graph.talks.history(id)).toHaveLength(1);

    await d.own.onUpsert({ [id]: d.entry(id, 'Tennis buddy', { disabled: true }) });
    expect(await d.graph.talks.history(id)).toHaveLength(2);
    expect(await d.graph.talks.read(id)).toMatchObject({ title: 'Tennis buddy', active: false });
    expect(await d.own.status()).toMatchObject({ talks: 1, versions: 1, errors: 0 });
    expect(await d.own.graphTalkId(id)).toBe(id);
    expect(await d.own.appTalkId(id)).toBe(id);
  });

  it('a Talk the app knows by another id is my own graph Talk copied from it', async () => {
    const d = setup();
    const talkId = await d.own.ensure(d.entry('starter-pizza'));
    expect(talkId).toBeTruthy();
    expect(talkId).not.toBe('starter-pizza');
    expect(await d.own.graphTalkId('starter-pizza')).toBe(talkId);
    expect(await d.own.appTalkId(talkId!)).toBe('starter-pizza');
    // An id of another device is not mine either.
    const foreign = `1793000000000-${'f'.repeat(32)}-1`;
    const copied = await d.own.ensure(d.entry(foreign));
    expect(copied).not.toBe(foreign);
    expect(await d.own.appTalkId(copied!)).toBe(foreign);
  });

  it('a Talk deleted and turned on again is a new graph Talk (receivers keep the deleted one deleted)', async () => {
    const d = setup();
    const id = await d.graph.ids.next();
    await d.own.ensure(d.entry(id));
    await d.graph.talks.remove(id);
    expect(await d.own.graphTalkId(id)).toBeUndefined();
    const again = await d.own.ensure(d.entry(id));
    expect(again).toBeTruthy();
    expect(again).not.toBe(id);
    expect(await d.own.graphTalkId(id)).toBe(again);
    expect(await d.own.appTalkId(again!)).toBe(id);
  });

  it('only Talks I created go in: answered and ignored entries do not', async () => {
    const d = setup();
    await d.own.onUpsert({ a: { ...d.entry('a'), role: 'answered' }, b: { ...d.entry('b'), role: 'ignored' } });
    expect(await d.own.status()).toMatchObject({ talks: 0 });
  });

  it('a core without graph links hands out no graph ids (the app keeps content-hash ids there)', async () => {
    const handle = createCoreHandler(memoryGraphStore(), { deviceGraph: { nodeStore: memoryNodeStore(), randomBytes: (n) => new Uint8Array(n) } });
    expect(await handle({ name: 'graph.newTalkId' })).toBeNull();
    expect(await handle({ name: 'deviceGraph.status' })).toBeNull();
  });
});
