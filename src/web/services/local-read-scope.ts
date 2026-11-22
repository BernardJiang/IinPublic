/**
 * localStorage reads shared within one synchronous draw (C10, 2026-11-22: every translated string
 * on a Talks redraw read the language from localStorage, and every collection read checked for an
 * old-style blob there, a few hundred slow WebView storage reads per redraw). Outside a scope a read
 * goes to localStorage as before, so a value a test or an earlier version left is still taken in
 * at once. Any write through the app's storage code clears what the scope has read.
 */
let reads: Map<string, string | null> | null = null;

/** `localStorage.getItem(key)`, once per key within a scope; null when storage is unavailable. */
export function readLocal(key: string): string | null {
  if (reads?.has(key)) return reads.get(key)!;
  let value: string | null = null;
  try {
    value = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    value = null;
  }
  reads?.set(key, value);
  return value;
}

/** Called after a localStorage write or removal: later reads in the scope go to storage again. */
export function forgetLocalReads(): void {
  reads?.clear();
}

/** Runs `draw` with localStorage reads shared; nested scopes join the outer one. */
export function withLocalReadScope<T>(draw: () => T): T {
  if (reads) return draw();
  reads = new Map();
  try {
    return draw();
  } finally {
    reads = null;
  }
}
