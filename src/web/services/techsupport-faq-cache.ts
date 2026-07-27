import { verifyFaqBundle, faqBundlePath, type SignedFaqBundle } from '../../shared/techsupport-faq-bundle';
import type { SupportFaqEntry } from '../../shared/techsupport-faq';

/**
 * Local cache of the verified TechSupport FAQ bundle (docs/TODO.md K5, design note §Item 1a/2).
 *
 * The asker's own client auto-answers known questions locally, so it needs the signed bundle
 * cached even when the TechSupport device is offline. Only a bundle that `verifyFaqBundle`
 * accepted is ever written here — this module never caches unverified data.
 */

const FAQ_BUNDLE_STORAGE_KEY = 'iinpublic_techsupport_faq_bundle_v1';

/**
 * Gun cannot store a nested array as a plain field (CLAUDE.md: "Gun cannot store nested
 * arrays"). `SignedFaqBundle.entries` is exactly that, so the Gun-persisted record carries
 * `entriesJson` (a JSON string) instead — `faqBundleToGunWire`/`faqBundleFromGunWire` are the
 * one place that boundary is crossed. Everywhere else (the cache, `verifyFaqBundle`, the
 * localStorage-backed cache) works with the real typed `entries` array.
 */
type FaqBundleGunWire = {
  version: number;
  entriesJson: string;
  authorPub: string;
  bundleCid: string;
  signature: string;
};

export function faqBundleToGunWire(bundle: SignedFaqBundle): FaqBundleGunWire {
  return {
    version: bundle.version,
    entriesJson: JSON.stringify(bundle.entries),
    authorPub: bundle.authorPub,
    bundleCid: bundle.bundleCid,
    signature: bundle.signature,
  };
}

/** Reconstructs `entries` from `entriesJson`; passes non-wire shapes through unchanged so `verifyFaqBundle` still fails closed on genuinely malformed data rather than throwing here. */
export function faqBundleFromGunWire(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const candidate = raw as Partial<FaqBundleGunWire> & { entries?: unknown };
  if (typeof candidate.entriesJson !== 'string') return raw;
  let entries: unknown;
  try {
    entries = JSON.parse(candidate.entriesJson);
  } catch {
    return raw;
  }
  const { entriesJson: _entriesJson, ...rest } = candidate;
  return { ...rest, entries };
}

export function readCachedFaqBundle(): SignedFaqBundle | null {
  try {
    const raw = localStorage.getItem(FAQ_BUNDLE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SignedFaqBundle;
  } catch {
    return null;
  }
}

export function readCachedFaqEntries(): SupportFaqEntry[] {
  return readCachedFaqBundle()?.entries ?? [];
}

function writeCachedFaqBundle(bundle: SignedFaqBundle): void {
  try {
    localStorage.setItem(FAQ_BUNDLE_STORAGE_KEY, JSON.stringify(bundle));
  } catch {
    /* localStorage unavailable/full — the in-memory subscription value still works this session */
  }
}

/**
 * Subscribe to the public, signed FAQ bundle path and cache each verified update. Malformed or
 * untrusted-key publishes are silently dropped (K2-3 discipline) — the previous good cache
 * survives. Returns an unsubscribe function.
 */
export function subscribeToFaqBundle(
  gun: { get: (key: string) => any },
  onVerified?: (bundle: SignedFaqBundle) => void,
): () => void {
  let ref = gun.get(faqBundlePath()[0]);
  for (const segment of faqBundlePath().slice(1)) ref = ref.get(segment);
  const handler = async (data: unknown) => {
    const verified = await verifyFaqBundle(faqBundleFromGunWire(data));
    if (!verified) return;
    writeCachedFaqBundle(verified);
    onVerified?.(verified);
  };
  ref.on(handler);
  return () => ref.off();
}
