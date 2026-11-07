/** @jest-environment node */

// My device event chain (spec REQ-GRAPH-40, OPEN-108 slice 1): every event I write is chained
// (seq, prev hash, my signature) and `ix/head` follows it; `verifyChain` (REQ-GRAPH-41) walks the
// chain and reports a tampered event, a gap, a broken prev link, and keeps legacy un-chained
// events and other devices' chained events out of my chain.

import { randomBytes } from 'crypto';
import SEA from 'gun/sea';
import { chainHeadSoul, checkpointIndexSoul, checkpointSoul, eventHash, verifyChain, writeCheckpoint } from '../../core/device-graph/chain';
import { createDeviceGraph, type DeviceGraph } from '../../core/device-graph/device-graph';
import { putEvent, rebuildIndexes } from '../../core/device-graph/events';
import { readIndex } from '../../core/device-graph/index-buckets';
import { link, memoryNodeStore, type GraphLink, type GraphNode, type NodeStore } from '../../core/device-graph/node-store';
import { createGraphHost, type GraphHostStatus } from '../../core/device-graph/sync/graph-host';
import type { GraphCrypto, SeaPair as GraphSeaPair } from '../../core/device-graph/sync/graph-sync';
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

async function setup(): Promise<{
  store: ReturnType<typeof memoryNodeStore>;
  graph: DeviceGraph;
  pair: SeaPair;
  souls: ReturnType<typeof graphSouls>;
  verify: () => ReturnType<typeof verifyChain>;
  myEvents: () => Promise<Array<{ id: string; event: GraphNode }>>;
  signer: { sign(message: string): Promise<string>; pub: string };
}> {
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, { randomBytes: (n) => new Uint8Array(randomBytes(n)) });
  const pair = (await (SEA as any).pair()) as SeaPair;
  const signer = { sign: (message: string) => portableEcdsaSign(message, pair.priv), pub: pair.pub };
  graph.setChain(signer);
  const souls = graphSouls(graph.prefix);
  // Every event, loaded through the day index as `rebuildIndexes` does (events.ts lines 59-70).
  const readEvents = async () => {
    const out: Array<{ id: string; event: GraphNode }> = [];
    for (const entry of await readIndex(store, souls.index('day'))) {
      const event = await store.get(entry.target);
      if (event) out.push({ id: entry.key, event });
    }
    return out;
  };
  const deviceId = await graph.ids.deviceId();
  const myEvents = async () => (await readEvents())
    .filter(({ event }) => typeof event.seq === 'number' && event.device === deviceId)
    .sort((a, b) => Number(a.event.seq) - Number(b.event.seq));
  const verify = () => verifyChain(store, souls, { verify: portableEcdsaVerify }, { pub: pair.pub, deviceId }, readEvents);
  return { store, graph, pair, souls, verify, myEvents, signer };
}

describe('device event chain (REQ-GRAPH-40)', () => {

  it('chains every event I write in order', async () => {
    const { store, graph, souls, verify, myEvents } = await setup();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await graph.talks.remove(talkId);

    const mine = await myEvents();
    expect(mine.map(({ event }) => event.seq)).toEqual([0, 1, 2]);
    expect(String(mine[0]!.event.prev ?? '')).toBe('');
    for (let i = 1; i < mine.length; i++) expect(mine[i]!.event.prev).toBe(eventHash(mine[i - 1]!.event));
    for (const { event } of mine) expect(typeof event.sig).toBe('string');
    // The head names the last event I wrote.
    const head = await store.get(chainHeadSoul(souls));
    expect(head).toEqual({ seq: mine.length - 1, hash: eventHash(mine.at(-1)!.event) });
    expect(await verify()).toEqual({ checked: 3, ok: true, fromSeq: 0 });
  });

  it('detects a tampered event', async () => {
    const { store, souls, graph, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await store.put(souls.event(talkId), { title: 'Hacked title' });
    const result = await verify();
    expect(result).toMatchObject({ ok: false, firstBadSeq: 0, reason: 'sig', checked: 0 });
  });

  it('detects a gap', async () => {
    const { store, souls, graph, verify, myEvents } = await setup();
    const talkId = await graph.talks.create(tennis());
    const editId = await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await graph.talks.remove(talkId);
    // The middle event's chain fields are gone; the day index still lists it.
    await store.put(souls.event(editId), { seq: null, prev: null, sig: null });
    const result = await verify();
    expect(result).toMatchObject({ ok: false, firstBadSeq: 1, reason: 'gap', checked: 1 });
    expect((await myEvents()).map(({ event }) => event.seq)).toEqual([0, 2]);
  });

  it('detects a broken prev link', async () => {
    const { store, souls, graph, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    const editId = await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await store.put(souls.event(editId), { prev: 'not-the-real-hash' });
    const result = await verify();
    expect(result).toMatchObject({ ok: false, firstBadSeq: 1, reason: 'prev', checked: 1 });
  });

  it('ignores legacy un-chained events', async () => {
    const { store, souls, graph, verify } = await setup();
    const deviceId = await graph.ids.deviceId();
    // Written as before the chain existed: through putEvent with no chain, carrying no seq.
    await putEvent(store as NodeStore, souls, 'legacy-event', { v: 1, when: Date.now(), device: deviceId });
    expect(await verify()).toEqual({ checked: 0, ok: true, fromSeq: 0 });
    // My next chained write starts the chain at seq 0.
    const talkId = await graph.talks.create(tennis());
    expect((await store.get(souls.event(talkId)))?.seq).toBe(0);
    expect(await verify()).toEqual({ checked: 1, ok: true, fromSeq: 0 });
  });

  it("never chains another author's record I hold locally (a `by` event)", async () => {
    const { store, souls, verify, signer } = await setup();
    const received: GraphNode = { v: 1, when: Date.now(), device: 'author-device', by: link('~author-pub'), rev: link(souls.event('talk-1')) };
    await putEvent(store as NodeStore, souls, 'received-rev', received, signer);
    // Stored unchanged: no seq/prev/sig from my chain, and my head is untouched.
    expect(await store.get(souls.event('received-rev'))).toEqual(received);
    expect(await store.get(chainHeadSoul(souls))).toBeNull();
    expect(await verify()).toEqual({ checked: 0, ok: true, fromSeq: 0 });
  });

  it("keeps another device's chained event out of mine", async () => {
    const { store, souls, verify, signer } = await setup();
    const synced: GraphNode = { v: 1, when: Date.now(), device: 'other-device', seq: 0, prev: '', sig: 'x' };
    await putEvent(store as NodeStore, souls, 'synced-event', synced, signer);
    // Stored unchanged, and it does not move my head.
    expect(await store.get(souls.event('synced-event'))).toEqual(synced);
    expect(await store.get(chainHeadSoul(souls))).toBeNull();
    expect(await verify()).toEqual({ checked: 0, ok: true, fromSeq: 0 });
  });

  it('fails when all my events are stripped while the head still names a seq', async () => {
    const { store, graph, souls, verify } = await setup();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await graph.talks.remove(talkId);
    // Strip my ownership: every event's device field overwritten so none count as mine.
    for (const entry of await readIndex(store, souls.index('day')))
      await store.put(entry.target, { device: 'stripped-device' });
    expect(await verify()).toEqual({ checked: 0, ok: false, firstBadSeq: 0, reason: 'head', fromSeq: 0 });
  });

  it('chains concurrent writes without interleaving', async () => {
    const { store, graph, souls, verify, myEvents } = await setup();
    await Promise.all([
      graph.talks.create(tennis('One')),
      graph.talks.create(tennis('Two')),
      graph.talks.create(tennis('Three')),
    ]);
    const mine = await myEvents();
    expect(mine.map(({ event }) => Number(event.seq))).toEqual([0, 1, 2]);
    const head = await store.get(chainHeadSoul(souls));
    expect(head?.seq).toBe(mine.length - 1);
    expect(await verify()).toEqual({ checked: 3, ok: true, fromSeq: 0 });
  });
});

describe('verified at start (REQ-GRAPH-41, OPEN-108 slice 2)', () => {

  it('rebuild reports the break and repairs nothing', async () => {
    const { store, graph, pair } = await setup();
    const deviceId = await graph.ids.deviceId();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await graph.talks.remove(talkId);
    const chainOption = { chain: { verify: portableEcdsaVerify, pub: pair.pub, deviceId } };

    // An intact chain verifies as the indexes rebuild.
    const intact = await rebuildIndexes(store as NodeStore, chainOption);
    expect(intact.chain).toEqual({ checked: 3, ok: true, fromSeq: 0 });

    // Tamper one stored event: the rebuild reports the break and leaves the event as it is.
    await store.put(graphSouls(graph.prefix).event(talkId), { title: 'Hacked title' });
    const broken = await rebuildIndexes(store as NodeStore, chainOption);
    expect(broken.chain).toMatchObject({ ok: false, firstBadSeq: 0, reason: 'sig', checked: 0 });
    expect((await store.get(graphSouls(graph.prefix).event(talkId)))?.title).toBe('Hacked title');

    // Without `options.chain` the return carries no chain result.
    const plain = await rebuildIndexes(store as NodeStore);
    expect(plain).not.toHaveProperty('chain');
  });

  it('rebuildIndexes refuses fromDay combined with chain verification', async () => {
    const { store, graph, pair } = await setup();
    graph.setChain({ sign: (message) => portableEcdsaSign(message, (pair as GraphSeaPair).priv), pub: (pair as GraphSeaPair).pub });
    await graph.talks.create(tennis());
    await expect(rebuildIndexes(store as NodeStore, {
      fromDay: '2000-01-01',
      chain: { verify: portableEcdsaVerify, pub: (pair as GraphSeaPair).pub, deviceId: await graph.ids.deviceId() },
    })).rejects.toThrow('chain verification needs the full event log');
  });

  it('graph.status reports chainBreaks once an identity is installed', async () => {
    const { store, graph, pair, souls } = await setup();
    const crypto: GraphCrypto = {
      secret: async (epub, p) => (await (SEA as any).secret(epub, p)) || undefined,
      encrypt: async (data, key) => String(await (SEA as any).encrypt(data, key)),
      decrypt: async (data, key) => (SEA as any).decrypt(data, key),
      sign: portableEcdsaSign,
      verify: portableEcdsaVerify,
      randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    };
    // No links are opened, so the fake Gun is never driven past its options object.
    const gun = { _: { opt: {} } };
    const host = createGraphHost({ gun, store: store as NodeStore, graph, crypto });

    // No identity yet: no chain in the status.
    const anonymous = (await host.handle({ name: 'graph.status' })) as GraphHostStatus;
    expect(anonymous).not.toHaveProperty('chain');

    await host.handle({ name: 'graph.identity', userId: 'me', pair: pair as GraphSeaPair });
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));

    const intact = (await host.handle({ name: 'graph.status' })) as GraphHostStatus;
    expect(intact.chain).toMatchObject({ ok: true, checked: 2, chainBreaks: 0 });

    await store.put(souls.event(talkId), { title: 'Hacked title' });
    const broken = (await host.handle({ name: 'graph.status' })) as GraphHostStatus;
    expect(broken.chain).toMatchObject({ ok: false, chainBreaks: 1, firstBadSeq: 0, reason: 'sig' });
    // Reported, never repaired: the tampered value is still what is stored.
    expect((await store.get(souls.event(talkId)))?.title).toBe('Hacked title');
  });
});

describe('signed chain checkpoints (REQ-GRAPH-46, OPEN-109 slice 1)', () => {

  /** Simulate trimming: wipe every field of the events at or below `seq`, day index untouched. */
  const trimThrough = async (store: NodeStore, souls: ReturnType<typeof graphSouls>, ids: string[], seq: number) => {
    for (const id of ids) {
      const soul = souls.event(id);
      const event = await store.get(soul);
      if (event && typeof event.seq === 'number' && Number(event.seq) <= seq)
        await store.put(soul, Object.fromEntries(Object.keys(event).map((k) => [k, null])));
    }
  };

  it('summarizes the pre-checkpoint prefix: tampering an old event still verifies', async () => {
    const { store, graph, souls, verify, myEvents, signer } = await setup();
    const talkId = await graph.talks.create(tennis());            // seq 0
    await graph.talks.edit(talkId, tennis('Tennis buddy'));       // seq 1
    await graph.talks.remove(talkId);                             // seq 2
    const cp = await writeCheckpoint(store as NodeStore, souls, signer);
    expect(cp).toMatchObject({ seq: 2, counts: { events: 3, days: 0 } });
    expect(typeof cp.sig).toBe('string');
    expect(await store.get(checkpointIndexSoul(souls)))
      .toEqual({ seq: 2, hash: eventHash((await store.get(checkpointSoul(souls, 2)))!) });

    await graph.talks.create(tennis('After'));                    // seq 3
    // Tamper an event BELOW the checkpoint: the signed checkpoint summarizes that prefix.
    await store.put(souls.event(talkId), { title: 'Hacked title' });
    expect(await verify()).toEqual({ checked: 1, ok: true, fromSeq: 3 });
    expect((await myEvents()).map(({ event }) => event.seq)).toEqual([0, 1, 2, 3]);
  });

  it('still detects a tampered POST-checkpoint event', async () => {
    const { store, graph, souls, verify, signer } = await setup();
    const talkId = await graph.talks.create(tennis());            // seq 0
    await writeCheckpoint(store as NodeStore, souls, signer);     // cp at seq 0
    const editId = await graph.talks.edit(talkId, tennis('Tennis buddy')); // seq 1
    await graph.talks.remove(talkId);                             // seq 2
    await store.put(souls.event(editId), { title: 'Hacked title' });
    expect(await verify()).toMatchObject({ ok: false, firstBadSeq: 1, reason: 'sig', checked: 0, fromSeq: 1 });
  });

  it('verifies after the pre-checkpoint events are trimmed away', async () => {
    const { store, graph, souls, verify, myEvents, signer } = await setup();
    const talkId = await graph.talks.create(tennis());            // seq 0
    await graph.talks.edit(talkId, tennis('Tennis buddy'));       // seq 1
    await writeCheckpoint(store as NodeStore, souls, signer);     // cp at seq 1
    await graph.talks.remove(talkId);                             // seq 2
    const ids = (await myEvents()).map(({ id }) => id);
    await trimThrough(store as NodeStore, souls, ids, 1);         // events seq 0..1 gone
    expect(await verify()).toEqual({ checked: 1, ok: true, fromSeq: 2 });
    const head = await store.get(chainHeadSoul(souls));
    expect(head).toMatchObject({ seq: 2 });
    expect((await myEvents()).map(({ event }) => event.seq)).toEqual([2]);
  });

  it('fails with reason cp when the checkpoint node itself is tampered', async () => {
    const { store, graph, souls, verify, signer } = await setup();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await writeCheckpoint(store as NodeStore, souls, signer);     // cp at seq 1
    await store.put(checkpointSoul(souls, 1), { hash: 'not-the-real-hash' });
    expect(await verify()).toMatchObject({ ok: false, firstBadSeq: 1, reason: 'cp' });
  });

  it('fails with reason cp when an older checkpoint in the chain is tampered', async () => {
    const { store, graph, souls, verify, signer } = await setup();
    const talkId = await graph.talks.create(tennis());            // seq 0
    await graph.talks.edit(talkId, tennis('Tennis buddy'));       // seq 1
    const first = await writeCheckpoint(store as NodeStore, souls, signer);
    await graph.talks.remove(talkId);                             // seq 2
    const second = await writeCheckpoint(store as NodeStore, souls, signer);
    expect(second.prevCp).toEqual({ seq: first.seq, hash: eventHash(first as unknown as GraphNode) });
    expect(await verify()).toEqual({ checked: 0, ok: true, fromSeq: 3 });
    // Tamper the older checkpoint: the prevCp link from the newer one no longer matches it.
    await store.put(checkpointSoul(souls, first.seq), { prevCp: { seq: 99, hash: 'fake' } as unknown as GraphLink });
    expect(await verify()).toMatchObject({ ok: false, firstBadSeq: first.seq, reason: 'cp' });
  });

  it('fails closed with reason cp when ix/cp names a missing checkpoint node', async () => {
    const { store, graph, souls, verify, signer } = await setup();
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await writeCheckpoint(store as NodeStore, souls, signer);     // cp at seq 1
    // ix/cp still names it, but the cp/<seq> node is gone (e.g. a partial trim or corruption).
    await store.put(checkpointSoul(souls, 1), Object.fromEntries(
      Object.keys((await store.get(checkpointSoul(souls, 1)))!).map((k) => [k, null])));
    expect(await verify()).toMatchObject({ ok: false, firstBadSeq: 1, reason: 'cp' });
  });

  it('fails with reason cp when the still-stored anchor event no longer matches the checkpoint', async () => {
    const { store, graph, souls, verify, signer } = await setup();
    const talkId = await graph.talks.create(tennis());            // seq 0
    const editId = await graph.talks.edit(talkId, tennis('Tennis buddy')); // seq 1
    await writeCheckpoint(store as NodeStore, souls, signer);     // cp at seq 1, anchored on the edit
    // Tamper the ANCHOR event itself (still stored): its recomputed hash no longer equals
    // cp.hash, so the checkpoint's summary is provably broken.
    await store.put(souls.event(editId), { title: 'Hacked title' });
    expect(await verify()).toMatchObject({ ok: false, firstBadSeq: 1, reason: 'cp' });
  });

  it('refuses a second checkpoint at the same head and a checkpoint without any chain', async () => {
    const { store, graph, souls, verify, signer } = await setup();
    await expect(writeCheckpoint(store as NodeStore, souls, signer)).rejects.toThrow('no chain head');
    const talkId = await graph.talks.create(tennis());
    await graph.talks.edit(talkId, tennis('Tennis buddy'));
    await writeCheckpoint(store as NodeStore, souls, signer);
    await expect(writeCheckpoint(store as NodeStore, souls, signer)).rejects.toThrow('checkpoint already at head');
    expect(await verify()).toEqual({ checked: 0, ok: true, fromSeq: 2 });
  });

  it('graph.status reports fromSeq after a checkpoint', async () => {
    const { store, graph, pair, souls, signer } = await setup();
    const crypto: GraphCrypto = {
      secret: async (epub, p) => (await (SEA as any).secret(epub, p)) || undefined,
      encrypt: async (data, key) => String(await (SEA as any).encrypt(data, key)),
      decrypt: async (data, key) => (SEA as any).decrypt(data, key),
      sign: portableEcdsaSign,
      verify: portableEcdsaVerify,
      randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    };
    const gun = { _: { opt: {} } };
    const host = createGraphHost({ gun, store: store as NodeStore, graph, crypto });
    await host.handle({ name: 'graph.identity', userId: 'me', pair: pair as GraphSeaPair });

    const talkId = await graph.talks.create(tennis());            // seq 0
    await graph.talks.edit(talkId, tennis('Tennis buddy'));       // seq 1
    await writeCheckpoint(store as NodeStore, souls, signer);     // cp at seq 1
    await graph.talks.remove(talkId);                             // seq 2

    const status = (await host.handle({ name: 'graph.status' })) as GraphHostStatus;
    expect(status.chain).toMatchObject({ ok: true, checked: 1, chainBreaks: 0, fromSeq: 2 });
  });
});
