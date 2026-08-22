import {
  LinkCrypto,
  createPairingPayload,
  encodePairingCode,
  decodePairingCode,
  isPairingExpired,
  buildLinkAttestation,
  verifyLinkAttestation,
  linkVerified,
  buildRevocation,
  isLinkRevoked,
  resolveLinkState,
  PAIRING_TTL_MS,
} from '../../shared/identity-linking';

/**
 * Deterministic mock crypto: a "signature" is `sig:<pub>:<data>`, so verify just
 * checks the signer's pub. hash is a stable prefix; randomSecret is a counter.
 * This exercises the protocol logic without real SEA.
 */
function mockCrypto(pub: string): LinkCrypto {
  let n = 0;
  return {
    sign: async (data: string) => `sig:${pub}:${data}`,
    verify: async (data: string, sig: string, signerPub: string) => sig === `sig:${signerPub}:${data}`,
    hash: async (data: string) => `h(${data})`,
    randomSecret: () => `secret-${pub}-${n++}`,
  };
}

// A shared verifier crypto (verify/hash are pub-agnostic; sign unused in link checks).
const shared: LinkCrypto = {
  sign: async () => { throw new Error('shared crypto does not sign'); },
  verify: async (data, sig, pub) => sig === `sig:${pub}:${data}`,
  hash: async (data) => `h(${data})`,
  randomSecret: () => 'x',
};

const A = 'pubA.key';
const B = 'pubB.key';

describe('pairing payload + code', () => {
  it('creates a payload with a TTL and encodes/decodes round-trip', () => {
    const cA = mockCrypto(A);
    const now = 1_000_000;
    const payload = createPairingPayload(A, cA, now);
    expect(payload.pub).toBe(A);
    expect(payload.expiresAt).toBe(now + PAIRING_TTL_MS);
    const code = encodePairingCode(payload);
    expect(decodePairingCode(code)).toEqual(payload);
  });

  it('rejects malformed codes', () => {
    expect(decodePairingCode('not-base64!!')).toBeNull();
    expect(decodePairingCode('')).toBeNull();
  });

  it('rejects legacy and unsupported pairing schemas', () => {
    const legacy = Buffer.from(JSON.stringify([A, 'legacy-secret', 1234])).toString('base64url');
    const future = Buffer.from(JSON.stringify([2, 'request-2', A, 'future-secret', 1234])).toString('base64url');
    expect(decodePairingCode(legacy)).toBeNull();
    expect(decodePairingCode(future)).toBeNull();
  });

  it('detects expiry', () => {
    const payload = {
      version: 1 as const,
      requestId: 'request-1',
      pub: A,
      secret: 'secret-1',
      expiresAt: 100,
    };
    expect(isPairingExpired(payload, 99)).toBe(false);
    expect(isPairingExpired(payload, 101)).toBe(true);
  });
});

describe('mutual attestations', () => {
  it('a one-sided claim is NOT a link', async () => {
    const cA = mockCrypto(A);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cA });
    expect(await verifyLinkAttestation(attA, shared)).toBe(true);
    expect(await linkVerified(attA, null, shared)).toBe(false);
    expect(await resolveLinkState({ attFromSelf: attA, attFromPeer: null, crypto: shared })).toBe('pending');
  });

  it('both attestations with the same secret verify as linked', async () => {
    const cA = mockCrypto(A);
    const cB = mockCrypto(B);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cA });
    const attB = await buildLinkAttestation({ selfPub: B, peerPub: A, secret: 'S', crypto: cB });
    expect(await linkVerified(attA, attB, shared)).toBe(true);
    expect(await resolveLinkState({ attFromSelf: attA, attFromPeer: attB, crypto: shared })).toBe('linked');
  });

  it('mismatched secrets do not link (different pairing codes)', async () => {
    const cA = mockCrypto(A);
    const cB = mockCrypto(B);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S1', crypto: cA });
    const attB = await buildLinkAttestation({ selfPub: B, peerPub: A, secret: 'S2', crypto: cB });
    expect(await linkVerified(attA, attB, shared)).toBe(false);
  });

  it('attestations that do not reference each other do not link', async () => {
    const cA = mockCrypto(A);
    const cB = mockCrypto(B);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: 'pubC', secret: 'S', crypto: cA });
    const attB = await buildLinkAttestation({ selfPub: B, peerPub: A, secret: 'S', crypto: cB });
    expect(await linkVerified(attA, attB, shared)).toBe(false);
  });

  it('forgery fails verification (signed by the wrong key)', async () => {
    const cImposter = mockCrypto('imposter');
    // Imposter claims to be A but signs with its own key.
    const forged = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cImposter });
    // forged.sig === `sig:imposter:...` but fromPub is A → verify(pub=A) fails.
    expect(await verifyLinkAttestation(forged, shared)).toBe(false);
  });
});

describe('revocation supersedes', () => {
  it('a verified revocation at/after issuance breaks the link', async () => {
    const cA = mockCrypto(A);
    const cB = mockCrypto(B);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cA, now: 1000 });
    const attB = await buildLinkAttestation({ selfPub: B, peerPub: A, secret: 'S', crypto: cB, now: 1000 });
    const rev = await buildRevocation({ selfPub: A, peerPub: B, crypto: cA, now: 2000 });

    expect(await isLinkRevoked(attA, rev, shared)).toBe(true);
    expect(
      await resolveLinkState({ attFromSelf: attA, attFromPeer: attB, revocation: rev, crypto: shared }),
    ).toBe('revoked');
  });

  it('either party may revoke', async () => {
    const cA = mockCrypto(A);
    const cB = mockCrypto(B);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cA, now: 1000 });
    const revByB = await buildRevocation({ selfPub: B, peerPub: A, crypto: cB, now: 1500 });
    expect(await isLinkRevoked(attA, revByB, shared)).toBe(true);
  });

  it('a stale revocation (before issuance) does not apply', async () => {
    const cA = mockCrypto(A);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cA, now: 1000 });
    const staleRev = await buildRevocation({ selfPub: A, peerPub: B, crypto: cA, now: 500 });
    expect(await isLinkRevoked(attA, staleRev, shared)).toBe(false);
  });

  it('a forged revocation is ignored', async () => {
    const cA = mockCrypto(A);
    const attA = await buildLinkAttestation({ selfPub: A, peerPub: B, secret: 'S', crypto: cA, now: 1000 });
    // Imposter forges a revocation claiming to be A.
    const forgedRev = { fromPub: A, toPub: B, revokedAt: 2000, sig: `sig:imposter:unlink|${A}|${B}|2000` };
    expect(await isLinkRevoked(attA, forgedRev, shared)).toBe(false);
  });
});
