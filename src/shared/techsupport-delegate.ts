import { canonicalSerialize } from './cid';
import SEA from 'gun/sea';
import { isTrustedDmPubWithRecovery, type RecoveryAnchorRecord } from './techsupport-recovery';

/**
 * Delegated TechSupport answers (docs/TODO.md K7, design note
 * docs/design/techsupport-k7-design-note.md — "signed redirect").
 *
 * The master TechSupport DM private key never leaves the operator's own device. Instead the
 * operator mints a small, signed, expiring credential extending trust to a co-operator's OWN
 * keypair ("may answer TechSupport questions"), revocable at any time. A delegate's answers are
 * signed with their own key; verification checks the answer's author against the master anchors
 * OR a currently-valid grant for that pub — never by handing over the master key.
 */

export interface TechSupportDelegateGrant {
  /** The delegate's OWN identity pub (an ordinary registered user) — never the master's. */
  delegatePub: string;
  /**
   * The delegate's ordinary app user id, as the operator entered it when issuing the grant.
   * Not part of the trust decision (that's `delegatePub` + the signature) — kept only so a
   * question-sender can resolve this delegate's epub for mailbox fan-out the same way it already
   * resolves any other peer's (`resolvePeerEpub(userId)`), without a second lookup scheme.
   */
  delegateUserId: string;
  /** Operator-chosen label (e.g. "Alice's phone") — audit-only, never shown to askers. */
  label: string;
  issuedAt: string;
  /** Hard cap; no grant is open-ended. */
  expiresAt: string;
  /** Set (and republished) to revoke before expiry. */
  revokedAt: string | null;
  /** Which trust anchor issued this — supports future multi-anchor rotation. */
  masterPub: string;
  signature: string;
}

export type UnsignedDelegateGrant = Omit<TechSupportDelegateGrant, 'signature'>;

export const DELEGATE_GRANT_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DELEGATE_GRANT_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DELEGATE_GRANTS_ROOT = 'techsupport-delegates';
export const DELEGATE_REVOCATIONS_ROOT = 'techsupport-delegate-revocations';

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

export function delegateGrantSigningPayload(grant: UnsignedDelegateGrant): string {
  return canonicalSerialize({
    kind: 'techsupport-delegate-grant',
    delegatePub: grant.delegatePub,
    delegateUserId: grant.delegateUserId,
    label: grant.label,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    masterPub: grant.masterPub,
  });
}

/** Runtime, master-device only (holds the DM pair). Issues or re-issues (edits/revokes) a grant. */
export async function signDelegateGrant(
  input: { delegatePub: string; delegateUserId: string; label: string; expiresAt: string; issuedAt?: string; revokedAt?: string | null },
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<TechSupportDelegateGrant> {
  const unsigned: UnsignedDelegateGrant = {
    delegatePub: input.delegatePub,
    delegateUserId: input.delegateUserId,
    label: input.label,
    issuedAt: input.issuedAt || new Date().toISOString(),
    expiresAt: input.expiresAt,
    revokedAt: input.revokedAt ?? null,
    masterPub: pair.pub,
  };
  const signature = await SEA.sign(delegateGrantSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport delegate grant');
  return { ...unsigned, signature };
}

/**
 * Verifies signature + shape + anchor only — does NOT check expiry/revocation (see
 * `isValidDelegateGrant` for that). Never throws (fail-closed discipline matching
 * `verifyFaqBundle`/`verifyTechSupportGreeting`): callers get null on any malformed or
 * untrusted input.
 *
 * `options.recovery` (docs/TODO.md OPEN-29): when supplied, a grant signed by a `masterPub` the
 * recovery authority has since revoked is rejected even if that pub is still in the compiled
 * `dm.trusted` list — a compromised root's already-issued delegate grants must stop working the
 * moment recovery revokes it, not linger until the next client rebuild. Optional and additive:
 * every existing call site that doesn't pass it keeps its exact current behavior.
 */
export async function verifyDelegateGrant(
  value: unknown,
  options?: { recovery?: RecoveryAnchorRecord | null | undefined },
): Promise<TechSupportDelegateGrant | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TechSupportDelegateGrant>;
  if (
    !candidate.delegatePub ||
    !candidate.delegateUserId ||
    typeof candidate.label !== 'string' ||
    !candidate.issuedAt ||
    !candidate.expiresAt ||
    candidate.revokedAt === undefined ||
    !candidate.masterPub ||
    !candidate.signature
  ) {
    return null;
  }
  if (!isTrustedDmPubWithRecovery(candidate.masterPub, options?.recovery)) return null;

  // GunService deserializes ISO strings to Date objects on server reads. Normalize them back to
  // the exact signed wire representation before canonical verification; browser/Gun wire callers
  // already supply strings.
  const issuedAt = normalizedTimestamp(candidate.issuedAt);
  const expiresAt = normalizedTimestamp(candidate.expiresAt);
  const revokedAt = candidate.revokedAt === null ? null : normalizedTimestamp(candidate.revokedAt);
  if (!issuedAt || !expiresAt || (candidate.revokedAt !== null && !revokedAt)) return null;

  const unsigned: UnsignedDelegateGrant = {
    delegatePub: candidate.delegatePub,
    delegateUserId: candidate.delegateUserId,
    label: candidate.label,
    issuedAt,
    expiresAt,
    revokedAt,
    masterPub: candidate.masterPub,
  };
  const issuedAtMs = new Date(unsigned.issuedAt).getTime();
  const expiresAtMs = new Date(unsigned.expiresAt).getTime();
  const revokedAtMs = unsigned.revokedAt ? new Date(unsigned.revokedAt).getTime() : null;
  if (
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > DELEGATE_GRANT_MAX_TTL_MS ||
    (revokedAtMs !== null && (!Number.isFinite(revokedAtMs) || revokedAtMs < issuedAtMs))
  ) {
    return null;
  }
  try {
    const verified = await SEA.verify(candidate.signature, candidate.masterPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== delegateGrantSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}

/** Pure time check on an already-signature-verified grant: not revoked, not expired. */
export function isValidDelegateGrant(
  grant: TechSupportDelegateGrant | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!grant) return false;
  if (grant.revokedAt) return false;
  const expiry = new Date(grant.expiresAt).getTime();
  if (!Number.isFinite(expiry)) return false;
  return expiry > now.getTime();
}

/**
 * Monotonic anti-rollback rule for the one-record-per-delegate v1 graph shape. It makes retries
 * idempotent, permits an explicitly newer re-issue, and refuses an older signed grant (including
 * the pre-revocation form of the same issue) from replacing newer locally-observed knowledge.
 * The append-only revocation discovery root supplies first-seen history when available; no local
 * rule can prove freshness if every transport withholds both current state and that history.
 */
export function isDelegateGrantRollback(
  current: TechSupportDelegateGrant,
  incoming: TechSupportDelegateGrant,
): boolean {
  if (current.delegatePub !== incoming.delegatePub) return true;
  const currentIssued = new Date(current.issuedAt).getTime();
  const incomingIssued = new Date(incoming.issuedAt).getTime();
  if (!Number.isFinite(incomingIssued)) return true;
  if (!Number.isFinite(currentIssued)) return false;
  if (incomingIssued < currentIssued) return true;
  if (incomingIssued > currentIssued) return false;
  if (current.revokedAt && !incoming.revokedAt) return true;
  if (current.revokedAt && incoming.revokedAt) {
    return new Date(incoming.revokedAt).getTime() < new Date(current.revokedAt).getTime();
  }
  return false;
}

/** Signature-verify AND validity-check in one call — the common case for a trust decision. */
export async function verifyValidDelegateGrant(value: unknown, now: Date = new Date()): Promise<TechSupportDelegateGrant | null> {
  const verified = await verifyDelegateGrant(value);
  return isValidDelegateGrant(verified, now) ? verified : null;
}

/**
 * True when `pub` may author content rendered as TechSupport: either a compiled master anchor
 * (or, docs/TODO.md OPEN-29, a recovery-extended one — and rejected outright if recovery has
 * revoked it, even though it's still compiled-trusted), or the holder of a currently-valid
 * delegate grant whose OWN masterPub passes that same recovery-aware check (a grant issued by a
 * since-revoked master stops authorizing its delegate immediately, not just at the next client
 * rebuild). `fetchGrant` is injected so this module stays Gun-agnostic (callers supply a live
 * Gun read or a local verified-grant cache). Never throws — a `fetchGrant` failure is treated as
 * "no grant," not an error.
 */
export async function isTrustedTechSupportAuthorPub(
  pub: string | undefined | null,
  fetchGrant: (delegatePub: string) => Promise<unknown>,
  recovery?: RecoveryAnchorRecord | null,
): Promise<boolean> {
  const candidate = String(pub ?? '').trim();
  if (!candidate) return false;
  if (isTrustedDmPubWithRecovery(candidate, recovery)) return true;
  try {
    const raw = await fetchGrant(candidate);
    return isValidDelegateGrant(await verifyDelegateGrant(raw, { recovery }));
  } catch {
    return false;
  }
}

/** Gun path for one delegate's grant record — one soul per delegate pub, overwritten to edit/revoke. */
export function delegateGrantPath(delegatePub: string): string[] {
  return [DELEGATE_GRANTS_ROOT, delegatePub];
}

/**
 * Append-only discovery location for a signed revoked grant. The mutable per-delegate slot remains
 * the fast current-state lookup; this second root preserves each revocation as its own record so a
 * stale mutable slot cannot, by itself, resurrect authority for a newly installed client.
 */
export function delegateRevocationPath(grant: TechSupportDelegateGrant): string[] {
  if (!grant.revokedAt) throw new Error('A delegate revocation path requires revokedAt');
  const revision = encodeURIComponent(`${grant.delegatePub}|${grant.issuedAt}|${grant.revokedAt}`);
  return [DELEGATE_REVOCATIONS_ROOT, revision];
}
