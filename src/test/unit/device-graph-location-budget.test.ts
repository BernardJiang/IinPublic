/** @jest-environment node */

// Device graph places and limits (spec §31.7, owner decisions 2026-11-03): exact GPS points are
// erased after 30 days, leaving the blurred cell; the store refuses what others send at 1 GB.

import { createEventIdSource } from '../../core/device-graph/event-id';
import { createArrivalGraph } from '../../core/device-graph/arrivals';
import { createLocationGraph, GPS_RETENTION_DAYS } from '../../core/device-graph/location-graph';
import { memoryNodeStore } from '../../core/device-graph/node-store';
import { DEVICE_GRAPH_LIMIT_BYTES, createStorageBudget, storageLevel } from '../../core/device-graph/storage-budget';

const DAY = 86_400_000;

describe('location (spec §31.7)', () => {
  it('a cell is written once with its wider parents', async () => {
    const store = memoryNodeStore();
    const location = createLocationGraph(store);
    const region = await location.cell({ latitude: 32.7157, longitude: -117.1611 });
    expect(region).toMatch(/^cell_.*_400$/);
    const cell = await store.get(`local/cell/${region}`);
    expect(cell).toMatchObject({ precisionMeters: 400, parent: { '#': expect.stringMatching(/_1000$/) } });
    const writes = store.writes;
    await location.cell({ latitude: 32.7157, longitude: -117.1611 });
    expect(store.writes).toBe(writes);
  });

  it(`exact points are kept ${GPS_RETENTION_DAYS} days, then erased; the cell stays`, async () => {
    const store = memoryNodeStore();
    let clock = Date.UTC(2026, 9, 1, 12);
    const location = createLocationGraph(store, { now: () => clock });
    const region = await location.cell({ latitude: 32.7157, longitude: -117.1611 });
    await location.record('old-event', { latitude: 32.7157, longitude: -117.1611, accuracy: 8, source: 'gps' });
    clock += 20 * DAY;
    await location.record('newer-event', { latitude: 32.72, longitude: -117.16, source: 'traveler' });
    clock += 15 * DAY; // the first point is 35 days old, the second 15
    expect(await location.sweep()).toBe(1);
    expect(await location.point('old-event')).toBeUndefined();
    expect(await location.point('newer-event')).toMatchObject({ source: 'traveler' });
    expect(await store.get(`local/cell/${region}`)).toMatchObject({ precisionMeters: 400 });
    expect(await location.sweep()).toBe(0);
  });
});

describe('storage limit (1 GB)', () => {
  it('levels', () => {
    expect(storageLevel(undefined)).toBe('unknown');
    expect(storageLevel(100)).toBe('ok');
    expect(storageLevel(DEVICE_GRAPH_LIMIT_BYTES * 0.95)).toBe('near');
    expect(storageLevel(DEVICE_GRAPH_LIMIT_BYTES)).toBe('full');
  });

  it('a full store refuses what others send, and an unknown size refuses nothing', async () => {
    let used: number | undefined = DEVICE_GRAPH_LIMIT_BYTES + 1;
    const budget = createStorageBudget({ usage: async () => used, cacheMs: 0 });
    let saved: { deviceId?: string; counter?: number } = {};
    const ids = createEventIdSource({ state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(n).fill(9) });
    const store = memoryNodeStore();
    const arrivals = createArrivalGraph(store, ids, { budget });
    const talkId = `1762000000001-${'a'.repeat(32)}-0`;
    const talk = { title: 'Tennis', type: 'tag', language: 'en', isAdult: false, questions: [{ id: 'q_0', text: 'Tennis', answers: [{ id: 'a_0_0', text: 'Tennis', isMatch: true }] }] };
    const incoming = { talkId, versionId: talkId, authorId: 'adam', when: 1762000000001, device: 'a'.repeat(32), talk };
    expect(await arrivals.receive(incoming, { userId: 'adam' })).toEqual({ ignored: 'storage-full' });
    expect(store.souls()).toEqual([]);
    expect((await budget.status()).level).toBe('full');
    used = undefined;
    expect((await arrivals.receive(incoming, { userId: 'adam' })).arrivalId).toBeDefined();
  });
});
