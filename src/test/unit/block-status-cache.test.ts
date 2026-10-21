/**
 * The per-peer block-status cache that took ~1.8 s off every Talk a phone receives
 * (src/web/services/block-status-cache.ts; measured on a C10, 2026-10-18).
 */
import { BlockStatusCache } from '../../web/services/block-status-cache';

describe('BlockStatusCache', () => {
  it('asks the hub once per peer within the cache window', async () => {
    const fetchStatus = jest.fn(async () => false);
    const cache = new BlockStatusCache({ fetchStatus });
    expect(await cache.isBlocked('eve')).toBe(false);
    expect(await cache.isBlocked('eve')).toBe(false);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('shares one lookup between an announcement and a body that arrive together', async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const fetchStatus = jest.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    const cache = new BlockStatusCache({ fetchStatus });
    const first = cache.isBlocked('eve');
    const second = cache.isBlocked('eve');
    resolve(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('asks again after the window', async () => {
    let now = 0;
    const fetchStatus = jest.fn(async () => false);
    const cache = new BlockStatusCache({ fetchStatus, ttlMs: 1_000, now: () => now });
    await cache.isBlocked('eve');
    now = 1_001;
    await cache.isBlocked('eve');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failed lookup', async () => {
    const fetchStatus = jest.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('hub down'))
      .mockResolvedValueOnce(true);
    const cache = new BlockStatusCache({ fetchStatus });
    expect(await cache.isBlocked('eve')).toBe(false);
    expect(await cache.isBlocked('eve')).toBe(false);
    expect(await cache.isBlocked('eve')).toBe(true);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('forgets a peer when this user blocks or unblocks them', async () => {
    const fetchStatus = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const cache = new BlockStatusCache({ fetchStatus });
    expect(await cache.isBlocked('eve')).toBe(false);
    cache.invalidate('eve');
    expect(await cache.isBlocked('eve')).toBe(true);
  });
});
