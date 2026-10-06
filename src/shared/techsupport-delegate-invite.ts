import { canonicalSerialize } from './cid';
import SEA from 'gun/sea';

/**
 * TechSupport delegate invite handshake (docs/TODO.md K7 follow-on).
 *
 * `techsupport-delegate.ts` already lets the master extend trust to a co-operator's
 * own key without ever sharing the master key — but issuing a grant required the
 * master to manually type the candidate's raw app userId, with no confirmation it
 * was the right person. This module adds a short-lived invite code (analogous to
 * `identity-linking.ts`'s device-pairing code, but deliberately a distinct wire
 * format — never interchangeable with a device-link code): the master generates
 * one, a candidate enters it to publish a signed self-identifying request, and the
 * master reviews + approves that request into an ordinary `TechSupportDelegateGrant`.
 * The request is signed with the CANDIDATE's own key — the master's key still never
 * leaves the master's device.
 */

export const DELEGATE_INVITE_TTL_MS = 5 * 60 * 1000; // ~5 minutes, matches PAIRING_TTL_MS
export const DELEGATE_INVITE_SCHEMA_VERSION = 1 as const;

/** The short-lived payload encoded in the master's invite code / QR. */
export interface DelegateInvitePayload {
  version: typeof DELEGATE_INVITE_SCHEMA_VERSION;
  /** Random, non-secret identifier — also the Gun soul the resulting request is published at. */
  requestId: string;
  /** One-time invite secret; the resulting request proves possession via secretHash. */
  secret: string;
  /** Unix-ms expiry. */
  expiresAt: number;
}

/** Master device: build a fresh invite payload for its code / QR. */
export function createDelegateInvite(randomSecret: () => string, now: number = Date.now()): DelegateInvitePayload {
  return {
    version: DELEGATE_INVITE_SCHEMA_VERSION,
    requestId: randomSecret(),
    secret: randomSecret(),
    expiresAt: now + DELEGATE_INVITE_TTL_MS,
  };
}

export function encodeDelegateInviteCode(payload: DelegateInvitePayload): string {
  const json = JSON.stringify([payload.version, payload.requestId, payload.secret, payload.expiresAt]);
  return base64UrlEncode(json);
}

export function decodeDelegateInviteCode(code: string): DelegateInvitePayload | null {
  try {
    const arr = JSON.parse(base64UrlDecode(code.trim()));
    if (!Array.isArray(arr) || arr.length !== 4) return null;
    const [version, requestId, secret, expiresAt] = arr;
    if (version !== DELEGATE_INVITE_SCHEMA_VERSION) return null;
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 256) return null;
    if (typeof secret !== 'string' || secret.length < 8 || secret.length > 512) return null;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
    return { version, requestId, secret, expiresAt };
  } catch {
    return null;
  }
}

export function isDelegateInviteExpired(payload: DelegateInvitePayload, now: number = Date.now()): boolean {
  return now > payload.expiresAt;
}

/** A candidate's signed request to become a TechSupport delegate, published at
 * `delegateRequestPath(requestId)`. Signed with the candidate's OWN key. */
export interface TechSupportDelegateRequest {
  requestId: string;
  /** hash(secret) — ties this request to the specific invite code that produced it. */
  secretHash: string;
  /** The candidate's own identity pub — never the master's. */
  candidatePub: string;
  /** The candidate's ordinary app userId, resolved the same way any peer's is. */
  candidateUserId: string;
  requestedAt: string;
  signature: string;
}

export type UnsignedDelegateRequest = Omit<TechSupportDelegateRequest, 'signature'>;

function delegateRequestSigningPayload(request: UnsignedDelegateRequest): string {
  return canonicalSerialize({
    kind: 'techsupport-delegate-request',
    requestId: request.requestId,
    secretHash: request.secretHash,
    candidatePub: request.candidatePub,
    candidateUserId: request.candidateUserId,
    requestedAt: request.requestedAt,
  });
}

/** Candidate device only: signs with the candidate's own pair. */
export async function buildDelegateRequest(
  input: { requestId: string; secret: string; candidateUserId: string },
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<TechSupportDelegateRequest> {
  const secretHash = String(await SEA.work(input.secret, null, null, { name: 'SHA-256' }));
  const unsigned: UnsignedDelegateRequest = {
    requestId: input.requestId,
    secretHash,
    candidatePub: pair.pub,
    candidateUserId: input.candidateUserId,
    requestedAt: new Date().toISOString(),
  };
  const signature = await SEA.sign(delegateRequestSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport delegate request');
  return { ...unsigned, signature };
}

/**
 * Verifies signature + shape only (fail-closed like `verifyDelegateGrant`) — never
 * throws. The master still has to separately check the recovered `secretHash`
 * against its own cached outstanding invite's secret, and the invite's expiry:
 * this module has no knowledge of which invite (if any) produced this request.
 */
export async function verifyDelegateRequest(value: unknown): Promise<TechSupportDelegateRequest | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TechSupportDelegateRequest>;
  if (
    !candidate.requestId ||
    !candidate.secretHash ||
    !candidate.candidatePub ||
    !candidate.candidateUserId ||
    !candidate.requestedAt ||
    !candidate.signature
  ) {
    return null;
  }
  const unsigned: UnsignedDelegateRequest = {
    requestId: candidate.requestId,
    secretHash: candidate.secretHash,
    candidatePub: candidate.candidatePub,
    candidateUserId: candidate.candidateUserId,
    requestedAt: candidate.requestedAt,
  };
  try {
    const verified = await SEA.verify(candidate.signature, candidate.candidatePub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== delegateRequestSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}

/**
 * Master device only: does this verified request match one of the master's own
 * outstanding invites? Checks both the requestId correlation and that the request's
 * secretHash was actually derived from this invite's secret (not just a requestId
 * collision) — keeps the SHA-256 hashing on the shared/crypto side rather than
 * duplicating `SEA.work` calls at every call site.
 */
export async function delegateRequestMatchesInvite(
  request: Pick<TechSupportDelegateRequest, 'requestId' | 'secretHash'>,
  invite: Pick<DelegateInvitePayload, 'requestId' | 'secret'>,
): Promise<boolean> {
  if (request.requestId !== invite.requestId) return false;
  const expectedHash = String(await SEA.work(invite.secret, null, null, { name: 'SHA-256' }));
  return request.secretHash === expectedHash;
}

/** Gun path for one outstanding invite's request — one soul per requestId, directly
 * addressable (the master already knows the requestId it generated; no roster scan
 * needed to check on a specific invite, though the master's panel also live-subscribes
 * to the whole root to surface requests without a manual "check" click). */
export const DELEGATE_REQUESTS_ROOT = 'techsupport-delegate-requests';
export function delegateRequestPath(requestId: string): string[] {
  return [DELEGATE_REQUESTS_ROOT, requestId];
}

// --- Targeted (remote) invites --------------------------------------------------
// A redundant alternative to showing the code/QR: the master picks a specific known user and
// publishes an invite addressed to that user's pub. The candidate's client discovers it at its
// own per-pub slot and shows Accept/Decline; accepting publishes the ordinary signed request
// above. No physical proximity or out-of-band channel is needed, because the binding no longer
// rests on the secret staying private — the request is only accepted when it is signed by
// `targetPub` itself (see `delegateRequestMatchesTargetedInvite`). The `secret` field is kept so
// the candidate side reuses `buildDelegateRequest` unchanged; it is NOT confidential here (the
// invite travels in plaintext on the graph/relay).

export const TARGETED_DELEGATE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TARGETED_DELEGATE_INVITES_ROOT = 'techsupport-delegate-invites';

export interface TargetedDelegateInvite {
  version: typeof DELEGATE_INVITE_SCHEMA_VERSION;
  requestId: string;
  secret: string;
  /** The invited user's identity pub — only a request signed by this key is accepted. */
  targetPub: string;
  targetUserId: string;
  expiresAt: number;
  /** Master pub that signed this invite; must be a trusted TechSupport anchor. */
  masterPub: string;
  signature: string;
}

export type UnsignedTargetedDelegateInvite = Omit<TargetedDelegateInvite, 'signature'>;

function targetedInviteSigningPayload(invite: UnsignedTargetedDelegateInvite): string {
  return canonicalSerialize({
    kind: 'techsupport-delegate-targeted-invite',
    version: invite.version,
    requestId: invite.requestId,
    secret: invite.secret,
    targetPub: invite.targetPub,
    targetUserId: invite.targetUserId,
    expiresAt: invite.expiresAt,
    masterPub: invite.masterPub,
  });
}

/** Master device only: build + sign an invite addressed to one known user. */
export async function signTargetedDelegateInvite(
  input: { targetPub: string; targetUserId: string; randomSecret: () => string; now?: number },
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<TargetedDelegateInvite> {
  const unsigned: UnsignedTargetedDelegateInvite = {
    version: DELEGATE_INVITE_SCHEMA_VERSION,
    requestId: input.randomSecret(),
    secret: input.randomSecret(),
    targetPub: input.targetPub,
    targetUserId: input.targetUserId,
    expiresAt: (input.now ?? Date.now()) + TARGETED_DELEGATE_INVITE_TTL_MS,
    masterPub: pair.pub,
  };
  const signature = await SEA.sign(targetedInviteSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport targeted delegate invite');
  return { ...unsigned, signature };
}

/**
 * Signature + shape only — never throws, fail-closed. Callers on the candidate side must
 * additionally check `masterPub` against the trusted TechSupport anchors and that `targetPub` is
 * their own pub; expiry is checked with `isDelegateInviteExpired`.
 */
export async function verifyTargetedDelegateInvite(value: unknown): Promise<TargetedDelegateInvite | null> {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<TargetedDelegateInvite>;
  if (
    c.version !== DELEGATE_INVITE_SCHEMA_VERSION ||
    typeof c.requestId !== 'string' || c.requestId.length < 8 ||
    typeof c.secret !== 'string' || c.secret.length < 8 ||
    !c.targetPub || !c.targetUserId || !c.masterPub || !c.signature ||
    !Number.isSafeInteger(c.expiresAt) || (c.expiresAt as number) <= 0
  ) {
    return null;
  }
  const unsigned: UnsignedTargetedDelegateInvite = {
    version: c.version,
    requestId: c.requestId,
    secret: c.secret,
    targetPub: c.targetPub,
    targetUserId: c.targetUserId,
    expiresAt: c.expiresAt as number,
    masterPub: c.masterPub,
  };
  if (unsigned.targetPub === unsigned.masterPub) return null;
  try {
    const verified = await SEA.verify(c.signature, c.masterPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== targetedInviteSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: c.signature };
}

/** Master side: the request matches only when signed by the invited user's own key. */
export async function delegateRequestMatchesTargetedInvite(
  request: Pick<TechSupportDelegateRequest, 'requestId' | 'secretHash' | 'candidatePub'>,
  invite: Pick<TargetedDelegateInvite, 'requestId' | 'secret' | 'targetPub'>,
): Promise<boolean> {
  if (request.candidatePub !== invite.targetPub) return false;
  return delegateRequestMatchesInvite(request, invite);
}

/** The invited user's single inbox slot — a newer invite for the same user replaces the older. */
export function targetedDelegateInvitePath(targetPub: string): string[] {
  return [TARGETED_DELEGATE_INVITES_ROOT, targetPub];
}

// --- base64url helpers ---------------------------------------------------------
// Deliberately duplicated from identity-linking.ts rather than shared: this is a
// different wire format (4 fields, no `pub`) and must never be interchangeable
// with a device-link pairing code.

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
