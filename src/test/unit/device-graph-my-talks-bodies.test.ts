/** @jest-environment node */

// OPEN-106 step 2e (iv): a Talk I created is kept once, in the device graph. Its `myTalks` entry
// stops holding the body, and reading the entry back gives the app exactly the Talk it saved.

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { createOwnTalks } from '../../core/device-graph/sync/own-talks';
import { createMyTalksBodies } from '../../core/device-graph/sync/my-talks-bodies';
import { CollectionStore } from '../../core/collections';
import { memoryGraphStore } from '../../core/graph-store';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = (id: string, title = 'Tennis partner') => ({
  id, title, type: 'flow', language: 'en', isAdult: false, authorId: 'me-user', authorName: 'Me',
  authorEpub: 'epub-of-me', usageCount: 3, isTemplate: false, createdAt: '2026-11-04T09:00:00.000Z',
  tags: [{ id: 't1', name: 'sport' }], matchThreshold: 1, collectionImportance: 'must-have',
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true }] },
  ],
});

function setup() {
  const nodes = memoryNodeStore();
  const graph = createDeviceGraph(nodes, { randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 3) });
  const ownTalks = createOwnTalks({ store: nodes, graph });
  const collections = new CollectionStore(memoryGraphStore());
  const bodies = createMyTalksBodies({ collections, graph, ownTalks });
  const entry = (talkId: string, title?: string, extra: Record<string, unknown> = {}) =>
    ({ talkId, title: title ?? 'Tennis partner', type: 'flow', role: 'created', timestamp: '2026-11-04T09:00:00.000Z', fullTalk: tennis(talkId, title), ...extra });
  return { graph, collections, bodies, entry };
}

describe('my Talks read from the device graph (my-talks-bodies)', () => {
  it('stores a created Talk once and gives it back exactly as saved', async () => {
    const d = setup();
    const id = await d.graph.ids.next(Date.parse('2026-11-04T09:00:00.000Z'));
    const saved = d.entry(id);
    await d.bodies.upsert({ [id]: saved });
    await d.bodies.idle();

    const raw = await d.collections.get('myTalks', id) as any;
    expect(raw.fullTalk).toBeUndefined();
    expect(raw.graphTalk).toBe(id);
    // The questions, title and tags come from the graph; the app's own counters stay.
    expect(raw.fullTalkRest?.questions).toBeUndefined();
    expect(raw.fullTalkRest?.title).toBeUndefined();
    expect(raw.fullTalkRest).toMatchObject({ usageCount: 3, authorId: 'me-user' });

    expect(await d.bodies.get(id)).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(await d.bodies.all()).toEqual({ [id]: JSON.parse(JSON.stringify(saved)) });
    expect(d.bodies.status()).toMatchObject({ stripped: 1, unreadable: 0 });
  });

  it('an entry read back after an edit and after deletion is the version it saved', async () => {
    const d = setup();
    const id = await d.graph.ids.next();
    await d.bodies.upsert({ [id]: d.entry(id) });
    await d.bodies.idle();
    const edited = d.entry(id, 'Tennis buddy');
    await d.bodies.upsert({ [id]: edited });
    await d.bodies.idle();
    expect(((await d.bodies.get(id)) as any).fullTalk.title).toBe('Tennis buddy');
    // Retracted: the graph Talk is deleted, the app keeps the entry (turned off) and its body.
    await d.graph.talks.remove(id);
    expect(await d.bodies.get(id)).toEqual(JSON.parse(JSON.stringify(edited)));
  });

  it('a newer write while a body is taken out wins', async () => {
    const d = setup();
    const id = await d.graph.ids.next();
    const first = d.bodies.upsert({ [id]: d.entry(id) });
    const newer = { talkId: id, title: 'Tennis partner', role: 'created', fullTalk: { not: 'a Talk' } };
    await first;
    await d.bodies.upsert({ [id]: newer });
    await d.bodies.idle();
    expect(await d.collections.get('myTalks', id)).toEqual(newer);
  });

  it('answered and copied-in entries keep their bodies', async () => {
    const d = setup();
    await d.bodies.upsert({ x: { ...d.entry('x'), role: 'answered' } });
    await d.bodies.idle();
    expect(((await d.collections.get('myTalks', 'x')) as any).fullTalk).toBeTruthy();
  });

  it('a removed entry is not brought back by a body taken out later', async () => {
    const d = setup();
    const id = await d.graph.ids.next();
    void d.bodies.upsert({ [id]: d.entry(id) });
    await d.bodies.remove([id]);
    await d.bodies.idle();
    expect(await d.collections.get('myTalks', id)).toBeUndefined();
  });
});
