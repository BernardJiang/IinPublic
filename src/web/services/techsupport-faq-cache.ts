import { verifyFaqBundle, faqBundlePath, type SignedFaqBundle } from '../../shared/techsupport-faq-bundle';
import type { SupportFaqEntry } from '../../shared/techsupport-faq';
import { verifyFaqEntry, isFaqEntryRollback, type SignedFaqEntry } from '../../shared/techsupport-faq-entry';
import { fetchGrantFromCache, fetchGrantLive } from './techsupport-delegate-cache';
import { readCachedRecoveryAnchor } from './techsupport-recovery-cache';
import techsupportFaqSeedBundle from '../../shared/techsupport-faq-seed.signed.json';

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

/** Verifies + caches one raw bundle record, regardless of source (a live Gun `.on()` push or an
 * HTTP relay fetch — see `fetchFaqBundleFromServer`). Returns null and leaves the cache untouched
 * on any malformed/untrusted input (K2-3 discipline). */
export async function applyRawFaqBundle(
  gun: { get: (key: string) => any },
  data: unknown,
): Promise<SignedFaqBundle | null> {
  // Live Gun lookup (not the local grant cache — this may be the first time this bundle version
  // has been seen, so a delegate's grant may not be cached yet) — docs/TODO.md K7. `recovery`
  // (docs/TODO.md OPEN-29) is the local cache, not a live read — this is a hot path called on
  // every incoming message/subscription tick, and the recovery record's own subscription already
  // keeps that cache fresh independently.
  const verified = await verifyFaqBundle(faqBundleFromGunWire(data), {
    fetchGrant: (delegatePub) => fetchGrantLive(gun, delegatePub),
    recovery: readCachedRecoveryAnchor(),
  });
  if (!verified) return null;
  writeCachedFaqBundle(verified);
  return verified;
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
    const verified = await applyRawFaqBundle(gun, data);
    if (!verified) return;
    onVerified?.(verified);
  };
  ref.on(handler);
  return () => ref.off();
}

let verifiedSeedFaqBundle: SignedFaqBundle | null | undefined; // undefined = not checked yet

/**
 * The curated starter FAQ (docs/TODO.md K5, `techsupport-faq-seed.ts`), verified once and
 * memoized. Compiled straight into the client bundle — unlike `readCachedFaqBundle`, this never
 * touches Gun or localStorage, so it is available even on a brand-new device that has never
 * synced anything and even if the TechSupport device has never come online. Verification still
 * runs (never trust a compiled JSON file blindly) so a corrupted build artifact fails closed
 * exactly like any other untrusted input.
 */
export async function readSeedFaqBundle(): Promise<SignedFaqBundle | null> {
  if (verifiedSeedFaqBundle !== undefined) return verifiedSeedFaqBundle;
  // docs/TODO.md OPEN-29: passes today's cached recovery record so a seed signed by a
  // since-revoked DM key is rejected. Caveat: this result is memoized on first read — if a
  // recovery revocation of the seed's signer arrives LATER in the same session, the seed does
  // not retroactively stop being trusted until reload. Acceptable for v1: the seed is low-stakes
  // static help text, not live operational content, and the live FAQ bundle path above re-checks
  // recovery on every update.
  verifiedSeedFaqBundle = await verifyFaqBundle(techsupportFaqSeedBundle, { recovery: readCachedRecoveryAnchor() });
  return verifiedSeedFaqBundle;
}

/**
 * docs/TODO.md K7 follow-on: a native (embedded-node) device has no generic Gun peering to the
 * hub, so `subscribeToFaqBundle`'s live `.on()` subscription never fires there — an asker on a
 * real phone would never receive a delegate's published answer (or, more fundamentally, any FAQ
 * auto-answer at all). Read-side relay fetch: GET the bundle the hub actually holds and verify.
 */
export async function fetchFaqBundleFromServer(
  apiBase: string,
  gun: { get: (key: string) => any },
): Promise<SignedFaqBundle | null> {
  try {
    const res = await fetch(`${apiBase}/api/support/faq-bundle`);
    if (!res.ok) return null;
    const body = (await res.json()) as { bundle?: unknown };
    if (!body.bundle) return null;
    return await applyRawFaqBundle(gun, body.bundle);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Per-entry cache (docs/TODO.md OPEN-31)
//
// The live FAQ is no longer one whole-history bundle: a client fetches only the signed record its
// own question hashes to, and caches only records it has actually looked up. The cache is
// therefore proportional to what THIS device asked, never to the global FAQ — and is additionally
// hard-capped (least-recently-cached first) so it can never grow into the localStorage quota that
// broke a real session with the old bundle cache.
// ---------------------------------------------------------------------------------------------

const FAQ_ENTRIES_STORAGE_KEY = 'iinpublic_techsupport_faq_entries_v1';
export const FAQ_ENTRY_CACHE_MAX = 100;

/**
 * Grant lookup for a delegate-signed entry: the local verified-grant cache first (kept fresh by
 * the relay poll, and the only source that works on a native embedded node with no live Gun
 * peering to the hub), then a live Gun read for a grant published moments ago.
 */
function grantCacheThenLive(gun: { get: (key: string) => any }) {
  return async (delegatePub: string): Promise<unknown> =>
    (await fetchGrantFromCache(delegatePub)) ?? (await fetchGrantLive(gun, delegatePub));
}

type CachedFaqEntryRecord = { entry: SignedFaqEntry; cachedAt: number };

function readFaqEntryCacheMap(): Record<string, CachedFaqEntryRecord> {
  try {
    const raw = localStorage.getItem(FAQ_ENTRIES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeFaqEntryCacheMap(map: Record<string, CachedFaqEntryRecord>): void {
  const keys = Object.keys(map);
  if (keys.length > FAQ_ENTRY_CACHE_MAX) {
    keys
      .sort((a, b) => (map[a]?.cachedAt ?? 0) - (map[b]?.cachedAt ?? 0))
      .slice(0, keys.length - FAQ_ENTRY_CACHE_MAX)
      .forEach((key) => delete map[key]);
  }
  try {
    localStorage.setItem(FAQ_ENTRIES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage unavailable/full — the verified entry is still returned to the caller this session */
  }
}

/** The locally cached signed record for one question, or null. Re-verify before trusting for anything that renders. */
export function readCachedFaqEntry(questionKey: string): SignedFaqEntry | null {
  return readFaqEntryCacheMap()[questionKey]?.entry ?? null;
}

/** Verifies one raw record from any source; caches and returns it only if it verifies and is not older than what we already hold. */
export async function applyRawFaqEntry(
  gun: { get: (key: string) => any },
  data: unknown,
): Promise<SignedFaqEntry | null> {
  const verified = await verifyFaqEntry(data, {
    fetchGrant: grantCacheThenLive(gun),
    recovery: readCachedRecoveryAnchor(),
  });
  if (!verified) return null;
  const map = readFaqEntryCacheMap();
  const existing = map[verified.questionKey]?.entry;
  if (existing && isFaqEntryRollback(existing, verified)) return existing;
  map[verified.questionKey] = { entry: verified, cachedAt: Date.now() };
  writeFaqEntryCacheMap(map);
  return verified;
}

/**
 * One targeted read for one question. Never throws: on any network/verification failure it falls
 * back to whatever verified record this device already cached (so a known question still
 * auto-answers offline), or null when there is none.
 */
export async function fetchFaqEntryFromServer(
  apiBase: string,
  gun: { get: (key: string) => any },
  questionKey: string,
): Promise<SignedFaqEntry | null> {
  try {
    const res = await fetch(`${apiBase}/api/support/faq-entries/${encodeURIComponent(questionKey)}`);
    if (res.ok) {
      const body = (await res.json()) as { entry?: unknown };
      if (body.entry) {
        const applied = await applyRawFaqEntry(gun, body.entry);
        if (applied) return applied;
      }
    }
  } catch {
    /* fall through to the local cache */
  }
  return readCachedFaqEntry(questionKey);
}

/**
 * Newest-first, server-capped listing for the master's "Delegate activity" audit view. Verified
 * but deliberately NOT cached — an admin listing must not fill the same bounded cache askers use.
 */
export async function fetchRecentFaqEntriesFromServer(
  apiBase: string,
  gun: { get: (key: string) => any },
  limit = 100,
): Promise<SignedFaqEntry[]> {
  try {
    const res = await fetch(`${apiBase}/api/support/faq-entries?limit=${encodeURIComponent(String(limit))}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { entries?: unknown[] };
    const out: SignedFaqEntry[] = [];
    for (const raw of Array.isArray(body.entries) ? body.entries : []) {
      const verified = await verifyFaqEntry(raw, {
        fetchGrant: grantCacheThenLive(gun),
        recovery: readCachedRecoveryAnchor(),
      });
      if (verified) out.push(verified);
    }
    return out;
  } catch {
    return [];
  }
}
