import { encodePairingCode } from '../../shared/identity-linking';

const sea = {
  sign: jest.fn(async (data: string, pair: { pub: string }) => `signed:${pair.pub}:${data}`),
  verify: jest.fn(async (sig: string, pub: string) => {
    const prefix = `signed:${pub}:`;
    return sig.startsWith(prefix) ? sig.slice(prefix.length) : undefined;
  }),
  work: jest.fn(async (data: string) => `hash:${data}`),
};

jest.mock('../../web/sea-gun', () => ({
  getSEA: () => sea,
}));

import { WebIdentityLinkService } from '../../web/services/web-identity-link-service';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function gunServiceMock() {
  return {
    getStoredPair: jest.fn(() => ({ pub: 'self.pub', priv: 'priv', epub: 'epub', epriv: 'epriv' })),
    get: jest.fn(async () => {
      throw new Error('not found');
    }),
    put: jest.fn(async () => undefined),
    putPublic: jest.fn(async () => undefined),
  };
}

describe('WebIdentityLinkService graph wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes a one-sided signed attestation on the shared graph root', async () => {
    const gun = gunServiceMock();
    const service = new WebIdentityLinkService(gun as any);
    const code = encodePairingCode({
      version: 1,
      requestId: 'request-id-0001',
      pub: 'peer.pub',
      secret: 'one-time-secret',
      expiresAt: 20_000,
    });

    await expect(service.completeLinkFromCode(code, 10_000)).resolves.toEqual({
      ok: true,
      peerPub: 'peer.pub',
    });

    expect(gun.put).toHaveBeenCalledWith(
      'identity-links/self.pub/peer.pub',
      expect.objectContaining({
        fromPub: 'self.pub',
        toPub: 'peer.pub',
        secretHash: 'hash:one-time-secret',
        sig: expect.stringContaining('signed:self.pub:link|self.pub|peer.pub|hash:one-time-secret|10000'),
      }),
    );
    expect(gun.putPublic).not.toHaveBeenCalled();
  });

  it('publishes revocation beside attestations rather than under a user namespace', async () => {
    const gun = gunServiceMock();
    const service = new WebIdentityLinkService(gun as any);

    await service.unlink('peer.pub', 12_000);

    expect(gun.put).toHaveBeenCalledWith(
      'identity-link-revocations/self.pub/peer.pub',
      expect.objectContaining({ fromPub: 'self.pub', toPub: 'peer.pub', revokedAt: 12_000 }),
    );
    expect(gun.putPublic).not.toHaveBeenCalled();
  });

  it('requires both explicit approvals, verifies both signatures, and rejects code replay', async () => {
    const graph = new Map<string, unknown>();
    const deviceGun = (pub: string) => ({
      getStoredPair: jest.fn(() => ({ pub, priv: `priv-${pub}`, epub: `epub-${pub}`, epriv: `epriv-${pub}` })),
      get: jest.fn(async (key: string) => {
        if (!graph.has(key)) throw new Error('not found');
        return graph.get(key);
      }),
      put: jest.fn(async (key: string, value: unknown) => { graph.set(key, value); }),
      putPublic: jest.fn(async () => undefined),
    });
    const gunA = deviceGun('deviceA.pub');
    const gunB = deviceGun('deviceB.pub');
    const serviceA = new WebIdentityLinkService(gunA as any, memoryStorage());
    const serviceB = new WebIdentityLinkService(gunB as any, memoryStorage());

    const { code } = serviceA.createLinkCode(1_000);
    await expect(serviceB.completeLinkFromCode(code, 2_000)).resolves.toEqual({
      ok: true,
      peerPub: 'deviceA.pub',
    });

    expect(await serviceA.isLinked('deviceB.pub')).toBe(false);
    await expect(serviceA.readIncomingLinkRequest(3_000)).resolves.toEqual({
      peerPub: 'deviceB.pub',
      issuedAt: 2_000,
      expiresAt: 301_000,
    });
    await expect(serviceA.confirmIncomingLink('deviceB.pub', 4_000)).resolves.toBe(true);
    await expect(serviceA.isLinked('deviceB.pub')).resolves.toBe(true);
    await expect(serviceB.isLinked('deviceA.pub')).resolves.toBe(true);

    await expect(serviceB.completeLinkFromCode(code, 5_000)).resolves.toEqual({
      ok: false,
      error: 'reused',
    });
  });
});
