import { canonicalSerialize } from './cid';
import SEA from 'gun/sea';
import { isTrustedTechSupportAuthorPub } from './techsupport-delegate';
import type { RecoveryAnchorRecord } from './techsupport-recovery';
import { supportQuestionKey, type SupportFaqEntry } from './techsupport-faq';

/**
 * Per-entry signed FAQ record (docs/TODO.md OPEN-31).
 *
 * Replaces the single, whole-history `SignedFaqBundle` as the live distribution unit: every
 * answered question is its own record, addressed by its `questionKey` and signed on its own.
 * Publishing answer N+1 signs and writes ONE record (O(1), not a re-sign of all N), and an
 * asker's client fetches exactly the one record its own question hashes to instead of
 * downloading and caching the entire FAQ — so a device's cache grows with the questions *that
 * device* asked, never with the global FAQ.
 *
 * The record is FLAT (the entry's fields plus `version`/`authorPub`/`signature`, no nested
 * object) so it crosses the Gun/HTTP boundary as-is — Gun cannot store nested arrays and copes
 * poorly with nested objects, and this keeps the durable-store write a single-level node.
 *
 * Trust model is identical to the bundle's: `authorPub` must be a compiled DM anchor, a
 * recovery-extended one, or hold a currently-valid K7 delegate grant. On top of that the entry
 * must be *self-consistent* — `questionKey` has to be the hash of `canonicalQuestion` — so a
 * validly-signed entry can never be filed under (and later served for) a different question.
 */

export interface SignedFaqEntry extends SupportFaqEntry {
  version: number;
  authorPub: string;
  signature: string;
}

const FAQ_ENTRY_VERSION = 1;

/** Root of the per-entry records in the durable support store. */
export const FAQ_ENTRIES_ROOT = 'techsupport-faq-entries';

export function faqEntryRecordPath(questionKey: string): string[] {
  return [FAQ_ENTRIES_ROOT, questionKey];
}

export function faqEntrySigningPayload(entry: SupportFaqEntry & { version: number; authorPub: string }): string {
  return canonicalSerialize({
    kind: 'techsupport-faq-entry',
    version: entry.version,
    questionKey: entry.questionKey,
    canonicalQuestion: entry.canonicalQuestion,
    answer: entry.answer,
    answeredAt: entry.answeredAt,
    ...(entry.answeredByDelegate ? { answeredByDelegate: entry.answeredByDelegate } : {}),
    authorPub: entry.authorPub,
  });
}

/** Runtime, on the answering device (master, or a K7 delegate). Signs exactly one entry. */
export async function signFaqEntry(
  entry: SupportFaqEntry,
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<SignedFaqEntry> {
  const unsigned = {
    version: FAQ_ENTRY_VERSION,
    questionKey: entry.questionKey,
    canonicalQuestion: entry.canonicalQuestion,
    answer: entry.answer,
    answeredAt: entry.answeredAt,
    ...(entry.answeredByDelegate ? { answeredByDelegate: entry.answeredByDelegate } : {}),
    authorPub: pair.pub,
  };
  const signature = await SEA.sign(faqEntrySigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport FAQ entry');
  return { ...unsigned, signature };
}

/**
 * Any client or the relay. Verifies shape, key/question consistency, author trust (same rules
 * and same optional `fetchGrant`/`recovery` inputs as `verifyFaqBundle`), and that the signature
 * recovers the exact canonical payload. Returns the verified entry (own fields only — anything
 * extra on the input is dropped) or null; never throws, so callers fail closed.
 */
export async function verifyFaqEntry(
  value: unknown,
  options?: {
    fetchGrant?: (delegatePub: string) => Promise<unknown>;
    recovery?: RecoveryAnchorRecord | null | undefined;
  },
): Promise<SignedFaqEntry | null> {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<SignedFaqEntry>;
  if (
    typeof c.version !== 'number' ||
    typeof c.questionKey !== 'string' || !c.questionKey ||
    typeof c.canonicalQuestion !== 'string' || !c.canonicalQuestion ||
    typeof c.answer !== 'string' || !c.answer ||
    typeof c.answeredAt !== 'string' || !c.answeredAt ||
    typeof c.authorPub !== 'string' || !c.authorPub ||
    typeof c.signature !== 'string' || !c.signature ||
    (c.answeredByDelegate !== undefined && typeof c.answeredByDelegate !== 'string')
  ) {
    return null;
  }
  if (supportQuestionKey(c.canonicalQuestion) !== c.questionKey) return null;

  const trusted = await isTrustedTechSupportAuthorPub(
    c.authorPub,
    options?.fetchGrant ?? (async () => null),
    options?.recovery,
  );
  if (!trusted) return null;

  const verifiedEntry: SignedFaqEntry = {
    version: c.version,
    questionKey: c.questionKey,
    canonicalQuestion: c.canonicalQuestion,
    answer: c.answer,
    answeredAt: c.answeredAt,
    ...(c.answeredByDelegate ? { answeredByDelegate: c.answeredByDelegate } : {}),
    authorPub: c.authorPub,
    signature: c.signature,
  };
  try {
    const verified = await SEA.verify(c.signature, c.authorPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== faqEntrySigningPayload(verifiedEntry)) return null;
  } catch {
    return null;
  }
  return verifiedEntry;
}

/** The plain `SupportFaqEntry` view of a signed record (what the lookup/render code consumes). */
export function faqEntryOf(signed: SignedFaqEntry): SupportFaqEntry {
  return {
    questionKey: signed.questionKey,
    canonicalQuestion: signed.canonicalQuestion,
    answer: signed.answer,
    answeredAt: signed.answeredAt,
    ...(signed.answeredByDelegate ? { answeredByDelegate: signed.answeredByDelegate } : {}),
  };
}

/**
 * True when `next` would replace a NEWER answer for the same question with an older one (a
 * replayed stale record). Equal timestamps are not a rollback, so a re-publish is idempotent.
 * Unparseable timestamps never verify upstream in practice, but treat them as rollback-safe:
 * an unreadable `next` cannot displace a readable `current`.
 */
export function isFaqEntryRollback(current: SignedFaqEntry, next: SignedFaqEntry): boolean {
  if (current.questionKey !== next.questionKey) return false;
  const currentAt = Date.parse(current.answeredAt);
  const nextAt = Date.parse(next.answeredAt);
  if (Number.isNaN(nextAt)) return !Number.isNaN(currentAt);
  if (Number.isNaN(currentAt)) return false;
  return nextAt < currentAt;
}
