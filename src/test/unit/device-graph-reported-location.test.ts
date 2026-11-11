/** @jest-environment node */

// The web worker and a phone's embedded node have no geolocation of their own: the page reports
// its fixes (`deviceGraph.setLocation`) and the core stamps the events I write with their blurred
// cell (REQ-GRAPH-42, OPEN-108). A stale, malformed or withdrawn fix stamps nothing.

import { randomBytes } from 'crypto';
import Gun from 'gun';
import SEA from 'gun/sea';
import { createCoreHandler } from '../../core/core-handler';
import { createReportedLocation, REPORTED_FIX_MAX_AGE_MS } from '../../core/device-graph/location-graph';
import { linkSoul, memoryNodeStore } from '../../core/device-graph/node-store';
import { seaGraphCrypto } from '../../core/device-graph/sync/sea-crypto';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { memoryGraphStore } from '../../core/graph-store';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(30_000);

const POINT = { latitude: 37.7694, longitude: -122.4862, accuracy: 12, source: 'gps' as const };

describe('a location the page reports (REQ-GRAPH-42)', () => {
  it('is used while fresh, and not once it is older than the limit', async () => {
    let now = 1_000_000;
    const reported = createReportedLocation({ now: () => now });
    expect(await reported.locate()).toBeUndefined();
    reported.set(POINT);
    expect(await reported.locate()).toEqual(POINT);
    now += REPORTED_FIX_MAX_AGE_MS;
    expect(await reported.locate()).toEqual(POINT);
    now += 1;
    expect(await reported.locate()).toBeUndefined();
  });

  it('is withdrawn by null and cleared by a malformed point', async () => {
    const reported = createReportedLocation();
    reported.set(POINT);
    reported.set(null);
    expect(await reported.locate()).toBeUndefined();
    reported.set(POINT);
    reported.set({ latitude: 'north', longitude: 2 });
    expect(await reported.locate()).toBeUndefined();
    reported.set({ latitude: 91, longitude: 0 });
    expect(await reported.locate()).toBeUndefined();
  });

  it('keeps a Traveler point as one, and drops a bad accuracy', async () => {
    const reported = createReportedLocation();
    reported.set({ latitude: 1, longitude: 2, accuracy: -5, source: 'traveler' });
    expect(await reported.locate()).toEqual({ latitude: 1, longitude: 2, source: 'traveler' });
    reported.set({ latitude: 1, longitude: 2, source: 'anything' });
    expect((await reported.locate())?.source).toBe('gps');
  });

  it('stamps the events the core writes once the page reports it, and stops when it is withdrawn', async () => {
    const nodeStore = memoryNodeStore();
    const gun = (Gun as any)({ localStorage: false, radisk: false, file: false, peers: [], axe: false, multicast: false });
    const handle = createCoreHandler(memoryGraphStore(), {
      deviceGraph: {
        nodeStore,
        randomBytes: (n) => new Uint8Array(randomBytes(n)),
        gun,
        crypto: seaGraphCrypto(SEA, (n) => new Uint8Array(randomBytes(n))),
      },
    });
    const souls = graphSouls('local/');
    const whereOf = async (eventId: string) => linkSoul((await nodeStore.get(souls.event(eventId)))?.where);

    const before = await handle({ name: 'graph.recordEncounter', personUserId: 'ann' }) as { eventId: string };
    expect(await whereOf(before.eventId)).toBeUndefined();

    expect(await handle({ name: 'deviceGraph.setLocation', point: POINT })).toEqual({ ok: true });
    const during = await handle({ name: 'graph.recordEncounter', personUserId: 'ben' }) as { eventId: string };
    expect(await whereOf(during.eventId)).toMatch(/^local\/cell\/cell_/);
    expect(await nodeStore.get(`local/gps/${during.eventId}`)).toMatchObject({ latitude: POINT.latitude, source: 'gps' });
    expect(await handle({ name: 'graph.personHistory', userId: 'ben', limit: 5 })).toEqual([
      expect.objectContaining({ eventId: during.eventId, kind: 'encounter', withUserId: 'ben' }),
    ]);
    expect(await handle({ name: 'graph.conversationMessages', conversationId: 'empty', limit: 5 })).toEqual([]);
    expect(await handle({ name: 'graph.talkPeople', talkId: 'empty', limit: 5 })).toEqual([]);
    await expect(handle({
      name: 'graph.recordMessages',
      conversationId: 'empty',
      otherUserId: 'ben',
      messages: [],
    })).rejects.toThrow('graph identity not set');

    await handle({ name: 'deviceGraph.setLocation', point: null });
    const after = await handle({ name: 'graph.recordEncounter', personUserId: 'cy' }) as { eventId: string };
    expect(await whereOf(after.eventId)).toBeUndefined();
  });
});
