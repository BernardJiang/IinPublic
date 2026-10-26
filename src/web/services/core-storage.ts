/**
 * App data that lived under its own localStorage key, kept in the device core instead (OPEN-91):
 * one `appData` entry per key, its value the same string, behind the `Storage` calls the code
 * already makes (`appStorage.getItem('peerNameCache')`).
 *
 * The app never writes these keys to localStorage any more, so a value found there is newer than
 * the core's: left by an earlier version of the app, or seeded by a test. A read takes it into the
 * core and removes it from localStorage.
 */
import { appDataView, settingsView } from './core-views';

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

/**
 * Settings and UI state (language, colour scheme, tabs, sorts, travel mode, last room …) live in
 * the device core's `settings` collection; localStorage keeps a copy for the reads made while the
 * app starts, before the core has loaded. Before it loads a read uses that copy; after, the
 * core's value — and a copy that differs is newer (an earlier app version, a test seed) and is
 * taken in. Writes go to both.
 */
export const settingsStorage = {
  getItem(key: string): string | null {
    const legacy = legacyStorage();
    const copy = legacy?.getItem(key) ?? null;
    if (!settingsView.isConnected()) return copy ?? (settingsView.get(key) ?? null);
    const value = settingsView.get(key);
    if (copy !== null && copy !== value) {
      settingsView.set({ [key]: copy });
      return copy;
    }
    if (typeof value === 'string' && copy === null) {
      try { legacy?.setItem(key, value); } catch { /* the core holds it either way */ }
    }
    return typeof value === 'string' ? value : null;
  },

  setItem(key: string, value: string): void {
    settingsView.set({ [key]: String(value) });
    try { legacyStorage()?.setItem(key, String(value)); } catch { /* the core holds it either way */ }
  },

  removeItem(key: string): void {
    settingsView.remove([key]);
    try { legacyStorage()?.removeItem(key); } catch { /* nothing to clear */ }
  },
};

/** For code that takes a `Storage` (distance units, list pins, …). */
export const settingsStorageAsStorage = settingsStorage as unknown as Storage;

