/**
 * The GUI's in-memory view of the exchange log (OPEN-88 part 2, OPEN-91 P1). The log itself lives
 * in the device core's Gun (`local/exchanges`, src/core/exchanges.ts); screens read this view
 * synchronously, so a slow database never holds up a render (docs/design/device-core-architecture.md).
 *
 * - A write updates the view at once and goes to the core.
 * - At start-up the view loads the core's snapshot.
 * - An old-style localStorage blob (`localTalkExchanges`: earlier versions of the app, and test
 *   seeds) is imported into the view and the core the moment it is seen, then removed.
 * - A write is not safe until the core confirms it is stored: closing or reloading the page right
 *   after one can stop the worker mid-save (found by e2e stage1/94). Until then the record waits in
 *   a small localStorage list of unsaved writes, sent again at the next start.
 */
import { exchangeKey, type ExchangeRecord } from '../../core/exchanges';

export type ExchangeCoreLink = {
  snapshot(): Promise<ExchangeRecord[]>;
  upsert(records: ExchangeRecord[]): Promise<unknown>;
  removePeers(peerIds: string[]): Promise<unknown>;
};

const LEGACY_KEY = 'localTalkExchanges';
const UNSAVED_KEY = 'iinpublic_exchanges_unsaved_v1';
const records = new Map<string, ExchangeRecord>();
const listeners = new Set<() => void>();
let core: ExchangeCoreLink | null = null;

const time = (record: ExchangeRecord | undefined): number => Date.parse(String(record?.date || '')) || 0;

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A screen's refresh failing must not stop the others.
    }
  }
}

function readUnsaved(): Record<string, ExchangeRecord> {
  try {
    const parsed = JSON.parse((typeof localStorage === 'undefined' ? null : localStorage.getItem(UNSAVED_KEY)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeUnsaved(unsaved: Record<string, ExchangeRecord>): void {
  try {
    if (Object.keys(unsaved).length === 0) localStorage.removeItem(UNSAVED_KEY);
    else localStorage.setItem(UNSAVED_KEY, JSON.stringify(unsaved));
  } catch {
    // Storage unavailable: the write still goes to the core; only its crash safety is lost.
  }
}

/** Sends records to the core, keeping each in the unsaved list until the core has stored it. */
function save(batch: ExchangeRecord[]): void {
  if (batch.length === 0) return;
  const unsaved = readUnsaved();
  for (const record of batch) unsaved[exchangeKey(record)] = record;
  writeUnsaved(unsaved);
  if (!core) return;
  core.upsert(batch).then(() => {
    const still = readUnsaved();
    for (const record of batch) {
      const key = exchangeKey(record);
      // Only if it was not changed again meanwhile; a newer write keeps its own place in the list.
      if (JSON.stringify(still[key]) === JSON.stringify(record)) delete still[key];
    }
    writeUnsaved(still);
  }).catch((error) => console.warn('[exchanges] core write failed (kept as unsaved):', error));
}

function send(write: (link: ExchangeCoreLink) => Promise<unknown>): void {
  if (!core) return;
  write(core).catch((error) => console.warn('[exchanges] core write failed (kept in the view):', error));
}

/** Imports an old-style localStorage blob, if one is present, and removes it. */
function importLegacy(): void {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage gone mid-way: the parsed copy below still lands in the view and the core.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
  const imported: ExchangeRecord[] = [];
  for (const value of values as ExchangeRecord[]) {
    if (!value?.peerId || !value?.talkId) continue;
    const record = { ...value, direction: value.direction || 'sent' } as ExchangeRecord;
    const key = exchangeKey(record);
    const merged = { ...(records.get(key) ?? {}), ...record };
    records.set(key, merged);
    imported.push(merged);
  }
  if (imported.length === 0) return;
  save(imported);
  notify();
}

/** Every exchange, for screens and logic that read synchronously. */
export function readExchanges(): ExchangeRecord[] {
  importLegacy();
  return [...records.values()];
}

/** Records one exchange, merged over what this person, Talk and direction already had. */
export function upsertExchange(record: ExchangeRecord): ExchangeRecord {
  importLegacy();
  const key = exchangeKey(record);
  const merged = { ...(records.get(key) ?? {}), ...record } as ExchangeRecord;
  records.set(key, merged);
  save([merged]);
  notify();
  return merged;
}

/** Forgets everything exchanged with these people (the Contacts cap's prune). */
export function removeExchangePeers(peerIds: string[]): void {
  if (peerIds.length === 0) return;
  importLegacy();
  const drop = new Set(peerIds);
  for (const [key, record] of records) if (drop.has(record.peerId)) records.delete(key);
  const unsaved = readUnsaved();
  for (const [key, record] of Object.entries(unsaved)) if (drop.has(record.peerId)) delete unsaved[key];
  writeUnsaved(unsaved);
  send((link) => link.removePeers(peerIds));
  notify();
}

/** Called when the exchanges change (a load, an import, a write). Returns the unsubscribe. */
export function onExchangesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Connects the view to the device core and loads its snapshot. The newer copy of each record wins;
 * records only the view has (written or imported before the core was ready) go to the core.
 */
export async function connectExchangeCore(link: ExchangeCoreLink): Promise<void> {
  core = link;
  importLegacy();
  // Writes the core had not confirmed when the page last closed.
  for (const [key, record] of Object.entries(readUnsaved())) {
    const mine = records.get(key);
    if (!mine || time(record) >= time(mine)) records.set(key, record);
  }
  const snapshot = await link.snapshot();
  const fromCore = new Set<string>();
  for (const record of snapshot) {
    const key = exchangeKey(record);
    fromCore.add(key);
    const mine = records.get(key);
    if (!mine || time(record) >= time(mine)) records.set(key, record);
  }
  const unsavedKeys = new Set(Object.keys(readUnsaved()));
  const toSave = [...records.entries()].filter(([key]) => !fromCore.has(key) || unsavedKeys.has(key)).map(([, record]) => record);
  save(toSave);
  notify();
}

/** Jest shares modules between tests: each test starts from an empty, unconnected view. */
export function resetExchangeViewForTests(): void {
  records.clear();
  listeners.clear();
  core = null;
}

/**
 * Tests and diagnostics read the log from the page: `window.__iinpublic_exchanges()` returns it in
 * the old blob's shape, `{ "<peer>::<talk>::<direction>": record }`.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __iinpublic_exchanges?: () => Record<string, ExchangeRecord> }).__iinpublic_exchanges = () =>
    Object.fromEntries(readExchanges().map((record) => [exchangeKey(record), record]));
}
