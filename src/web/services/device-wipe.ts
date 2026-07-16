/**
 * Local device wipe engine for public-device exit (GUI redesign §11.1, item J).
 *
 * Destroys all device-local state so the next person on a public/library PC gets
 * a brand-new auto-created identity with none of the previous person's data
 * reachable. Verifiable post-reload: localStorage/IndexedDB empty, new pub.
 *
 * Key custody (the SEA keypair) lives in localStorage under the custody record,
 * so clearing localStorage destroys it; IndexedDB/Gun radata and caches are
 * cleared too. The caller reloads to a fresh boot afterwards.
 */

export interface EraseHooks {
  /** Best-effort signed link revocations for any linked identities, while online. */
  revokeLinks?: () => Promise<void>;
  /** Persist a "retired" marker for this identity, while online. */
  markRetired?: () => Promise<void>;
  /** Reload to a fresh boot (defaults to location.reload). */
  reload?: () => void;
}

/** Clear every device storage surface. Resolves once best-effort clearing is done. */
export async function eraseDeviceStorage(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  // IndexedDB (Gun radata and any app DBs).
  try {
    const idb = globalThis.indexedDB;
    if (idb) {
      const names: string[] = [];
      if (typeof (idb as any).databases === 'function') {
        const dbs = await (idb as any).databases();
        for (const d of dbs || []) if (d?.name) names.push(d.name);
      }
      // Known fixed names as a fallback when databases() is unavailable.
      for (const n of ['radata', 'gun', 'iinpublic']) if (!names.includes(n)) names.push(n);
      await Promise.all(
        names.map(
          (name) =>
            new Promise<void>((resolve) => {
              try {
                const req = idb.deleteDatabase(name);
                req.onsuccess = req.onerror = (req as any).onblocked = () => resolve();
              } catch {
                resolve();
              }
            }),
        ),
      );
    }
  } catch {
    /* ignore */
  }
  // Cache Storage.
  try {
    const cs = (globalThis as any).caches;
    if (cs?.keys) {
      const keys = await cs.keys();
      await Promise.all(keys.map((k: string) => cs.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Full erase: best-effort revocations + retired marker while still online, then
 * wipe storage and reload to a fresh boot.
 */
export async function eraseDevice(hooks: EraseHooks = {}): Promise<void> {
  try {
    await hooks.revokeLinks?.();
  } catch {
    /* best effort */
  }
  try {
    await hooks.markRetired?.();
  } catch {
    /* best effort */
  }
  await eraseDeviceStorage();
  const reload = hooks.reload ?? (() => window.location.reload());
  reload();
}

/** True when the primary storage surfaces are empty of prior identity data. */
export function isDeviceStorageWiped(): boolean {
  try {
    return localStorage.length === 0;
  } catch {
    return false;
  }
}
