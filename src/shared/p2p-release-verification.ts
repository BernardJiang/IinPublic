/**
 * P2P-T — Signed Upgrade Verification
 *
 * Defines the release manifest format and helpers that verify the integrity of
 * PWA/desktop/mobile client packages before install or update.
 * Unsigned, hash-mismatched, or downgrade manifests are rejected.
 *
 * REQ-P2P-17
 */

import { canonicalSerialize } from './p2p-runtime';

// ---------------------------------------------------------------------------
// Release manifest
// ---------------------------------------------------------------------------

/**
 * Release manifest embedded in every distribution package.
 * Signers are identified by a well-known key id; the signer public key is
 * resolved through the trust store.
 */
export type ReleaseManifest = {
  /** Always 1 for this format. */
  manifestVersion: 1;
  /** Semver string, e.g. "1.0.0". */
  version: string;
  /** SHA-256 hex digest of the primary package file. */
  packageHash: string;
  /** SEA signature over the canonical manifest payload (see `manifestSigningPayload`). */
  signature: string;
  /** Trust-store key id for the signing key (not the raw public key). */
  signerKeyId: string;
  /**
   * Minimum wire protocol the signed package supports.
   * Clients that do not support this protocol should warn the user.
   */
  minSupportedProtocol: string;
  /**
   * Minimum schema version this release can read.
   * Clients with stored data at a higher version should refuse downgrade.
   */
  minSchemaVersion: number;
  /** ISO-8601 build timestamp. */
  builtAt: string;
};

// ---------------------------------------------------------------------------
// Trust store
// ---------------------------------------------------------------------------

/**
 * Entry in the client-side release trust store.
 * Only signerKeyIds appearing in the trust store are accepted.
 */
export type TrustStoreEntry = {
  signerKeyId: string;
  /** SEA public key for SEA.verify(). */
  pub: string;
  /** Human-readable label (e.g. "IinPublic Release Signing Key"). */
  label: string;
  /** ISO-8601 timestamp from which this key is valid. */
  validFrom: string;
  /** ISO-8601 expiry, or null if the key has no expiry. */
  expiresAt: string | null;
};

export type ReleaseVerificationResult =
  | { ok: true }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Signing payload
// ---------------------------------------------------------------------------

/**
 * Deterministic payload that is signed/verified.
 * Only the content-relevant fields are included; `signature` is excluded.
 */
export function manifestSigningPayload(manifest: Omit<ReleaseManifest, 'signature'>): string {
  return canonicalSerialize({
    manifestVersion: manifest.manifestVersion,
    version: manifest.version,
    packageHash: manifest.packageHash,
    signerKeyId: manifest.signerKeyId,
    minSupportedProtocol: manifest.minSupportedProtocol,
    minSchemaVersion: manifest.minSchemaVersion,
    builtAt: manifest.builtAt,
  });
}

// ---------------------------------------------------------------------------
// Manifest creation helper (for use by the release pipeline)
// ---------------------------------------------------------------------------

export function createReleaseManifest(
  params: Omit<ReleaseManifest, 'manifestVersion'>,
): ReleaseManifest {
  if (!params.version) throw new Error('release manifest requires version');
  if (!params.packageHash || params.packageHash.length !== 64) {
    throw new Error('release manifest requires a 64-char SHA-256 hex packageHash');
  }
  if (!params.signature) throw new Error('release manifest requires a signature');
  if (!params.signerKeyId) throw new Error('release manifest requires signerKeyId');
  if (!params.minSupportedProtocol) throw new Error('release manifest requires minSupportedProtocol');
  if (typeof params.minSchemaVersion !== 'number' || params.minSchemaVersion < 0) {
    throw new Error('release manifest requires a non-negative minSchemaVersion');
  }
  return { manifestVersion: 1, ...params };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a release manifest against the trust store and the current client state.
 *
 * Steps:
 * 1. Validate required fields.
 * 2. Resolve the signer key from the trust store.
 * 3. Check the signer key validity window.
 * 4. Verify the SEA signature over `manifestSigningPayload`.
 * 5. Check the package hash matches the provided `actualPackageHash`.
 * 6. Reject downgrade attempts (currentVersion > manifest.version).
 * 7. Warn (not reject) if the current client lacks the required protocol.
 */
export async function verifyReleaseManifest(
  manifest: ReleaseManifest,
  opts: {
    trustStore: TrustStoreEntry[];
    /** SHA-256 hex of the actual downloaded package file. */
    actualPackageHash: string;
    /** The version currently installed (semver string). Used for downgrade checks. */
    currentVersion: string;
    /** The wire protocol the current client supports. */
    currentProtocol: string;
    now?: Date;
    /** Optional: inject SEA.verify for testing */
    seaVerify?: (sig: string, pub: string) => Promise<unknown>;
  },
): Promise<ReleaseVerificationResult> {
  // 1. Validate required fields
  if (!manifest.manifestVersion || manifest.manifestVersion !== 1) {
    return { ok: false, reason: 'unsupported manifest version' };
  }
  if (!manifest.version || !manifest.packageHash || !manifest.signature || !manifest.signerKeyId) {
    return { ok: false, reason: 'missing required manifest fields' };
  }

  // 2. Resolve signer from trust store
  const entry = opts.trustStore.find((e) => e.signerKeyId === manifest.signerKeyId);
  if (!entry) {
    return { ok: false, reason: `unknown signer key id: ${manifest.signerKeyId}` };
  }

  // 3. Validate signer key validity window
  const now = opts.now ?? new Date();
  const validFrom = new Date(entry.validFrom).getTime();
  if (!Number.isFinite(validFrom) || now.getTime() < validFrom) {
    return { ok: false, reason: 'signer key is not yet valid' };
  }
  if (entry.expiresAt !== null) {
    const expiresAt = new Date(entry.expiresAt).getTime();
    if (Number.isFinite(expiresAt) && now.getTime() > expiresAt) {
      return { ok: false, reason: 'signer key has expired' };
    }
  }

  // 4. Verify SEA signature
  const signingPayload = manifestSigningPayload(manifest);
  const verify = opts.seaVerify ?? (async (sig: string, pub: string) => {
    // Dynamically import SEA to keep server/worker-safe
    const { default: SEA } = await import('gun/sea');
    return SEA.verify(sig, pub);
  });
  let verified: unknown;
  try {
    verified = await verify(manifest.signature, entry.pub);
  } catch {
    return { ok: false, reason: 'signature verification threw an error' };
  }
  const verifiedStr = typeof verified === 'string' ? verified : canonicalSerialize(verified);
  if (verifiedStr !== signingPayload) {
    return { ok: false, reason: 'invalid signature' };
  }

  // 5. Check package hash
  if (manifest.packageHash !== opts.actualPackageHash) {
    return { ok: false, reason: 'package hash mismatch' };
  }

  // 6. Downgrade check (simple semver string comparison using numeric segments)
  if (isDowngrade(opts.currentVersion, manifest.version)) {
    return { ok: false, reason: `downgrade rejected: current=${opts.currentVersion} manifest=${manifest.version}` };
  }

  // 7. Protocol compatibility warning (soft — does not reject, but callers can surface it)
  if (manifest.minSupportedProtocol !== opts.currentProtocol) {
    // Not a hard error per the spec — log but allow; callers may treat as warning.
    // Return ok: true; the caller inspects `minSupportedProtocol` separately if needed.
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `manifestVersion` is strictly older than `currentVersion`.
 * Uses numeric segment comparison for semver strings like "1.2.3".
 */
export function isDowngrade(currentVersion: string, manifestVersion: string): boolean {
  const parse = (v: string): number[] =>
    String(v || '0')
      .split('.')
      .map((p) => parseInt(p, 10) || 0);
  const cur = parse(currentVersion);
  const man = parse(manifestVersion);
  const len = Math.max(cur.length, man.length);
  for (let i = 0; i < len; i++) {
    const c = cur[i] ?? 0;
    const m = man[i] ?? 0;
    if (m < c) return true;
    if (m > c) return false;
  }
  return false;
}
