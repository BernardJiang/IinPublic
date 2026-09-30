import { WebAttestationService } from '../../web/services/web-attestation-service';
import type { NativeAttestationBridge } from '../../shared/native-attestation-bridge';
import type { OfficialBuildCredential } from '../../shared/official-build-credential';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: () => null,
    get length() { return values.size; },
  } as Storage;
}

function fakeCredential(overrides: Partial<OfficialBuildCredential> = {}): OfficialBuildCredential {
  return {
    schemaVersion: 1,
    credentialId: 'cred_1',
    platform: 'android',
    applicationId: 'com.iinpublic.app',
    releaseChannel: 'production',
    appVersion: '1.0.60',
    buildNumber: '1.0.60',
    signingIdentityHash: 'a'.repeat(64),
    devicePublicKey: 'device-pub',
    evidenceType: 'android-key-attestation',
    evidenceTier: 'strongbox',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    verifierKeyId: 'key-1',
    verifierSignature: 'sig',
    ...overrides,
  };
}

function fakeBridge(overrides: Partial<NativeAttestationBridge> = {}): NativeAttestationBridge {
  return {
    describe: async () => ({ version: 1, provider: 'android-keystore-attestation', available: true, strongBoxAvailable: true }),
    generateAttestedKey: async () => ({ certChainDer: ['leaf==', 'root=='], devicePublicKeyDer: 'pub==' }),
    ...overrides,
  };
}

describe('WebAttestationService', () => {
  const originalLocalStorage = (global as unknown as { localStorage?: Storage }).localStorage;
  const originalFetch = global.fetch;
  const originalWindow = (global as unknown as { window?: unknown }).window;

  beforeEach(() => {
    (global as unknown as { localStorage: Storage }).localStorage = memoryStorage();
    // readNativeHostInfo() (called inside fetchCredential) reads window.location.search — the
    // 'node' test environment has no window global at all, unlike a browser/jsdom.
    (global as unknown as { window: unknown }).window = { location: { search: '' } };
  });

  afterEach(() => {
    (global as unknown as { localStorage: Storage | undefined }).localStorage = originalLocalStorage;
    global.fetch = originalFetch;
    (global as unknown as { window: unknown }).window = originalWindow;
    jest.restoreAllMocks();
  });

  it('returns null from getCachedCredential when nothing is cached', () => {
    const service = new WebAttestationService('http://api', fakeBridge());
    expect(service.getCachedCredential('device-pub')).toBeNull();
  });

  it('resolves ensureCredential to null when there is no native bridge (plain browser)', async () => {
    const service = new WebAttestationService('http://api', null);
    expect(await service.ensureCredential('device-pub')).toBeNull();
  });

  it('resolves to null when the bridge reports unavailable', async () => {
    const bridge = fakeBridge({
      describe: async () => ({ version: 1, provider: 'android-keystore-attestation', available: false, strongBoxAvailable: false }),
    });
    const service = new WebAttestationService('http://api', bridge);
    expect(await service.ensureCredential('device-pub')).toBeNull();
  });

  it('performs the full challenge -> attest -> verify round trip and caches the result', async () => {
    const credential = fakeCredential();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'chal_1', challenge: 'Y2hhbGxlbmdl' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credential }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const generateAttestedKey = jest.fn().mockResolvedValue({ certChainDer: ['leaf=='], devicePublicKeyDer: 'pub==' });
    const service = new WebAttestationService('http://api', fakeBridge({ generateAttestedKey }));

    const result = await service.ensureCredential('device-pub');
    expect(result).toEqual(credential);
    expect(generateAttestedKey).toHaveBeenCalledWith('Y2hhbGxlbmdl');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api/api/attestation/challenge', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://api/api/attestation/verify', expect.objectContaining({ method: 'POST' }));

    // Cached for a fresh instance too (persisted via localStorage).
    const secondInstance = new WebAttestationService('http://api', fakeBridge());
    expect(secondInstance.getCachedCredential('device-pub')).toEqual(credential);
  });

  it('returns the cached credential without re-fetching when still well within its validity window', async () => {
    const credential = fakeCredential();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'chal_1', challenge: 'Y2hhbGxlbmdl' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credential }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new WebAttestationService('http://api', fakeBridge());

    await service.ensureCredential('device-pub');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await service.ensureCredential('device-pub');
    expect(fetchMock).toHaveBeenCalledTimes(2); // no additional network calls
  });

  it('does not return a cached credential issued for a different device key', () => {
    const credential = fakeCredential({ devicePublicKey: 'device-pub-old' });
    (global as unknown as { localStorage: Storage }).localStorage.setItem(
      'iinpublic_attestation_credential_v1',
      JSON.stringify({ devicePublicKey: 'device-pub-old', credential }),
    );
    const service = new WebAttestationService('http://api', fakeBridge());
    expect(service.getCachedCredential('device-pub-new')).toBeNull();
    expect(service.getCachedCredential('device-pub-old')).toEqual(credential);
  });

  it('refetches when the cached credential is close to expiry', async () => {
    const soonToExpire = fakeCredential({ expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() }); // 5 min left
    const refreshed = fakeCredential({ credentialId: 'cred_2' });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'chal_2', challenge: 'Y2hhbGxlbmdl' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credential: refreshed }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    (global as unknown as { localStorage: Storage }).localStorage.setItem(
      'iinpublic_attestation_credential_v1',
      JSON.stringify({ devicePublicKey: 'device-pub', credential: soonToExpire }),
    );
    const service = new WebAttestationService('http://api', fakeBridge());
    const result = await service.ensureCredential('device-pub');
    expect(result).toEqual(refreshed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves to null (never rejects) when the server rejects the attestation', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'chal_1', challenge: 'Y2hhbGxlbmdl' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'attested package name does not match' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new WebAttestationService('http://api', fakeBridge());
    await expect(service.ensureCredential('device-pub')).resolves.toBeNull();
  });

  it('resolves to null (never rejects) when the native bridge throws', async () => {
    const service = new WebAttestationService(
      'http://api',
      fakeBridge({ generateAttestedKey: async () => { throw new Error('KeyStoreException'); } }),
    );
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ challengeId: 'chal_1', challenge: 'Y2hhbGxlbmdl' }),
    }) as unknown as typeof fetch;
    await expect(service.ensureCredential('device-pub')).resolves.toBeNull();
  });

  it('deduplicates concurrent ensureCredential calls into a single fetch round trip', async () => {
    const credential = fakeCredential();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'chal_1', challenge: 'Y2hhbGxlbmdl' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credential }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new WebAttestationService('http://api', fakeBridge());

    const [a, b] = await Promise.all([service.ensureCredential('device-pub'), service.ensureCredential('device-pub')]);
    expect(a).toEqual(credential);
    expect(b).toEqual(credential);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one challenge + one verify, not four
  });

  describe('verifier keys', () => {
    it('lookupVerifierKey returns undefined before ensureVerifierKeys has ever resolved', () => {
      const service = new WebAttestationService('http://api', fakeBridge());
      expect(service.lookupVerifierKey('key-1')).toBeUndefined();
    });

    it('fetches and caches verifier keys, readable synchronously afterward', async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [{ verifierKeyId: 'key-1', publicKeyPem: 'PEM_1' }, { verifierKeyId: 'key-2', publicKeyPem: 'PEM_2' }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new WebAttestationService('http://api', fakeBridge());

      await service.ensureVerifierKeys();
      expect(service.lookupVerifierKey('key-1')).toBe('PEM_1');
      expect(service.lookupVerifierKey('key-2')).toBe('PEM_2');
      expect(service.lookupVerifierKey('unknown-key')).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith('http://api/api/attestation/verifier-keys');
    });

    it('does not refetch once keys are already cached', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [{ verifierKeyId: 'key-1', publicKeyPem: 'PEM_1' }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new WebAttestationService('http://api', fakeBridge());

      await service.ensureVerifierKeys();
      await service.ensureVerifierKeys();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent ensureVerifierKeys calls', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [{ verifierKeyId: 'key-1', publicKeyPem: 'PEM_1' }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const service = new WebAttestationService('http://api', fakeBridge());
      await Promise.all([service.ensureVerifierKeys(), service.ensureVerifierKeys()]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never throws when the verifier-keys endpoint is unreachable', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const service = new WebAttestationService('http://api', fakeBridge());
      await expect(service.ensureVerifierKeys()).resolves.toBeUndefined();
      expect(service.lookupVerifierKey('key-1')).toBeUndefined();
    });
  });
});
