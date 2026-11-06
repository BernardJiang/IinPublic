import {
  PEER_EPUB_CACHE_STORAGE,
  WebGunService,
} from '../../web/services/web-gun-service';
import { getSEA } from '../../web/sea-gun';

type PrivateServiceHarness = {
  putPrivate: WebGunService['putPrivate'];
  getPrivate: WebGunService['getPrivate'];
  seaPair: { pub: string; priv: string; epub: string; epriv: string } | null;
  bridgeReady: boolean;
  bridge: {
    putPrivate: jest.Mock<Promise<void>, [string, unknown]>;
    getPrivate: jest.Mock<Promise<unknown>, [string]>;
  };
  privateWriteQueue: Promise<void>;
  privateNativeWriteQueues: Map<string, Promise<void>>;
  privateSubscribers: Map<string, Set<(value: unknown) => void>>;
  nativeNode: {
    token: string;
    baseUrl: string;
    keepWorker: boolean;
    core: jest.Mock<Promise<unknown>, [unknown]>;
  } | null;
  getGun: jest.Mock;
  rosterEpubByUserId: Map<string, string>;
  rememberRosterEpub: WebGunService['rememberRosterEpub'];
  getCachedRosterEpub: WebGunService['getCachedRosterEpub'];
};

function harness(): PrivateServiceHarness {
  const service = Object.create(WebGunService.prototype) as unknown as PrivateServiceHarness;
  service.seaPair = { pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' };
  service.bridgeReady = true;
  service.bridge = {
    putPrivate: jest.fn().mockResolvedValue(undefined),
    getPrivate: jest.fn().mockResolvedValue(null),
  };
  service.privateWriteQueue = Promise.resolve();
  service.privateNativeWriteQueues = new Map();
  service.privateSubscribers = new Map();
  service.nativeNode = null;
  // The peered control Gun must never be touched by owner-private reads or writes.
  service.getGun = jest.fn(() => { throw new Error('peered Gun used for private data'); });
  service.rosterEpubByUserId = new Map();
  return service;
}

describe('WebGunService private/control Gun boundary', () => {
  test('new private writes go only to the local worker store', async () => {
    const service = harness();

    await service.putPrivate('talks/talk-1', {
      title: 'Private question',
      updatedAt: new Date('2026-10-09T12:00:00.000Z'),
    });

    expect(service.bridge.putPrivate).toHaveBeenCalledWith('talks/talk-1', {
      title: 'Private question',
      updatedAt: '2026-10-09T12:00:00.000Z',
    });
    expect(service.getGun).not.toHaveBeenCalled();
  });

  test('a local private read never consults the peered graph', async () => {
    const service = harness();
    service.bridge.getPrivate.mockResolvedValue({ title: 'Local copy' });

    await expect(service.getPrivate('talks/talk-1')).resolves.toEqual({ title: 'Local copy' });

    expect(service.getGun).not.toHaveBeenCalled();
  });

  test('a missing key is null at once — no pre-split peered import (OPEN-78)', async () => {
    const service = harness();

    await expect(service.getPrivate('incomingTalkClusters')).resolves.toBeNull();

    expect(service.bridge.getPrivate).toHaveBeenCalledTimes(1);
    expect(service.bridge.putPrivate).not.toHaveBeenCalled();
    expect(service.getGun).not.toHaveBeenCalled();
  });

  test('fails closed instead of replicating when the local private store is unavailable', async () => {
    const service = harness();
    service.bridgeReady = false;

    await expect(service.putPrivate('profile', { name: 'Alice' })).rejects.toThrow(
      'Local private Gun store is unavailable',
    );
    await expect(service.getPrivate('profile')).rejects.toThrow(
      'Local private Gun store is unavailable',
    );
    expect(service.bridge.putPrivate).not.toHaveBeenCalled();
  });

  test('native private writes serialize per key without blocking unrelated records', async () => {
    jest.useFakeTimers();
    const service = harness();
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const core = jest.fn(async (request: unknown) => {
      const key = String((request as { key?: string }).key || '');
      if (key === 'slow') await slowGate;
      return { ok: true };
    });
    service.nativeNode = { token: 'token', baseUrl: 'http://native', keepWorker: false, core };
    const encrypt = jest.spyOn(getSEA(), 'encrypt').mockImplementation(async (value: unknown) => `SEA${JSON.stringify(value)}`);

    try {
      const slow = service.putPrivate('slow', { value: 1 });
      await jest.advanceTimersByTimeAsync(0);
      const fast = service.putPrivate('fast', { value: 2 });

      await expect(fast).resolves.toBeUndefined();
      expect(core).toHaveBeenCalledWith(expect.objectContaining({ name: 'private.put', key: 'fast' }));
      releaseSlow();
      await expect(slow).resolves.toBeUndefined();
    } finally {
      encrypt.mockRestore();
      jest.useRealTimers();
    }
  });

  test('retains a learned peer encryption key across a page-service reload', () => {
    localStorage.clear();
    const firstPage = harness();
    firstPage.rememberRosterEpub('peer-1', 'epub-peer-1');

    expect(JSON.parse(localStorage.getItem(PEER_EPUB_CACHE_STORAGE) || '{}')).toEqual({
      'peer-1': 'epub-peer-1',
    });

    const reloadedPage = harness();
    expect(reloadedPage.getCachedRosterEpub('peer-1')).toBe('epub-peer-1');
  });

  test('ignores malformed and oversized persisted peer-key entries', () => {
    localStorage.clear();
    localStorage.setItem(PEER_EPUB_CACHE_STORAGE, JSON.stringify({
      good: 'epub-good',
      empty: '',
      [String('x').repeat(257)]: 'epub-oversized-id',
      oversizedKey: String('k').repeat(513),
    }));
    const service = harness();

    expect(service.getCachedRosterEpub('good')).toBe('epub-good');
    expect(service.getCachedRosterEpub('empty')).toBeUndefined();
    expect(service.getCachedRosterEpub('oversizedKey')).toBeUndefined();
  });
});
