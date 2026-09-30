/**
 * OfficialBuildCredential — scenario 2 ("is this official/modified software?", distinct from
 * "is this Alice?"). Schema and trust-label mapping per
 * `docs/IinPublic Identity & Key Architecture TODO.md` §16.1/§16.5/§16.8.
 *
 * Issued by the attestation verifier (`src/server/routes/attestation-routes.ts`, server-only —
 * it holds the signing key), evaluated by any peer receiving one over the P2P handshake
 * (`src/shared/p2p-handshake.ts`) — this file is shared because both sides need the identical
 * schema and canonical signing-input serialization, or a peer's independent verification would
 * silently diverge from what the verifier actually signed.
 */

export type BuildPlatform = 'android' | 'ios';
export type ReleaseChannel = 'production' | 'beta';
export type EvidenceType = 'android-key-attestation' | 'play-integrity' | 'apple-app-attest';
/** Maps 1:1 from the Key Attestation extension's attestationSecurityLevel enum
 * (Software=0, TrustedEnvironment=1, StrongBox=2) — see docs/security/official-build-identifiers.md. */
export type EvidenceTier = 'software' | 'tee' | 'strongbox';

export interface OfficialBuildCredential {
  schemaVersion: 1;
  credentialId: string;
  platform: BuildPlatform;
  applicationId: string;
  releaseChannel: ReleaseChannel;
  appVersion: string;
  buildNumber: string;
  /** SHA-256 hex digest of the release-signing certificate that produced this attestation —
   * compared against docs/security/official-build-identifiers.md's pinned digest. */
  signingIdentityHash: string;
  /** The presenting device's own public key — reuses the existing SEA public key already
   * authenticated by the P2P handshake (§16.8's deliberate simplification), not a separate
   * device-identity key. */
  devicePublicKey: string;
  evidenceType: EvidenceType;
  evidenceTier: EvidenceTier;
  issuedAt: string;
  expiresAt: string;
  /** Fingerprint of the verifier public key that signed this (see
   * attestation-verifier-key-custody.js's fingerprint()) — lets a peer pick the right published
   * key to check against without a lookup. */
  verifierKeyId: string;
  /** base64 DER ECDSA/SHA-256 signature over canonicalCredentialSigningInput(this credential
   * minus this field). */
  verifierSignature: string;
}

/** §16.1's four trust labels, as code-friendly slugs. `unverified-build` is the default when no
 * credential is presented at all — explicitly NOT implying malicious or even suspicious, per the
 * design doc's own wording ("This is not by itself proof of malicious behavior"). */
export type BuildTrustLabel =
  | 'official-verified'
  | 'officially-signed-unavailable'
  | 'community-build'
  | 'unverified-build';

const CREDENTIAL_FIELD_ORDER: ReadonlyArray<keyof Omit<OfficialBuildCredential, 'verifierSignature'>> = [
  'schemaVersion',
  'credentialId',
  'platform',
  'applicationId',
  'releaseChannel',
  'appVersion',
  'buildNumber',
  'signingIdentityHash',
  'devicePublicKey',
  'evidenceType',
  'evidenceTier',
  'issuedAt',
  'expiresAt',
  'verifierKeyId',
];

/**
 * The exact bytes the verifier signs and a peer re-derives to verify — an explicit
 * field-order|value template (not `JSON.stringify`, whose key order isn't a contract this file
 * wants to depend on), matching this codebase's existing canonical-signing-input convention (see
 * `attestationSigningInput` in `src/shared/identity-linking.ts`). Every field is required and
 * string/number-only by the type, so there's no ambiguity to canonicalize away.
 */
export function canonicalCredentialSigningInput(
  credential: Omit<OfficialBuildCredential, 'verifierSignature'>,
): string {
  return CREDENTIAL_FIELD_ORDER.map((field) => `${field}=${credential[field]}`).join('|');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Structural validation only — does not verify the signature (that's a separate step, since it
 * needs the verifier's public key material, not just the shape). */
export function isWellFormedCredential(value: unknown): value is OfficialBuildCredential {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    c.schemaVersion === 1 &&
    isNonEmptyString(c.credentialId) &&
    (c.platform === 'android' || c.platform === 'ios') &&
    isNonEmptyString(c.applicationId) &&
    (c.releaseChannel === 'production' || c.releaseChannel === 'beta') &&
    isNonEmptyString(c.appVersion) &&
    isNonEmptyString(c.buildNumber) &&
    isNonEmptyString(c.signingIdentityHash) &&
    isNonEmptyString(c.devicePublicKey) &&
    isNonEmptyString(c.evidenceType) &&
    (c.evidenceTier === 'software' || c.evidenceTier === 'tee' || c.evidenceTier === 'strongbox') &&
    isNonEmptyString(c.issuedAt) &&
    isNonEmptyString(c.expiresAt) &&
    isNonEmptyString(c.verifierKeyId) &&
    isNonEmptyString(c.verifierSignature)
  );
}

export type VerifierKeyLookup = (verifierKeyId: string) => string | undefined; // returns publicKeyPem
export type SignatureVerifier = (publicKeyPem: string, data: string, signatureBase64: string) => boolean;

export interface EvaluateBuildTrustOptions {
  /** The credential presented by the remote peer, or undefined/null if none was included in
   * their handshake. */
  credential: OfficialBuildCredential | null | undefined;
  /** The remote peer's already-authenticated public key (from the P2P handshake itself) — must
   * equal `credential.devicePublicKey` for the credential to count as this peer's own. */
  remotePublicKey: string;
  /** This device's officially-pinned applicationId + signing digest
   * (docs/security/official-build-identifiers.md), so a peer can independently confirm the
   * credential describes a build matching OUR official identifiers, not just that some verifier
   * somewhere signed something. */
  officialApplicationId: string;
  officialSigningIdentityHash: string;
  lookupVerifierKey: VerifierKeyLookup;
  verifySignature: SignatureVerifier;
  now?: Date;
}

/**
 * Pure decision function — no network, no I/O. See §16.8 for the v1 single-verifier mapping this
 * implements (documented there as a pragmatic approximation of the fuller multi-verifier-trust
 * design in §16.1; safe to revisit once Play Integrity/App Attest add more evidence types).
 */
export function evaluateBuildTrust(options: EvaluateBuildTrustOptions): BuildTrustLabel {
  const { credential, remotePublicKey, officialApplicationId, officialSigningIdentityHash, lookupVerifierKey, verifySignature } = options;
  const now = options.now ?? new Date();

  if (!credential || !isWellFormedCredential(credential)) return 'unverified-build';

  const verifierPublicKeyPem = lookupVerifierKey(credential.verifierKeyId);
  if (!verifierPublicKeyPem) return 'community-build'; // signed by a key we don't recognize/trust

  const { verifierSignature, ...unsigned } = credential;
  const signingInput = canonicalCredentialSigningInput(unsigned);
  if (!verifySignature(verifierPublicKeyPem, signingInput, verifierSignature)) return 'community-build';

  const expiresAt = new Date(credential.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return 'unverified-build'; // stale, no better than absent

  if (credential.devicePublicKey !== remotePublicKey) return 'community-build'; // proof-of-possession binding fails

  if (credential.applicationId !== officialApplicationId) return 'community-build';
  if (credential.signingIdentityHash !== officialSigningIdentityHash) return 'community-build';

  if (credential.evidenceTier === 'strongbox' || credential.evidenceTier === 'tee') return 'official-verified';
  return 'officially-signed-unavailable'; // software-only attestation tier — real signing identity, weaker hardware proof
}
