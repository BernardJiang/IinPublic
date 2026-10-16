import SEA from 'gun/sea';
import {
  PEER_EXCHANGE_CACHE_TTL_MS,
  issuePeerExchangeRecord,
  type PeerExchangeCacheEntry,
} from '../../shared/peer-exchange';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { PeerExchangeCacheStore } from '../../web/services/peer-exchange-cache-store';

describe('PeerExchangeCacheStore', () => {
  test('uses the local-only private read and never probes the legacy peered graph', async () => {
    const getPrivate = jest.fn(async () => null);
    const getPrivateLocal = jest.fn(async () => null);
    const storage = new PeerExchangeCacheStore({
      getPrivate,
      getPrivateLocal,
      putPrivate: async () => undefined,
    });

    await expect(storage.load('new-room')).resolves.toEqual([]);
    expect(getPrivateLocal).toHaveBeenCalledWith('peerExchangeCache/v1/new-room');
    expect(getPrivate).not.toHaveBeenCalled();
  });

  test('persists verified hints privately, isolates rooms, and prunes expiration', async () => {
    const values = new Map<string, unknown>();
    const storage = new PeerExchangeCacheStore({
      getPrivate: async (key) => values.get(key) ?? null,
      putPrivate: async (key, value) => { values.set(key, value); },
    });
    const pair = await SEA.pair() as SeaSigningPair;
    const now = new Date('2026-10-15T20:00:00.000Z');
    const record = await issuePeerExchangeRecord({ pair, userId: 'bob', roomId: 'room-a', now });
    const entry: PeerExchangeCacheEntry = {
      record,
      verifiedAt: now.toISOString(),
      cacheExpiresAt: new Date(now.getTime() + PEER_EXCHANGE_CACHE_TTL_MS).toISOString(),
    };

    await storage.save('room-a', [entry]);
    await expect(storage.load('room-a', new Date(now.getTime() + 60_000)))
      .resolves.toHaveLength(1);
    await expect(storage.load('room-b', new Date(now.getTime() + 60_000)))
      .resolves.toEqual([]);
    await expect(storage.load('room-a', new Date(now.getTime() + PEER_EXCHANGE_CACHE_TTL_MS + 1)))
      .resolves.toEqual([]);
    expect([...values.keys()]).toEqual(['peerExchangeCache/v1/room-a']);
  });
});
