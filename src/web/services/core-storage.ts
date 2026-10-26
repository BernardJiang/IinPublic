/**
 * App data that lived under its own localStorage key, kept in the device core instead (OPEN-91):
 * one `appData` entry per key, its value the same string, behind the `Storage` calls the code
 * already makes (`appStorage.getItem('peerNameCache')`).
 *
 * The app never writes these keys to localStorage any more, so a value found there is newer than
 * the core's: left by an earlier version of the app, or seeded by a test. A read takes it into the
 * core and removes it from localStorage.
 */
import { appDataView } from './core-views';

function legacyStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const warnedEarly = new Set<string>();

export const appStorage = {
  getItem(key: string): string | null {
    const legacy = legacyStorage();
    const found = legacy?.getItem(key) ?? null;
    if (found !== null) {
      appDataView.set({ [key]: found });
      try { legacy!.removeItem(key); } catch { /* the core holds it now either way */ }
      return found;
    }
    if (!appDataView.isConnected() && !warnedEarly.has(key)) {
      // Before the core loads, only values not yet saved to it are here: a value from an earlier
      // session reads as missing. Boot-time reads belong after connectExchangeLog.
      warnedEarly.add(key);
      console.warn(`[appStorage] "${key}" read before the device core loaded`);
    }
    const value = appDataView.get(key);
    return typeof value === 'string' ? value : null;
  },

  setItem(key: string, value: string): void {
    appDataView.set({ [key]: String(value) });
    try { legacyStorage()?.removeItem(key); } catch { /* nothing to clear */ }
  },

  removeItem(key: string): void {
    appDataView.remove([key]);
    try { legacyStorage()?.removeItem(key); } catch { /* nothing to clear */ }
  },
};

/** For code that takes a `Storage` (device sync's custody and outbox stores). */
export const appStorageAsStorage = appStorage as unknown as Storage;

/** Whether the core has loaded app data: before it, a value from an earlier session reads as missing. */
export function appDataLoaded(): boolean {
  return appDataView.isConnected();
}
