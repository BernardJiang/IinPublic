import { WebGunService } from '../../web/services/web-gun-service';

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
  getLegacyReplicatedPrivate: jest.Mock<Promise<unknown>, [string]>;
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
  service.getLegacyReplicatedPrivate = jest.fn().mockResolvedValue(null);
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
    expect(service.getLegacyReplicatedPrivate).not.toHaveBeenCalled();
  });

  test('a local private read never consults the peered compatibility namespace', async () => {
    const service = harness();
    service.bridge.getPrivate.mockResolvedValue({ title: 'Local copy' });

    await expect(service.getPrivate('talks/talk-1')).resolves.toEqual({ title: 'Local copy' });

    expect(service.getLegacyReplicatedPrivate).not.toHaveBeenCalled();
  });

  test('a legacy peered ciphertext is imported into local Gun exactly once', async () => {
    const service = harness();
    const legacy = { title: 'Migrated copy', createdAt: new Date('2026-10-08T09:30:00.000Z') };
    service.getLegacyReplicatedPrivate.mockResolvedValue(legacy);

    await expect(service.getPrivate('talks/talk-1')).resolves.toBe(legacy);

    expect(service.getLegacyReplicatedPrivate).toHaveBeenCalledWith('talks/talk-1');
    expect(service.bridge.putPrivate).toHaveBeenCalledWith('talks/talk-1', {
      title: 'Migrated copy',
      createdAt: '2026-10-08T09:30:00.000Z',
    });
  });

  test('an identity created on this device never waits on the peered migration probe', async () => {
    // The probe waits 4 s per missing key; a fresh install's first Talk read several missing keys
    // and took ~14 s to show (spec 29, 2026-10-17). A new identity has nothing pre-split to import.
    const store = new Map<string, string>();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
    });
    try {
      const service = harness();
      const fresh = await (service as unknown as { createFreshPair: () => Promise<{ pub: string }> }).createFreshPair();
      service.seaPair = { pub: fresh.pub, priv: 'priv', epub: 'epub', epriv: 'epriv' };
      await expect(service.getPrivate('incomingTalkClusters')).resolves.toBeNull();
      expect(service.getLegacyReplicatedPrivate).not.toHaveBeenCalled();

      // A restored or migrated identity (not created here) still imports its old peered copy.
      service.seaPair = { pub: 'restored-pub', priv: 'priv', epub: 'epub', epriv: 'epriv' };
      await service.getPrivate('incomingTalkClusters');
      expect(service.getLegacyReplicatedPrivate).toHaveBeenCalledWith('incomingTalkClusters');
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
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
});
