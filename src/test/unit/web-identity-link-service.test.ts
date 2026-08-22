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
    const service = new WebIdentityLinkService(gun as any, memoryStorage());

    await expect(service.unlink('peer.pub', 12_000)).resolves.toBe('removed');

    expect(gun.put).toHaveBeenCalledWith(
      'identity-link-revocations/self.pub/peer.pub',
      expect.objectContaining({ fromPub: 'self.pub', toPub: 'peer.pub', revokedAt: 12_000 }),
    );
    expect(gun.putPublic).not.toHaveBeenCalled();
  });

  it('denies trust immediately, keeps an offline revocation pending, and retries it', async () => {
    const graph = new Map<string, unknown>();
    let graphOffline = true;
    const gun = {
      getStoredPair: jest.fn(() => ({ pub: 'self.pub', priv: 'priv', epub: 'epub', epriv: 'epriv' })),
      get: jest.fn(async (key: string) => {
        if (!graph.has(key)) throw new Error('not found');
        return graph.get(key);
      }),
      put: jest.fn(async (key: string, value: unknown) => {
        if (graphOffline && key.startsWith('identity-link-revocations/')) throw new Error('offline');
        graph.set(key, value);
      }),
      putPublic: jest.fn(async () => undefined),
    };
    const service = new WebIdentityLinkService(gun as any, memoryStorage());
    service.upsertLocalRecord({
      pub: 'peer.pub',
      stageName: 'Peer',
      platform: 'web',
      linkedAt: 1_000,
      state: 'linked',
    });

    await expect(service.unlink('peer.pub', 2_000)).resolves.toBe('revocation-pending');
    await expect(service.linkStateWith('peer.pub')).resolves.toBe('revoked');
    await expect(service.isLinked('peer.pub')).resolves.toBe(false);
    expect(service.listLocalRecords()[0]?.state).toBe('revocation-pending');

    graphOffline = false;
    await service.flushPendingRevocations(3_000);
    expect(service.listLocalRecords()[0]?.state).toBe('removed');
    await expect(service.unlink('peer.pub', 4_000)).resolves.toBe('removed');
    expect(graph.has('identity-link-revocations/self.pub/peer.pub')).toBe(true);
  });

  it('distinguishes malformed revocations from post-revocation conflicts', async () => {
    const graph = new Map<string, unknown>();
    const gun = {
      getStoredPair: jest.fn(() => ({ pub: 'self.pub', priv: 'priv', epub: 'epub', epriv: 'epriv' })),
      get: jest.fn(async (key: string) => {
        if (!graph.has(key)) throw new Error('not found');
        return graph.get(key);
      }),
      put: jest.fn(async (key: string, value: unknown) => { graph.set(key, value); }),
      putPublic: jest.fn(async () => undefined),
    };
    const service = new WebIdentityLinkService(gun as any, memoryStorage());

    graph.set('identity-link-revocations/peer.pub/self.pub', {
      fromPub: 'peer.pub',
      toPub: 'self.pub',
      revokedAt: 2_000,
      sig: 'forged',
    });
    await expect(service.linkStateWith('peer.pub')).resolves.toBe('invalid');

    graph.set('identity-link-revocations/peer.pub/self.pub', {
      fromPub: 'peer.pub',
      toPub: 'self.pub',
      revokedAt: 2_000,
      sig: 'signed:peer.pub:unlink|peer.pub|self.pub|2000',
    });
    graph.set('identity-links/self.pub/peer.pub', {
      fromPub: 'self.pub',
      toPub: 'peer.pub',
      secretHash: 'same-hash',
      issuedAt: 3_000,
      sig: 'signed:self.pub:link|self.pub|peer.pub|same-hash|3000',
    });
    graph.set('identity-links/peer.pub/self.pub', {
      fromPub: 'peer.pub',
      toPub: 'self.pub',
      secretHash: 'same-hash',
      issuedAt: 3_000,
      sig: 'signed:peer.pub:link|peer.pub|self.pub|same-hash|3000',
    });
    await expect(service.linkStateWith('peer.pub')).resolves.toBe('conflicted');
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
