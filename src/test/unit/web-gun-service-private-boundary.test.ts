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
  getGun: jest.Mock;
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
  // The peered control Gun must never be touched by owner-private reads or writes.
  service.getGun = jest.fn(() => { throw new Error('peered Gun used for private data'); });
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
});
