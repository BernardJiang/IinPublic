import {
  RECOVERY_ANCHOR_HISTORY_ROOT,
  isRecoveryAnchorRollback,
  verifyRecoveryAnchor,
  recoveryAnchorPath,
  type RecoveryAnchorRecord,
} from '../../shared/techsupport-recovery';

/**
 * Local cache of the verified TechSupport recovery anchor record (docs/TODO.md OPEN-29).
 *
 * Mirrors `techsupport-faq-cache.ts` / `techsupport-delegate-cache.ts` exactly: only a record
 * `verifyRecoveryAnchor` accepted is ever cached, so every reader here can trust the signature
 * without re-checking it. Unlike those two caches, there is only ever ONE global record (not one
 * per FAQ question or per delegate) — this file's whole job is keeping that single record fresh
 * and monotonic (`reconcileVerifiedRecoveryAnchor`) so a stale/replayed older record can never
 * roll local trust backward.
 */

const RECOVERY_ANCHOR_STORAGE_KEY = 'iinpublic_techsupport_recovery_anchor_v1';

export function readCachedRecoveryAnchor(): RecoveryAnchorRecord | null {
  try {
    const raw = localStorage.getItem(RECOVERY_ANCHOR_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RecoveryAnchorRecord;
  } catch {
    return null;
  }
}

function writeCachedRecoveryAnchor(record: RecoveryAnchorRecord): void {
  try {
    localStorage.setItem(RECOVERY_ANCHOR_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* localStorage unavailable/full — the in-memory subscription value still works this session */
  }
}

/** Reconcile a signature-verified record with this installation's monotonic local knowledge. */
export function reconcileVerifiedRecoveryAnchor(verified: RecoveryAnchorRecord): RecoveryAnchorRecord {
  const current = readCachedRecoveryAnchor();
  if (current && isRecoveryAnchorRollback(current, verified)) return current;
  writeCachedRecoveryAnchor(verified);
  return verified;
}

/** Verifies + reconciles one raw record, regardless of source (a live Gun `.on()` push or an
 * HTTP relay fetch). Returns null and leaves the cache untouched on any malformed/untrusted/
 * rollback input (K2-3 discipline). */
export async function applyRawRecoveryAnchor(data: unknown): Promise<RecoveryAnchorRecord | null> {
  const verified = await verifyRecoveryAnchor(data);
  if (!verified) return null;
  return reconcileVerifiedRecoveryAnchor(verified);
}

/**
 * Subscribe to the public recovery anchor's current slot AND its append-only history root —
 * same reasoning as the delegate-grant hardening (OPEN-27): a stale/withheld mutable "current"
 * slot must not be able to hide that a newer record exists. Malformed/untrusted/rollback
 * publishes are silently dropped — the previous good cache survives. Returns an unsubscribe fn.
 */
export function subscribeToRecoveryAnchor(
  gun: { get: (key: string) => any },
  onVerified?: (record: RecoveryAnchorRecord) => void,
): () => void {
  let currentRef = gun.get(recoveryAnchorPath()[0]);
  for (const segment of recoveryAnchorPath().slice(1)) currentRef = currentRef.get(segment);
  const historyRef = gun.get(RECOVERY_ANCHOR_HISTORY_ROOT).map();

  const handler = async (data: unknown) => {
    const verified = await applyRawRecoveryAnchor(data);
    if (!verified) return;
    onVerified?.(verified);
  };
  const historyHandler = async (data: unknown, recordKey: string) => {
    if (!recordKey || recordKey.startsWith('_')) return;
    await handler(data);
  };
  currentRef.on(handler);
  historyRef.on(historyHandler);
  return () => {
    currentRef.off();
    historyRef.off();
  };
}

/**
 * docs/TODO.md OPEN-29 (K7-follow-on pattern): a native (embedded-node) device has no generic
 * Gun peering to the hub, so the live `.on()` subscription above never fires there — the read-
 * side relay fetch, same shape as `fetchDelegateGrantsFromServer`/`fetchFaqBundleFromServer`.
 */
export async function fetchRecoveryAnchorFromServer(apiBase: string): Promise<RecoveryAnchorRecord | null> {
  try {
    const res = await fetch(`${apiBase}/api/support/recovery`);
    if (!res.ok) return null;
    const body = (await res.json()) as { current?: unknown; history?: unknown[] };
    let latest: RecoveryAnchorRecord | null = null;
    for (const raw of [...(body.current ? [body.current] : []), ...(body.history || [])]) {
      const applied = await applyRawRecoveryAnchor(raw);
      if (applied) latest = applied;
    }
    return latest;
  } catch {
    return null;
  }
}
