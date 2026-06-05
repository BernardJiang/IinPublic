import {
  createReleaseManifest,
  isDowngrade,
  manifestSigningPayload,
  verifyReleaseManifest,
  type ReleaseManifest,
  type TrustStoreEntry,
} from '../../shared/p2p-release-verification';

// Deterministic 64-char hex hash for tests
const FAKE_HASH = 'a'.repeat(64);

function makeSigner(): TrustStoreEntry {
  return {
    signerKeyId: 'key_release_1',
    pub: 'pub_release_1',
    label: 'IinPublic Release Signing Key',
    validFrom: '2025-01-01T00:00:00.000Z',
    expiresAt: null,
  };
}

function makeManifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  const base: Omit<ReleaseManifest, 'manifestVersion'> = {
    version: '1.0.0',
    packageHash: FAKE_HASH,
    signature: 'SEA{"m":"valid"}',
    signerKeyId: 'key_release_1',
    minSupportedProtocol: 'iinpublic-p2p-v1',
    minSchemaVersion: 1,
    builtAt: '2026-01-01T00:00:00.000Z',
  };
  return createReleaseManifest({ ...base, ...overrides });
}

/** Test-only seaVerify that accepts a known payload/sig pair. */
function makeSeaVerify(manifest: ReleaseManifest): (sig: string, pub: string) => Promise<unknown> {
  const expected = manifestSigningPayload(manifest);
  return async (sig: string, _pub: string) => {
    if (sig === manifest.signature) return expected;
    return null; // invalid
  };
}

const defaultOpts = (manifest: ReleaseManifest) => ({
  trustStore: [makeSigner()],
  actualPackageHash: FAKE_HASH,
  currentVersion: '0.9.0',
  currentProtocol: 'iinpublic-p2p-v1',
  seaVerify: makeSeaVerify(manifest),
});

describe('createReleaseManifest', () => {
  it('creates a valid manifest', () => {
    const m = makeManifest();
    expect(m.manifestVersion).toBe(1);
    expect(m.version).toBe('1.0.0');
  });

  it('throws on missing version', () => {
    expect(() => makeManifest({ version: '' })).toThrow(/version/);
  });

  it('throws on wrong-length packageHash', () => {
    expect(() => makeManifest({ packageHash: 'short' })).toThrow(/packageHash/);
  });

  it('throws on missing signerKeyId', () => {
    expect(() => makeManifest({ signerKeyId: '' })).toThrow(/signerKeyId/);
  });
});

describe('verifyReleaseManifest', () => {
  it('accepts a valid manifest', async () => {
    const m = makeManifest();
    const result = await verifyReleaseManifest(m, defaultOpts(m));
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown signer key id', async () => {
    const m = makeManifest({ signerKeyId: 'unknown_key' });
    const result = await verifyReleaseManifest(m, { ...defaultOpts(m), seaVerify: makeSeaVerify(m) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown signer/);
  });

  it('rejects an invalid signature', async () => {
    // Build the valid manifest first so the seaVerify is keyed to the real sig.
    // Then present the verifier with a manifest whose signature has been tampered.
    const valid = makeManifest();
    const tampered: ReleaseManifest = { ...valid, signature: 'SEA{"m":"tampered"}' };
    const result = await verifyReleaseManifest(tampered, {
      ...defaultOpts(valid),
      seaVerify: makeSeaVerify(valid), // returns the original signing payload for the real sig, null for any other
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/invalid signature/);
  });

  it('rejects a package hash mismatch', async () => {
    const m = makeManifest();
    const result = await verifyReleaseManifest(m, {
      ...defaultOpts(m),
      actualPackageHash: 'b'.repeat(64),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hash mismatch/);
  });

  it('rejects a downgrade', async () => {
    const m = makeManifest({ version: '0.5.0' });
    const result = await verifyReleaseManifest(m, {
      ...defaultOpts(m),
      seaVerify: makeSeaVerify(m),
      currentVersion: '1.0.0',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/downgrade/);
  });

  it('rejects an expired signer key', async () => {
    const m = makeManifest();
    const expiredSigner: TrustStoreEntry = {
      ...makeSigner(),
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    const result = await verifyReleaseManifest(m, {
      ...defaultOpts(m),
      seaVerify: makeSeaVerify(m),
      trustStore: [expiredSigner],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/);
  });

  it('rejects a not-yet-valid signer key', async () => {
    const future = new Date(Date.now() + 1_000_000_000).toISOString();
    const futureSigner: TrustStoreEntry = { ...makeSigner(), validFrom: future };
    const m = makeManifest();
    const result = await verifyReleaseManifest(m, {
      ...defaultOpts(m),
      seaVerify: makeSeaVerify(m),
      trustStore: [futureSigner],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not yet valid/);
  });

  it('accepts an upgrade (same version is not a downgrade)', async () => {
    const m = makeManifest({ version: '1.0.0' });
    const result = await verifyReleaseManifest(m, {
      ...defaultOpts(m),
      seaVerify: makeSeaVerify(m),
      currentVersion: '1.0.0',
    });
    expect(result.ok).toBe(true);
  });
});

describe('isDowngrade', () => {
  it('1.0.0 → 0.9.9 is downgrade', () => expect(isDowngrade('1.0.0', '0.9.9')).toBe(true));
  it('1.0.0 → 1.0.0 is not downgrade', () => expect(isDowngrade('1.0.0', '1.0.0')).toBe(false));
  it('1.0.0 → 1.0.1 is not downgrade', () => expect(isDowngrade('1.0.0', '1.0.1')).toBe(false));
  it('1.2.3 → 1.2.2 is downgrade', () => expect(isDowngrade('1.2.3', '1.2.2')).toBe(true));
  it('handles missing patch segment gracefully', () => expect(isDowngrade('1.1', '1.0')).toBe(true));
});
