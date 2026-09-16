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
export function delegateRequestPath(requestId: string): string[] {
  return ['techsupport-delegate-requests', requestId];
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
