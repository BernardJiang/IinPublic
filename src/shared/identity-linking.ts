/**
 * Multi-device identity linking protocol (GUI redesign §10, TODO item I).
 *
 * Principle: every device has its own SEA keypair; keys never leave a device.
 * Linking records a direct relationship between two identities via **mutual
 * signed attestations**. V1 does not infer a transitive cluster. A link exists
 * only when BOTH sides have published an
 * attestation that verifies and references the other — one-sided claims are
 * ignored. A signed revocation supersedes an attestation.
 *
 * Crypto is injected (`LinkCrypto`) so this module is pure and unit-testable:
 * the web layer supplies a Gun-SEA-backed implementation; tests supply a
 * deterministic mock. Nothing here touches Gun or the DOM.
 */

export const PAIRING_TTL_MS = 5 * 60 * 1000; // ~5 minutes (redesign §10.1)
export const PAIRING_SCHEMA_VERSION = 1 as const;

/** Injected crypto surface — real impl is SEA.sign/verify/work + random. */
export interface LinkCrypto {
  /** Sign `data` with the caller's private key; returns a signature string. */
  sign(data: string): Promise<string>;
  /** Verify `sig` over `data` was produced by the key whose pub is `pub`. */
  verify(data: string, sig: string, pub: string): Promise<boolean>;
  /** Deterministic hash (e.g. SHA-256 hex) of `data`. */
  hash(data: string): Promise<string>;
  /** A fresh, unguessable one-time secret. */
  randomSecret(): string;
}

/** The short-lived payload encoded in the link code / QR (device A → device B). */
export interface PairingPayload {
  /** Pairing-code schema. Unsupported versions fail closed. */
  version: typeof PAIRING_SCHEMA_VERSION;
  /** Random, non-secret identifier used for the recipient's request inbox. */
  requestId: string;
  /** Public key of the device that generated the code. */
  pub: string;
  /** One-time pairing secret. */
  secret: string;
  /** Unix-ms expiry. */
  expiresAt: number;
}

/** A signed link attestation, published at identity-links/<fromPub>/<toPub>. */
export interface LinkAttestation {
  fromPub: string;
  toPub: string;
  /** hash(secret) — ties both attestations to the same pairing code. */
  secretHash: string;
  issuedAt: number;
  sig: string;
}

/** A signed revocation, published to supersede an attestation. */
export interface LinkRevocation {
  fromPub: string;
  toPub: string;
  revokedAt: number;
  sig: string;
}

export type LinkState = 'none' | 'pending' | 'linked' | 'revoked';

/** Canonical string that gets signed for an attestation (stable field order). */
function attestationSigningInput(a: Pick<LinkAttestation, 'fromPub' | 'toPub' | 'secretHash' | 'issuedAt'>): string {
  return `link|${a.fromPub}|${a.toPub}|${a.secretHash}|${a.issuedAt}`;
}

function revocationSigningInput(r: Pick<LinkRevocation, 'fromPub' | 'toPub' | 'revokedAt'>): string {
  return `unlink|${r.fromPub}|${r.toPub}|${r.revokedAt}`;
}

/** Device A: build a fresh pairing payload for its link code / QR. */
export function createPairingPayload(selfPub: string, crypto: LinkCrypto, now: number = Date.now()): PairingPayload {
  return {
    version: PAIRING_SCHEMA_VERSION,
    requestId: crypto.randomSecret(),
    pub: selfPub,
    secret: crypto.randomSecret(),
    expiresAt: now + PAIRING_TTL_MS,
  };
}

/** Encode a payload as a compact code string (base64url of JSON). */
export function encodePairingCode(payload: PairingPayload): string {
  const json = JSON.stringify([
    payload.version,
    payload.requestId,
    payload.pub,
    payload.secret,
    payload.expiresAt,
  ]);
  return base64UrlEncode(json);
}

/** Decode a code string; returns null if malformed. */
export function decodePairingCode(code: string): PairingPayload | null {
  try {
    const arr = JSON.parse(base64UrlDecode(code.trim()));
    if (!Array.isArray(arr) || arr.length !== 5) return null;
    const [version, requestId, pub, secret, expiresAt] = arr;
    if (version !== PAIRING_SCHEMA_VERSION) return null;
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 256) return null;
    if (typeof pub !== 'string' || pub.length < 8 || pub.length > 2048) return null;
    if (typeof secret !== 'string' || secret.length < 8 || secret.length > 512) return null;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
    return { version, requestId, pub, secret, expiresAt };
  } catch {
    return null;
  }
}

export function isPairingExpired(payload: PairingPayload, now: number = Date.now()): boolean {
  return now > payload.expiresAt;
}

/**
 * Build the caller's signed attestation toward `peerPub`, proving it saw the
 * pairing `secret` (via secretHash). Used by both A and B.
 */
export async function buildLinkAttestation(args: {
  selfPub: string;
  peerPub: string;
  secret: string;
  crypto: LinkCrypto;
  now?: number;
}): Promise<LinkAttestation> {
  const { selfPub, peerPub, secret, crypto } = args;
  const issuedAt = args.now ?? Date.now();
  const secretHash = await crypto.hash(secret);
  const sig = await crypto.sign(attestationSigningInput({ fromPub: selfPub, toPub: peerPub, secretHash, issuedAt }));
  return { fromPub: selfPub, toPub: peerPub, secretHash, issuedAt, sig };
}

/** Verify a single attestation's signature and structural sanity. */
export async function verifyLinkAttestation(att: LinkAttestation, crypto: LinkCrypto): Promise<boolean> {
  if (!att || !att.fromPub || !att.toPub || att.fromPub === att.toPub || !att.secretHash || !att.sig) return false;
  return crypto.verify(
    attestationSigningInput(att),
    att.sig,
    att.fromPub,
  );
}

/**
 * A link is valid only when BOTH attestations are present, each verifies, they
 * reference each other, and they carry the SAME secretHash (same pairing code).
 */
export async function linkVerified(
  attFromA: LinkAttestation | null | undefined,
  attFromB: LinkAttestation | null | undefined,
  crypto: LinkCrypto,
): Promise<boolean> {
  if (!attFromA || !attFromB) return false;
  if (attFromA.fromPub !== attFromB.toPub) return false;
  if (attFromB.fromPub !== attFromA.toPub) return false;
  if (attFromA.secretHash !== attFromB.secretHash) return false;
  const [okA, okB] = await Promise.all([
    verifyLinkAttestation(attFromA, crypto),
    verifyLinkAttestation(attFromB, crypto),
  ]);
  return okA && okB;
}

/** Build a signed revocation of the caller's link toward `peerPub`. */
export async function buildRevocation(args: {
  selfPub: string;
  peerPub: string;
  crypto: LinkCrypto;
  now?: number;
}): Promise<LinkRevocation> {
  const { selfPub, peerPub, crypto } = args;
  const revokedAt = args.now ?? Date.now();
  const sig = await crypto.sign(revocationSigningInput({ fromPub: selfPub, toPub: peerPub, revokedAt }));
  return { fromPub: selfPub, toPub: peerPub, revokedAt, sig };
}

export async function verifyRevocation(rev: LinkRevocation, crypto: LinkCrypto): Promise<boolean> {
  if (!rev || !rev.fromPub || !rev.toPub || !rev.sig) return false;
  return crypto.verify(revocationSigningInput(rev), rev.sig, rev.fromPub);
}

/**
 * A revocation supersedes an attestation when it verifies, targets the same
 * pair, and was issued at or after the attestation. Either party's revocation
 * breaks the link.
 */
export async function isLinkRevoked(
  att: LinkAttestation,
  revocation: LinkRevocation | null | undefined,
  crypto: LinkCrypto,
): Promise<boolean> {
  if (!revocation) return false;
  const sameEdge =
    (revocation.fromPub === att.fromPub && revocation.toPub === att.toPub) ||
    (revocation.fromPub === att.toPub && revocation.toPub === att.fromPub);
  if (!sameEdge) return false;
  if (revocation.revokedAt < att.issuedAt) return false;
  return verifyRevocation(revocation, crypto);
}

/**
 * Resolve the link state for a pair from whatever attestations/revocations are
 * present on the shared graph. Revocation wins; then both-present+verified =
 * linked; one side = pending; nothing = none.
 */
export async function resolveLinkState(args: {
  attFromSelf?: LinkAttestation | null;
  attFromPeer?: LinkAttestation | null;
  revocation?: LinkRevocation | null;
  crypto: LinkCrypto;
}): Promise<LinkState> {
  const { attFromSelf, attFromPeer, revocation, crypto } = args;
  const anchor = attFromSelf || attFromPeer;
  if (anchor && (await isLinkRevoked(anchor, revocation, crypto))) return 'revoked';
  if (await linkVerified(attFromSelf, attFromPeer, crypto)) return 'linked';
  if (attFromSelf || attFromPeer) return 'pending';
  return 'none';
}

// --- base64url helpers (work in browser and Node) ------------------------------

function base64UrlEncode(str: string): string {
  const b64 =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(str)))
      : Buffer.from(str, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return typeof atob === 'function'
    ? decodeURIComponent(escape(atob(padded)))
    : Buffer.from(padded, 'base64').toString('utf-8');
}
