/** @jest-environment node */

// `where` on my events (spec REQ-GRAPH-42, §31.7, OPEN-108 slice 3): with a locator installed my
// Talk versions, Talk deletions and answers are stamped with the blurred cell and their exact
// point lands in the private gps/<eventId> sidecar; the exact point never sits on the event
// itself. No locator, or a failing one, never blocks the write.

import { randomBytes } from 'crypto';
import SEA from 'gun/sea';
import { verifyChain } from '../../core/device-graph/chain';
import { createDeviceGraph, type DeviceGraph } from '../../core/device-graph/device-graph';
import { readIndex } from '../../core/device-graph/index-buckets';
import type { GpsPoint } from '../../core/device-graph/location-graph';
import { linkSoul, memoryNodeStore, type GraphNode } from '../../core/device-graph/node-store';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { portableEcdsaSign, portableEcdsaVerify } from '../../shared/portable-ecdsa';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(30_000);

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

type SeaPair = { pub: string; priv: string; epub: string; epriv: string };

// Golden Gate Park, San Francisco — far from any test-default location.
const POINT: GpsPoint = { latitude: 37.7694, longitude: -122.4862, accuracy: 12, source: 'gps' };

async function setup(locate?: () => Promise<GpsPoint | undefined>): Promise<{
  store: ReturnType<typeof memoryNodeStore>;
  graph: DeviceGraph;
  pair: SeaPair;
  souls: ReturnType<typeof graphSouls>;
}> {
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, {
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    ...(locate ? { locate } : {}),
  });
  const pair = (await (SEA as any).pair()) as SeaPair;
  return { store, graph, pair, souls: graphSouls(graph.prefix) };
}

/** The event fields, recursively, as one string — the exact point must not appear anywhere. */
const deep = (value: unknown): string => JSON.stringify(value);

describe('where on my events (REQ-GRAPH-42)', () => {

  it('stamps my Talk version with the blurred cell and keeps the exact point private', async () => {
    const { store, graph, souls } = await setup(async () => POINT);
    const talkId = await graph.talks.create(tennis());

    const event = (await store.get(souls.event(talkId)))!;
    const region = linkSoul(event.where)?.slice(`${graph.prefix}cell/`.length);
    expect(region).toMatch(/^cell_/);
    // The cell at the finest precision, with wider parents (spec §31.7).
    const cell = (await store.get(`${graph.prefix}cell/${region}`))!;
    expect(cell.precisionMeters).toBe(400);
    expect(linkSoul(cell.parent)).toContain(`${graph.prefix}cell/`);
    // The exact point sits in the private sidecar, and nowhere on the event.
    const gps = (await store.get(`${graph.prefix}gps/${talkId}`))!;
    expect(gps).toMatchObject({ latitude: POINT.latitude, longitude: POINT.longitude, accuracy: 12, source: 'gps' });
    expect(deep(event)).not.toContain(String(POINT.latitude));
    expect(deep(event)).not.toContain(String(POINT.longitude));
  });

  it('stamps edits, deletions and answers too', async () => {
    const { store, graph, souls } = await setup(async () => POINT);
    const talkId = await graph.talks.create(tennis());
    const editId = await graph.talks.edit(talkId, tennis('Tennis buddy'));
    const answerId = await graph.answers.answer({
      talkId, structure: (await graph.talks.read(talkId))!, withUser: 'adam', mode: 'manual', re: editId,
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    });
    const deleteId = await graph.talks.remove(talkId);
    const answerDeleteId = await graph.answers.remove(talkId);

    for (const eventId of [editId, answerId, deleteId, answerDeleteId] as string[]) {
      const event = await store.get(souls.event(eventId));
      expect(linkSoul(event?.where)).toContain(`${graph.prefix}cell/`);
      expect(await store.get(`${graph.prefix}gps/${eventId}`)).toMatchObject({ latitude: POINT.latitude, source: 'gps' });
    }
  });

  it('writes without where when no locator is installed', async () => {
    const { store, graph, souls } = await setup();
    const talkId = await graph.talks.create(tennis());
    const event = (await store.get(souls.event(talkId)))!;
    expect(event.where).toBeUndefined();
    expect(await store.get(`${graph.prefix}gps/${talkId}`)).toBeNull();
  });

  it('a failing locator never blocks the write', async () => {
    const { store, graph, souls } = await setup(async () => { throw new Error('no fix'); });
    const talkId = await graph.talks.create(tennis());
    const event = (await store.get(souls.event(talkId)))!;
    expect(event.where).toBeUndefined();
    expect(event.rev).toBeDefined();
  });

  it('the chain signs the event with its where', async () => {
    const { store, graph, pair, souls } = await setup(async () => POINT);
    graph.setChain({ sign: (message) => portableEcdsaSign(message, pair.priv), pub: pair.pub });
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));

    const readEvents = async () => {
      const out: Array<{ id: string; event: GraphNode }> = [];
      for (const entry of await readIndex(store, souls.index('day'))) {
        const event = await store.get(entry.target);
        if (event) out.push({ id: entry.key, event });
      }
      return out;
    };
    const result = await verifyChain(store, souls, { verify: portableEcdsaVerify }, { pub: pair.pub, deviceId: await graph.ids.deviceId() }, readEvents);
    expect(result).toMatchObject({ ok: true, checked: 2 });
    expect(linkSoul((await store.get(souls.event(talkId)))?.where)).toContain('cell/');
  });
});
