import { canonicalSerialize } from './cid';
import SEA from 'gun/sea';
import { isTrustedTechSupportRecoveryPub, isTrustedTechSupportDmPub, isTrustedAnnouncementPub } from './techsupport';

/**
 * Independent TechSupport emergency recovery authority (docs/TODO.md OPEN-29,
 * docs/security/techsupport-and-user-production-security.md).
 *
 * A stolen/compromised TechSupport DM or announcement key can't be made secret again by
 * changing a passphrase — clients have to actively stop trusting its public key, and an
 * installed client (an old Android APK, a browser tab that hasn't reloaded) can't wait for a
 * new app build to learn that. The recovery key exists exactly for this: pinned into every
 * client BEFORE any incident (`techsupport-trust-anchors.json`'s `recovery` section, compiled
 * the same way the dm/announcement anchors are), kept in genuinely separate offline custody
 * from the day-to-day DM vault, and used ONLY to sign a small, live-discoverable
 * "revocation / next-anchor" record — never for routine operation.
 *
 * One global record (not one per delegate/question the way K7/K5 are) — there is only ever one
 * "currently trusted DM/announcement anchor set, as amended by recovery" state. A newer record
 * (by `issuedAt`) supersedes an older one; there is no `revokedAt`/expiry on the record itself
 * (unlike a K7 delegate grant) because letting recovery-established trust silently lapse mid-
 * incident would be actively harmful — trust changes only by a newer, explicitly-signed record.
 *
 * Reuses the same compile-once/sign-with-an-offline-key/verify-before-trust/fail-closed/
 * monotonic-anti-rollback discipline as K2's greeting, K5's FAQ bundle, and K7's delegate
 * grant — this is the same family of mechanism, applied to the trust anchors themselves rather
 * than to app content.
 */

export interface RecoveryAnchorRecord {
  /** The recovery key's own pub — verified against `recovery.trusted`, never the dm/announcement anchors. */
  recoveryPub: string;
  /** DM pub(s) no longer trusted as of this record, even if still compiled into `dm.trusted`. */
  revokedDmPubs: string[];
  /** Announcement pub(s) no longer trusted as of this record. */
  revokedAnnouncementPubs: string[];
  /** A DM pub to trust in ADDITION to the compiled `dm.trusted` list, or null for "unchanged". */
  nextDmPub: string | null;
  /** An announcement pub to trust in addition to the compiled list, or null for "unchanged". */
  nextAnnouncementPub: string | null;
  issuedAt: string;
  /** Operator-authored, human-readable — shown in the master's own audit view, never to an asker. */
  reason: string;
  signature: string;
}

export type UnsignedRecoveryAnchorRecord = Omit<RecoveryAnchorRecord, 'signature'>;

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

export function recoveryAnchorSigningPayload(record: UnsignedRecoveryAnchorRecord): string {
  return canonicalSerialize({
    kind: 'techsupport-recovery-anchor',
    recoveryPub: record.recoveryPub,
    revokedDmPubs: record.revokedDmPubs,
    revokedAnnouncementPubs: record.revokedAnnouncementPubs,
    nextDmPub: record.nextDmPub,
    nextAnnouncementPub: record.nextAnnouncementPub,
    issuedAt: record.issuedAt,
    reason: record.reason,
  });
}

/** Runtime, recovery-vault-holder only (the offline recovery tool). Signs a new anchor record. */
export async function signRecoveryAnchor(
  input: {
    revokedDmPubs?: string[];
    revokedAnnouncementPubs?: string[];
    nextDmPub?: string | null;
    nextAnnouncementPub?: string | null;
    reason: string;
    issuedAt?: string;
  },
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<RecoveryAnchorRecord> {
  const unsigned: UnsignedRecoveryAnchorRecord = {
    recoveryPub: pair.pub,
    revokedDmPubs: [...(input.revokedDmPubs ?? [])],
    revokedAnnouncementPubs: [...(input.revokedAnnouncementPubs ?? [])],
    nextDmPub: input.nextDmPub ?? null,
    nextAnnouncementPub: input.nextAnnouncementPub ?? null,
    issuedAt: input.issuedAt || new Date().toISOString(),
    reason: input.reason,
  };
  const signature = await SEA.sign(recoveryAnchorSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport recovery anchor');
  return { ...unsigned, signature };
}

/**
 * Any client. Verifies shape, that `recoveryPub` is a trusted RECOVERY anchor (never a dm/
 * announcement anchor — a compromised DM key must not be able to forge its own recovery),
 * and the signature. Never throws (K2-3 fail-closed discipline): callers get null on any
 * malformed or untrusted input.
 */
export async function verifyRecoveryAnchor(value: unknown): Promise<RecoveryAnchorRecord | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RecoveryAnchorRecord>;
  if (
    !candidate.recoveryPub ||
    !Array.isArray(candidate.revokedDmPubs) ||
    !Array.isArray(candidate.revokedAnnouncementPubs) ||
    candidate.nextDmPub === undefined ||
    candidate.nextAnnouncementPub === undefined ||
    !candidate.issuedAt ||
    typeof candidate.reason !== 'string' ||
    !candidate.signature
  ) {
    return null;
  }
  if (!isTrustedTechSupportRecoveryPub(candidate.recoveryPub)) return null;
  if (candidate.revokedDmPubs.some((pub) => typeof pub !== 'string')) return null;
  if (candidate.revokedAnnouncementPubs.some((pub) => typeof pub !== 'string')) return null;
  if (candidate.nextDmPub !== null && typeof candidate.nextDmPub !== 'string') return null;
  if (candidate.nextAnnouncementPub !== null && typeof candidate.nextAnnouncementPub !== 'string') return null;

  // GunService deserializes ISO strings to Date objects on server reads, same as the delegate
  // grant's own issuedAt — normalize back to the exact signed wire representation.
  const issuedAt = normalizedTimestamp(candidate.issuedAt);
  if (!issuedAt) return null;

  const unsigned: UnsignedRecoveryAnchorRecord = {
    recoveryPub: candidate.recoveryPub,
    revokedDmPubs: candidate.revokedDmPubs,
    revokedAnnouncementPubs: candidate.revokedAnnouncementPubs,
    nextDmPub: candidate.nextDmPub,
    nextAnnouncementPub: candidate.nextAnnouncementPub,
    issuedAt,
    reason: candidate.reason,
  };
  try {
    const verified = await SEA.verify(candidate.signature, candidate.recoveryPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== recoveryAnchorSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}

/**
 * Monotonic anti-rollback rule (mirrors `isDelegateGrantRollback`'s spirit for this record's
 * single-global-state shape): an incoming record only ever supersedes the current one if it is
 * STRICTLY newer. An equal-or-older `issuedAt` is a rollback and must be rejected — this is what
 * stops an attacker (or a stale cache/relay) from replaying an earlier, less-restrictive record
 * over a newer one that revoked a compromised key.
 */
export function isRecoveryAnchorRollback(
  current: RecoveryAnchorRecord,
  incoming: RecoveryAnchorRecord,
): boolean {
  const currentMs = new Date(current.issuedAt).getTime();
  const incomingMs = new Date(incoming.issuedAt).getTime();
  if (!Number.isFinite(incomingMs)) return true;
  if (!Number.isFinite(currentMs)) return false;
  return incomingMs <= currentMs;
}

/**
 * Effective DM trust: the compiled anchor list, amended by a verified recovery record — an
 * explicit revocation always wins (even over the compiled list), and `nextDmPub` extends trust
 * to a pub the compiled list doesn't yet contain. `recovery` is deliberately optional/nullable
 * so every existing call site keeps its exact current behavior until it's explicitly updated to
 * pass a live recovery record (see `techsupport-recovery-cache.ts` client-side).
 */
export function isTrustedDmPubWithRecovery(
  pub: string,
  recovery: RecoveryAnchorRecord | null | undefined,
): boolean {
  if (recovery?.revokedDmPubs.includes(pub)) return false;
  if (isTrustedTechSupportDmPub(pub)) return true;
  return !!recovery && recovery.nextDmPub === pub;
}

/** Same as {@link isTrustedDmPubWithRecovery}, for the announcement role. */
export function isTrustedAnnouncementPubWithRecovery(
  pub: string,
  recovery: RecoveryAnchorRecord | null | undefined,
): boolean {
  if (recovery?.revokedAnnouncementPubs.includes(pub)) return false;
  if (isTrustedAnnouncementPub(pub)) return true;
  return !!recovery && recovery.nextAnnouncementPub === pub;
}

/** Gun path for the mutable "current" slot every client subscribes to. */
export const RECOVERY_ANCHOR_ROOT = 'techsupport-recovery';
export function recoveryAnchorPath(): string[] {
  return [RECOVERY_ANCHOR_ROOT, 'current'];
}

/**
 * Append-only discovery location for every published record, keyed by its own identity —
 * mirrors `delegateRevocationPath`'s reasoning exactly: a stale/withheld mutable "current" slot
 * must not be able to hide that a newer record exists.
 */
export const RECOVERY_ANCHOR_HISTORY_ROOT = 'techsupport-recovery-history';
export function recoveryAnchorHistoryPath(record: RecoveryAnchorRecord): string[] {
  const revision = encodeURIComponent(`${record.recoveryPub}|${record.issuedAt}`);
  return [RECOVERY_ANCHOR_HISTORY_ROOT, revision];
}
