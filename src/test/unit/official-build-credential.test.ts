import {
  canonicalCredentialSigningInput,
  evaluateBuildTrust,
  isWellFormedCredential,
  type OfficialBuildCredential,
} from '../../shared/official-build-credential';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const keyCustody = require('../../server/security/attestation-verifier-key-custody');

const OFFICIAL_APP_ID = 'com.iinpublic.app';
const OFFICIAL_SIGNING_HASH = 'a'.repeat(64);
const REMOTE_DEVICE_KEY = 'remote-device-pub-key';

function baseCredential(overrides: Partial<OfficialBuildCredential> = {}): Omit<OfficialBuildCredential, 'verifierSignature'> {
  const now = new Date('2026-09-30T00:00:00.000Z');
  return {
    schemaVersion: 1,
    credentialId: 'cred_123',
    platform: 'android',
    applicationId: OFFICIAL_APP_ID,
    releaseChannel: 'production',
    appVersion: '1.0.60',
    buildNumber: '1000060',
    signingIdentityHash: OFFICIAL_SIGNING_HASH,
    devicePublicKey: REMOTE_DEVICE_KEY,
    evidenceType: 'android-key-attestation',
    evidenceTier: 'strongbox',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    verifierKeyId: 'key-1',
    ...overrides,
  };
}

/** Signs a credential with a real generated keypair — exercises the actual signing/verification
 * pipeline end-to-end, not just mocked functions, so a schema drift between the two sides would
 * be caught here. */
function issueRealCredential(
  pair: { publicKeyPem: string; privateKeyPem: string },
  overrides: Partial<OfficialBuildCredential> = {},
): OfficialBuildCredential {
  const unsigned = baseCredential({ verifierKeyId: keyCustody.fingerprint(pair.publicKeyPem), ...overrides });
  const signingInput = canonicalCredentialSigningInput(unsigned);
  const verifierSignature = keyCustody.signWithVerifierKey(pair.privateKeyPem, signingInput);
  return { ...unsigned, verifierSignature };
}

describe('canonicalCredentialSigningInput', () => {
  it('is stable for the same credential and differs when any field changes', () => {
    const a = baseCredential();
    const b = baseCredential();
    expect(canonicalCredentialSigningInput(a)).toBe(canonicalCredentialSigningInput(b));
    const c = baseCredential({ appVersion: '1.0.61' });
    expect(canonicalCredentialSigningInput(a)).not.toBe(canonicalCredentialSigningInput(c));
  });
});

describe('isWellFormedCredential', () => {
  it('accepts a fully-populated credential', () => {
    expect(isWellFormedCredential({ ...baseCredential(), verifierSignature: 'sig' })).toBe(true);
  });

  it('rejects missing fields, wrong schemaVersion, and non-object input', () => {
    expect(isWellFormedCredential(null)).toBe(false);
    expect(isWellFormedCredential(undefined)).toBe(false);
    expect(isWellFormedCredential('not an object')).toBe(false);
    expect(isWellFormedCredential({ ...baseCredential(), verifierSignature: 'sig', schemaVersion: 2 })).toBe(false);
    const { appVersion, ...missingAppVersion } = { ...baseCredential(), verifierSignature: 'sig' };
    expect(isWellFormedCredential(missingAppVersion)).toBe(false);
  });

  it('rejects an invalid evidenceTier', () => {
    expect(
      isWellFormedCredential({ ...baseCredential(), verifierSignature: 'sig', evidenceTier: 'quantum' }),
    ).toBe(false);
  });
});

describe('evaluateBuildTrust', () => {
  const pair = keyCustody.generateVerifierKeyPair();
  const trustedKeys = new Map([[keyCustody.fingerprint(pair.publicKeyPem), pair.publicKeyPem]]);
  const commonOptions = {
    remotePublicKey: REMOTE_DEVICE_KEY,
    officialApplicationId: OFFICIAL_APP_ID,
    officialSigningIdentityHash: OFFICIAL_SIGNING_HASH,
    lookupVerifierKey: (keyId: string) => trustedKeys.get(keyId),
    verifySignature: (pubKey: string, data: string, sig: string) =>
      keyCustody.verifyWithVerifierKey(pubKey, data, sig),
    now: new Date('2026-09-30T01:00:00.000Z'), // 1h after issuance, well before 24h expiry
  };

  it('is unverified-build when no credential is presented', () => {
    expect(evaluateBuildTrust({ ...commonOptions, credential: null })).toBe('unverified-build');
    expect(evaluateBuildTrust({ ...commonOptions, credential: undefined })).toBe('unverified-build');
  });

  it('is unverified-build for a structurally malformed credential', () => {
    expect(
      evaluateBuildTrust({ ...commonOptions, credential: { not: 'a credential' } as unknown as OfficialBuildCredential }),
    ).toBe('unverified-build');
  });

  it('is official-verified for a real, hardware-tier credential correctly bound to the peer', () => {
    const credential = issueRealCredential(pair);
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('official-verified');
  });

  it('is official-verified for tee tier as well as strongbox', () => {
    const credential = issueRealCredential(pair, { evidenceTier: 'tee' });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('official-verified');
  });

  it('is officially-signed-unavailable for a software-only evidence tier', () => {
    const credential = issueRealCredential(pair, { evidenceTier: 'software' });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('officially-signed-unavailable');
  });

  it('is community-build when signed by a verifier key we do not trust', () => {
    const otherPair = keyCustody.generateVerifierKeyPair();
    const credential = issueRealCredential(otherPair, { verifierKeyId: keyCustody.fingerprint(otherPair.publicKeyPem) });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('community-build');
  });

  it('is community-build when the signature does not verify (tampered credential)', () => {
    const credential = issueRealCredential(pair);
    const tampered = { ...credential, appVersion: '9.9.9' }; // signature no longer matches
    expect(evaluateBuildTrust({ ...commonOptions, credential: tampered })).toBe('community-build');
  });

  it('is unverified-build once the credential has expired', () => {
    const credential = issueRealCredential(pair, {
      issuedAt: new Date('2026-09-01T00:00:00.000Z').toISOString(),
      expiresAt: new Date('2026-09-02T00:00:00.000Z').toISOString(),
    });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('unverified-build');
  });

  it('is community-build when devicePublicKey does not match the presenting peer (replayed credential)', () => {
    const credential = issueRealCredential(pair, { devicePublicKey: 'someone-elses-device-key' });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('community-build');
  });

  it('is community-build when applicationId does not match ours', () => {
    const credential = issueRealCredential(pair, { applicationId: 'com.example.fork' });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('community-build');
  });

  it('is community-build when signingIdentityHash does not match our pinned digest', () => {
    const credential = issueRealCredential(pair, { signingIdentityHash: 'b'.repeat(64) });
    expect(evaluateBuildTrust({ ...commonOptions, credential })).toBe('community-build');
  });
});
