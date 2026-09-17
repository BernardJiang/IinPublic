import {
  verifyDelegateGrant,
  delegateGrantPath,
  type TechSupportDelegateGrant,
} from '../../shared/techsupport-delegate';

/**
 * Local cache of signature-verified TechSupport delegate grants (docs/TODO.md K7).
 *
 * Mirrors `techsupport-faq-cache.ts`'s pattern exactly: only a grant that `verifyDelegateGrant`
 * accepted is ever cached, so every reader here can trust the *signature* without re-checking it
 * — but expiry/revocation are time-dependent, so callers still run `isValidDelegateGrant` at the
 * point of use rather than trusting cache freshness. Used both to let `ui-manager.ts` (which has
 * no live Gun handle) re-verify a delegate-authored message's authority at render time, and to
 * build the master's delegate roster / an ordinary user's own eligibility check.
 */

const DELEGATE_GRANTS_STORAGE_KEY = 'iinpublic_techsupport_delegate_grants_v1';

function readAll(): Record<string, TechSupportDelegateGrant> {
  try {
    const raw = localStorage.getItem(DELEGATE_GRANTS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, TechSupportDelegateGrant>;
  } catch {
    return {};
  }
}

function writeAll(grants: Record<string, TechSupportDelegateGrant>): void {
  try {
    localStorage.setItem(DELEGATE_GRANTS_STORAGE_KEY, JSON.stringify(grants));
  } catch {
    /* localStorage unavailable/full — the in-memory subscription value still works this session */
  }
}

export function readCachedDelegateGrants(): TechSupportDelegateGrant[] {
  return Object.values(readAll());
}

export function readCachedDelegateGrant(delegatePub: string): TechSupportDelegateGrant | null {
  return readAll()[delegatePub] ?? null;
}

function writeCachedDelegateGrant(grant: TechSupportDelegateGrant): void {
  const all = readAll();
  all[grant.delegatePub] = grant;
  writeAll(all);
}

/** Verifies + caches one raw grant record, regardless of where it came from (a live Gun `.on()`
 * push or an HTTP relay fetch — see `fetchDelegateGrantsFromServer`). Returns null and leaves the
 * cache untouched on any malformed/untrusted input (K2-3 discipline). */
export async function applyRawDelegateGrant(data: unknown): Promise<TechSupportDelegateGrant | null> {
  const verified = await verifyDelegateGrant(data);
  if (!verified) return null;
  writeCachedDelegateGrant(verified);
  return verified;
}

/**
 * docs/TODO.md K7 follow-on: a native (embedded-node) device has no generic Gun peering to the
 * hub (embedded-node.ts dials it "for discovery only"), so `subscribeToDelegateGrants`'s live
 * `.on()` subscription never fires there — a real phone would never see it holds a grant, nor
 * would an asker ever be able to verify a delegate-signed answer. This is the read-side relay
 * fetch for both cases: GET the full roster the hub actually holds and verify+cache each one.
 */
export async function fetchDelegateGrantsFromServer(apiBase: string): Promise<TechSupportDelegateGrant[]> {
  try {
    const res = await fetch(`${apiBase}/api/support/delegate-grants`);
    if (!res.ok) return [];
    const body = (await res.json()) as { grants?: unknown[] };
    const verified = await Promise.all((body.grants || []).map((raw) => applyRawDelegateGrant(raw)));
    return verified.filter((grant): grant is TechSupportDelegateGrant => !!grant);
  } catch {
    return [];
  }
}

/** The `fetchGrant` callback shape `isTrustedTechSupportAuthorPub`/`verifyFaqBundle` expect, backed by the local cache. */
export async function fetchGrantFromCache(delegatePub: string): Promise<unknown> {
  return readCachedDelegateGrant(delegatePub);
}

/**
 * Subscribe to the public delegate-grant roster and cache each signature-verified update
 * (revocations/edits republish the same soul, so this naturally picks those up too). Malformed or
 * untrusted-key publishes are silently dropped (K2-3 discipline) — the previous good cache
 * survives. Returns an unsubscribe function.
 */
export function subscribeToDelegateGrants(
  gun: { get: (key: string) => any },
  onVerified?: (grant: TechSupportDelegateGrant) => void,
): () => void {
  const ref = gun.get(delegateGrantPath('')[0]).map();
  const handler = async (data: unknown, delegatePub: string) => {
    if (!delegatePub || delegatePub.startsWith('_')) return;
    const verified = await applyRawDelegateGrant(data);
    if (!verified) return;
    onVerified?.(verified);
  };
  ref.on(handler);
  return () => ref.off();
}

/** Live (uncached) single-grant fetch, for a trust decision that must not trust a stale cache — e.g. answering. */
export function fetchGrantLive(gun: { get: (key: string) => any }, delegatePub: string, timeoutMs = 800): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    let ref = gun.get(delegateGrantPath(delegatePub)[0]);
    for (const segment of delegateGrantPath(delegatePub).slice(1)) ref = ref.get(segment);
    ref.once((data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
