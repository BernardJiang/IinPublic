import SEA from 'gun/sea';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { MAP_PRESENCE_TTL_MS, createMapPresence, densityCells } from '../../shared/map-presence';
import { snapPublicLocation } from '../../shared/public-location';
import { MapPresenceStore } from '../../server/services/map-presence-store';
import { groupUserDots } from '../../web/ui/chatroom-map-view';

const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);
const SOCAL = { west: -119, south: 32, east: -116, north: 35 };

async function pair(): Promise<SeaSigningPair> {
  return await SEA.pair() as SeaSigningPair;
}

describe('map presence store', () => {
  it('serves signed public points inside the view and forgets them at expiry', async () => {
    const store = new MapPresenceStore();
    const now = new Date('2026-10-11T12:00:00Z');
    await store.register(await createMapPresence({ userId: 'u1', pair: await pair(), location: SD, now }), now);
    await store.register(await createMapPresence({ userId: 'u2', pair: await pair(), location: LA, now }), now);

    const view = store.query({ west: -117.5, south: 32.5, east: -117, north: 33 }, now);
    expect(view.dots).toEqual([{ userId: 'u1', ...SD }]);
    expect(view.density).toEqual([expect.objectContaining({ count: 1 })]);
    expect(store.query(SOCAL, now).dots).toHaveLength(2);
    expect(store.query(SOCAL, new Date(now.getTime() + MAP_PRESENCE_TTL_MS + 1)).dots).toEqual([]);
  });

  it('rejects a raw coordinate, a forged signature and another key taking over a userId', async () => {
    const store = new MapPresenceStore();
    const owner = await pair();
    const record = await createMapPresence({ userId: 'u1', pair: owner, location: SD });
    await expect(store.register({ ...record, location: { latitude: 32.7157, longitude: -117.1611, precisionMeters: 1_000 } }))
      .rejects.toThrow();
    await expect(store.register({ ...record, location: LA })).rejects.toThrow();
    await store.register(record);
    await expect(store.register(await createMapPresence({ userId: 'u1', pair: await pair(), location: LA })))
      .rejects.toThrow('held by another key');
  });

  it('withdraws a dot immediately when the user turns location off', async () => {
    const store = new MapPresenceStore();
    const owner = await pair();
    await store.register(await createMapPresence({ userId: 'u1', pair: owner, location: SD }));
    await store.register(await createMapPresence({ userId: 'u1', pair: owner, location: null }));
    expect(store.query(SOCAL).dots).toEqual([]);
  });

  it('keeps the density layer complete when there are too many dots to list', async () => {
    const store = new MapPresenceStore();
    for (let i = 0; i < 4; i++) {
      await store.register(await createMapPresence({ userId: `u${i}`, pair: await pair(), location: i < 3 ? SD : LA }));
    }
    const view = store.query(SOCAL, new Date(), 2);
    expect(view.truncated).toBe(true);
    expect(view.dots).toEqual([]);
    expect(view.density.map((cell) => cell.count).sort()).toEqual([1, 3]);
  });
});

describe('density cells and dot grouping', () => {
  it('sizes density squares from the view, so the response is bounded by the view', () => {
    const points = Array.from({ length: 1_000 }, (_, i) => ({ latitude: 32 + (i % 50) * 0.06, longitude: -119 + Math.floor(i / 50) * 0.15 }));
    expect(densityCells(SOCAL, points).length).toBeLessThanOrEqual(48 * 48);
    expect(densityCells(SOCAL, points).reduce((sum, cell) => sum + cell.count, 0)).toBe(1_000);
  });

  it('draws me as a star, my room green, everyone else yellow, merging people at one point', () => {
    const groups = groupUserDots(
      { selfUserId: 'me', selfPoint: SD, roomMemberIds: new Set(['me', 'friend-a', 'friend-b']) },
      [
        { userId: 'me', ...SD },
        { userId: 'friend-a', ...SD },
        { userId: 'friend-b', ...SD },
        { userId: 'stranger', ...LA },
      ],
    );
    expect(groups).toEqual([
      { kind: 'other', latitude: LA.latitude, longitude: LA.longitude, count: 1 },
      { kind: 'room', latitude: SD.latitude, longitude: SD.longitude, count: 2 },
      { kind: 'self', latitude: SD.latitude, longitude: SD.longitude, count: 1 },
    ]);
  });
});
