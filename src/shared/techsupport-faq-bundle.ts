import { canonicalSerialize, computeCIDv1 } from './cid';
import SEA from 'gun/sea';
import { isTrustedTechSupportDmPub } from './techsupport';
import type { SupportFaqEntry } from './techsupport-faq';

/**
 * Signed FAQ bundle (docs/TODO.md K5, design note §Item 1a).
 *
 * Unlike the K2 greeting (static, compiled, signed once by a build script), the FAQ bundle
 * grows at runtime as the operator answers questions, so it is signed LIVE by the TechSupport
 * device (which holds the DM pair via K3) every time an answer is published — never by a build
 * script. The asker's own client cannot sign anything, so the whole bundle is signed as one
 * unit and the signature travels with the cached data; the asker's client verifies the cached
 * bundle and attaches its signature/authorPub to a locally-rendered auto-answer message,
 * exactly the same trick K2's greeting uses for offline authorship.
 *
 * v1 distributes this bundle over a public Gun path (`techsupport-faq/bundle`), not libp2p/IPFS
 * (decision K5-B — that distribution path does not exist yet in this codebase; only a
 * media-attachment blockstore does). `bundleCid` content-addresses the entries now so the
 * distribution layer can be swapped for the real §25 document layer later with no change to the
 * sign/verify/cache/lookup code here.
 */

export interface SignedFaqBundle {
  version: number;
  entries: SupportFaqEntry[];
  authorPub: string;
  bundleCid: string;
  signature: string;
}

export type UnsignedFaqBundle = Omit<SignedFaqBundle, 'signature'>;

const FAQ_BUNDLE_VERSION = 1;

async function computeBundleCid(entries: readonly SupportFaqEntry[]): Promise<string> {
  return computeCIDv1({ kind: 'techsupport-faq-bundle-entries', entries });
}

export function faqBundleSigningPayload(bundle: UnsignedFaqBundle): string {
  return canonicalSerialize({
    kind: 'techsupport-faq-bundle',
    version: bundle.version,
    entries: bundle.entries,
    authorPub: bundle.authorPub,
    bundleCid: bundle.bundleCid,
  });
}

/**
 * Runtime, TechSupport-device only (holds the DM pair via K3). Signs the current entry list for
 * publish. Callers pass the full, already-`upsertSupportFaqEntry`-merged entry list.
 */
export async function signFaqBundle(
  entries: readonly SupportFaqEntry[],
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<SignedFaqBundle> {
  const bundleCid = await computeBundleCid(entries);
  const unsigned: UnsignedFaqBundle = {
    version: FAQ_BUNDLE_VERSION,
    entries: [...entries],
    authorPub: pair.pub,
    bundleCid,
  };
  const signature = await SEA.sign(faqBundleSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport FAQ bundle');
  return { ...unsigned, signature };
}

/**
 * Any client. Verifies: shape, `authorPub` is a trusted DM anchor, `bundleCid` matches the
 * entries (rejects a tampered entry list even if otherwise validly signed), and the signature
 * recovers the exact canonical payload. Returns the verified bundle or null — never throws, so
 * callers can suppress silently (same fail-closed discipline as K2-3).
 */
export async function verifyFaqBundle(value: unknown): Promise<SignedFaqBundle | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SignedFaqBundle>;
  if (
    typeof candidate.version !== 'number' ||
    !Array.isArray(candidate.entries) ||
    !candidate.authorPub ||
    !candidate.bundleCid ||
    !candidate.signature
  ) {
    return null;
  }
  if (!isTrustedTechSupportDmPub(candidate.authorPub)) return null;

  const entries = candidate.entries as SupportFaqEntry[];
  const recomputedCid = await computeBundleCid(entries);
  if (recomputedCid !== candidate.bundleCid) return null;

  const unsigned: UnsignedFaqBundle = {
    version: candidate.version,
    entries,
    authorPub: candidate.authorPub,
    bundleCid: candidate.bundleCid,
  };
  try {
    const verified = await SEA.verify(candidate.signature, candidate.authorPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== faqBundleSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}

/** Gun path for the whole signed, cacheable bundle every client subscribes to. */
export function faqBundlePath(): string[] {
  return ['techsupport-faq', 'bundle'];
}

/** Gun path for one published entry (per-key read model, keyed by questionKey). */
export function faqEntryPath(questionKey: string): string[] {
  return ['techsupport-faq', questionKey];
}
