/** @jest-environment node */

// Redaction (spec §31.13, OPEN-108 slice 5): erase a record's content — its content nodes are
// cleared (every field null), its event and the event's hash stay, so the chain still verifies.
// The shared, content-addressed q//a/ texts of another Talk survive, a second redact clears
// nothing, and the crash rebuild tolerates the cleared nodes.

import { randomBytes } from 'crypto';
import SEA from 'gun/sea';
import { verifyChain } from '../../core/device-graph/chain';
import { createDeviceGraph, type DeviceGraph } from '../../core/device-graph/device-graph';
import { rebuildIndexes } from '../../core/device-graph/events';
import { readIndex } from '../../core/device-graph/index-buckets';
import type { GpsPoint } from '../../core/device-graph/location-graph';
import { linkSoul, memoryNodeStore, type GraphNode } from '../../core/device-graph/node-store';
import { redactEvent } from '../../core/device-graph/redact';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';
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

// A different structure (its own rev/<hash>) that shares the first question's and choices' texts.
const tennisTraining = () => ({
  title: 'Tennis training', type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [
      { id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' },
      { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_1', text: 'How often do you train?', answers: [
      { id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true },
      { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true },
    ] },
  ],
});

type SeaPair = { pub: string; priv: string; epub: string; epriv: string };

// Golden Gate Park, San Francisco (as device-graph-where.test.ts).
const POINT: GpsPoint = { latitude: 37.7694, longitude: -122.4862, accuracy: 12, source: 'gps' };

async function setup(): Promise<{
  store: ReturnType<typeof memoryNodeStore>;
  graph: DeviceGraph;
  pair: SeaPair;
  souls: ReturnType<typeof graphSouls>;
  verify: () => ReturnType<typeof verifyChain>;
}> {
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, { randomBytes: (n) => new Uint8Array(randomBytes(n)), locate: async () => POINT });
  const pair = (await (SEA as any).pair()) as SeaPair;
  graph.setChain({ sign: (message: string) => portableEcdsaSign(message, pair.priv), pub: pair.pub });
  const souls = graphSouls(graph.prefix);
  const readEvents = async () => {
    const out: Array<{ id: string; event: GraphNode }> = [];
    for (const entry of await readIndex(store, souls.index('day'))) {
      const event = await store.get(entry.target);
      if (event) out.push({ id: entry.key, event });
    }
    return out;
  };
  const deviceId = await graph.ids.deviceId();
  const verify = () => verifyChain(store, souls, { verify: portableEcdsaVerify }, { pub: pair.pub, deviceId }, readEvents);
  return { store, graph, pair, souls, verify };
}

describe('redaction (spec §31.13)', () => {

  it('redacting my answer event clears its answer set and exact point; the event and chain stay', async () => {
    const { store, graph, souls, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    const structure = (await graph.talks.read(talkId))!;
    const eventId = await graph.answers.answer({
      talkId, structure, withUser: 'adam', mode: 'manual', re: talkId,
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    });

    const eventBefore = JSON.stringify(await store.get(souls.event(eventId)));
    const setSoul = linkSoul((await store.get(souls.event(eventId)))!.gave)!;
    const { cleared } = await redactEvent(store, souls, eventId);

    // The set root, every situation's entry and the exact point are cleared.
    expect(cleared).toContain(setSoul);
    const sidecar = await store.get(`${souls.event(eventId)}/q`);
    const contexts = Object.keys(sidecar!);
    expect(contexts.length).toBe(2);
    for (const context of contexts) expect(cleared).toContain(`${setSoul}/${context}`);
    expect(cleared).toContain(`${graph.prefix}gps/${eventId}`);
    expect(await store.get(setSoul)).toEqual({ v: null });
    for (const context of contexts) expect(await store.get(`${setSoul}/${context}`)).toEqual({ a: null });
    expect(await store.get(`${graph.prefix}gps/${eventId}`)).toMatchObject({ latitude: null, longitude: null, accuracy: null, source: null, when: null });

    // The event is byte-identical and the chain still verifies.
    expect(JSON.stringify(await store.get(souls.event(eventId)))).toBe(eventBefore);
    expect(await verify()).toMatchObject({ ok: true, checked: 2 });
  });

  it('redacting my Talk version clears its structure records; a Talk sharing texts still reads', async () => {
    const { store, graph, souls, verify } = await setup();
    const talkA = await graph.talks.create(tennis());
    const talkB = await graph.talks.create(tennisTraining());

    const eventBefore = JSON.stringify(await store.get(souls.event(talkA)));
    const revSoul = linkSoul((await store.get(souls.event(talkA)))!.rev)!;
    const { cleared } = await redactEvent(store, souls, talkA);

    // Every rev/<key> record the version's structure write owns is cleared, nothing else.
    expect(cleared).toContain(revSoul);
    expect(cleared).toContain(`${revSoul}/order`);
    expect(cleared).toContain(`${revSoul}/q/q_0`);
    expect(cleared).toContain(`${revSoul}/q/q_0/choices`);
    expect(cleared).toContain(`${revSoul}/q/q_0/a/a_0_0`);
    expect(cleared).toContain(`${revSoul}/q/q_1/a/a_1_1`);
    expect(cleared.every((soul) => soul === revSoul || soul.startsWith(`${revSoul}/`) || soul === `${graph.prefix}gps/${talkA}`)).toBe(true);
    expect(await store.get(revSoul)).toMatchObject({ v: null, type: null, language: null, start: null, order: null });

    // The event is byte-identical and the chain still verifies.
    expect(JSON.stringify(await store.get(souls.event(talkA)))).toBe(eventBefore);
    expect(await verify()).toMatchObject({ ok: true, checked: 2 });

    // The second Talk, sharing the first question's q//a/ texts with the redacted one, still reads.
    const other = await graph.talks.read(talkB);
    expect(other?.questions[0]?.text).toBe('Do you play tennis?');
    expect(other?.questions[0]?.answers.map((a) => a.text)).toEqual(['Yes', 'No']);
    expect(other?.questions[1]?.text).toBe('How often do you train?');
    // The redacted Talk itself no longer reads.
    expect(await graph.talks.read(talkA)).toBeUndefined();
  });

  it('redacting after deletion: the chain still verifies and the Talk no longer reads', async () => {
    const { store, graph, souls, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.remove(talkId);
    const { cleared } = await redactEvent(store, souls, talkId);
    expect(cleared).toContain(linkSoul((await store.get(souls.event(talkId)))!.rev)!);
    expect(await verify()).toMatchObject({ ok: true, checked: 2 });
    expect(await graph.talks.read(talkId)).toBeUndefined();
    // The version no longer reads either: its structure is gone, its events stay.
    expect(await graph.talks.readVersion(talkId, talkId)).toBeUndefined();
    expect(await store.get(souls.event(talkId))).not.toBeNull();
  });

  it('is idempotent: a second redact clears nothing, and a missing event clears nothing', async () => {
    const { store, graph, souls } = await setup();
    const talkId = await graph.talks.create(tennis());
    const first = await redactEvent(store, souls, talkId);
    expect(first.cleared.length).toBeGreaterThan(0);
    expect(await redactEvent(store, souls, talkId)).toEqual({ cleared: [] });
    expect(await redactEvent(store, souls, 'no-such-event')).toEqual({ cleared: [] });
  });

  it('rebuildIndexes on the redacted store does not crash', async () => {
    const { store, graph, souls, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    const structure = (await graph.talks.read(talkId))!;
    const answerId = await graph.answers.answer({
      talkId, structure, withUser: 'adam', mode: 'manual', re: talkId,
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    });
    await graph.talks.remove(talkId);
    await redactEvent(store, souls, answerId);
    await redactEvent(store, souls, talkId);
    const result = await rebuildIndexes(store);
    expect(result.events).toBe(3);
    expect(await verify()).toMatchObject({ ok: true, checked: 3 });
  });

  it('keeps a shared s/<hash>: a deleted answer and its identical live re-answer share one set', async () => {
    const { store, graph, souls, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    const structure = (await graph.talks.read(talkId))!;
    const steps = [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }];
    const firstId = await graph.answers.answer({ talkId, structure, withUser: 'adam', mode: 'manual', re: talkId, steps });
    const setSoul = linkSoul((await store.get(souls.event(firstId)))!.gave)!;
    const setBefore = await store.get(setSoul);
    await graph.answers.remove(talkId);
    // Re-answer identically: REQ-GRAPH-22 keys the set by content, so the new event points at
    // the same s/<hash>. Redacting the DELETED first answer must not clear the live one's set.
    const secondId = await graph.answers.answer({ talkId, structure, withUser: 'adam', mode: 'manual', re: talkId, steps });
    expect(linkSoul((await store.get(souls.event(secondId)))!.gave)).toBe(setSoul);

    const { cleared } = await redactEvent(store, souls, firstId);
    expect(cleared).not.toContain(setSoul);
    expect(await store.get(setSoul)).toEqual(setBefore);
    const sidecar = await store.get(`${souls.event(secondId)}/q`);
    for (const context of Object.keys(sidecar!)) {
      expect(cleared).not.toContain(`${setSoul}/${context}`);
      expect(await store.get(`${setSoul}/${context}`)).not.toEqual({ a: null });
    }
    expect(await verify()).toMatchObject({ ok: true });
  });

  it('keeps a shared rev/<key>: two identical structures share one structure record', async () => {
    const { store, graph, souls } = await setup();
    const talkA = await graph.talks.create(tennis());
    const talkB = await graph.talks.create(tennis());
    const revSoul = linkSoul((await store.get(souls.event(talkA)))!.rev)!;
    expect(linkSoul((await store.get(souls.event(talkB)))!.rev)).toBe(revSoul);

    const { cleared } = await redactEvent(store, souls, talkA);
    expect(cleared).not.toContain(revSoul);
    // Talk B — which was never redacted — still reads its structure.
    expect(await graph.talks.read(talkB)).toBeDefined();
    expect((await store.get(revSoul))!.v).not.toBeNull();
  });

  it('a crafted event with a foreign rev link clears nothing and touches no other node', async () => {
    const { store, graph, souls } = await setup();
    const talkId = await graph.talks.create(tennis());
    const victimBefore = JSON.stringify(await store.get(souls.event(talkId)));
    // A crafted event whose `rev` points at ANOTHER EVENT (not a rev/<key>): the prefix guard
    // must refuse it, so redaction can never null a chained, signed event.
    await store.put(souls.event('crafted'), { v: 1, when: Date.now(), rev: { '#': souls.event(talkId) } } as any);

    expect(await redactEvent(store, souls, 'crafted')).toEqual({ cleared: [] });
    expect(JSON.stringify(await store.get(souls.event(talkId)))).toBe(victimBefore);
    // A path-ish event id just misses (souls are literal strings) and clears nothing.
    expect(await redactEvent(store, souls, '../q/x')).toEqual({ cleared: [] });
  });

  it('gps: false keeps the exact point while the content is cleared', async () => {
    const { store, graph, souls } = await setup();
    const talkId = await graph.talks.create(tennis());
    const structure = (await graph.talks.read(talkId))!;
    const eventId = await graph.answers.answer({
      talkId, structure, withUser: 'adam', mode: 'manual', re: talkId,
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }],
    });
    const setSoul = linkSoul((await store.get(souls.event(eventId)))!.gave)!;

    const { cleared } = await redactEvent(store, souls, eventId, { gps: false });
    expect(cleared).toContain(setSoul);
    expect(cleared).not.toContain(`${graph.prefix}gps/${eventId}`);
    expect((await store.get(`${graph.prefix}gps/${eventId}`))!.latitude).toBe(POINT.latitude);
  });

  it("the core request deviceGraph.redact returns the cleared souls", async () => {
    const store = memoryNodeStore();
    const graph = createDeviceGraph(store, { randomBytes: (n) => new Uint8Array(randomBytes(n)) });
    const talkId = await graph.talks.create(tennis());
    const souls = graphSouls(graph.prefix);
    const handle = createCoreHandler(memoryGraphStore(), { deviceGraph: { nodeStore: store, randomBytes: (n) => new Uint8Array(randomBytes(n)) } });

    const result = await handle({ name: 'deviceGraph.redact', eventId: talkId }) as { cleared: string[] };
    const revSoul = linkSoul((await store.get(souls.event(talkId)))!.rev)!;
    expect(result.cleared).toContain(revSoul);
    expect(await store.get(revSoul)).toMatchObject({ v: null, type: null });
    // Idempotent through the core too; a core without a device graph answers null.
    expect(await handle({ name: 'deviceGraph.redact', eventId: talkId })).toEqual({ cleared: [] });
    const without = createCoreHandler(memoryGraphStore());
    expect(await without({ name: 'deviceGraph.redact', eventId: talkId })).toBeNull();
  });
});
