/**
 * Keyed collections in the device core (OPEN-91 P3): the logs that lived as one localStorage JSON
 * blob each, rewritten whole on every change, become one Gun node per entry under
 * `local/collections/<collection>/<key>`, which never leaves the device
 * (docs/design/data-sharing-privacy-rules.md). The GUI keeps an in-memory view of each
 * (src/web/services/core-collection-view.ts).
 */
import type { GraphStore } from './graph-store';
import { keyBucket } from './device-graph/keyed-buckets';

/** Every collection the core keeps. A name not listed is refused, so a typo cannot start a new log. */
export const CORE_COLLECTIONS = [
  'chatbotTemplates', 'myTalks', 'myConversations',
  'dealTalkByConversation', 'needKeyByConversation',
  'tagOppositePairRegistry',
  'appData', 'settings',
] as const;
export type CoreCollection = typeof CORE_COLLECTIONS[number];

/**
 * Collections no longer kept, replaced by the device graph: the old chatbot's copies of my answers
 * (OPEN-106 step 2e v), the talk ledger and the revisions sent (step 3, `exchanged.ts`), and
 * "already answered" by content (derived from My Talks, `answered-talks.ts`), and the Me tab's
 * answer history (read from the graph, `answer-history-storage.ts`).
 * Erased, not migrated (owner decision); only `eraseRetired` touches them.
 */
export const RETIRED_COLLECTIONS = [
  'answerPreferences', 'flattenedAnswerPreferences', 'questionDefaultContracts',
  'myQuestionAnswers', 'exactChatbotMemory', 'typedPreferenceState',
  'talkLedger', 'talkRevisionSent', 'answeredTalkByContent', 'myAnswerHistory',
] as const;

export const COLLECTIONS_PATH = 'local/collections';

function assertCollection(name: string): asserts name is CoreCollection {
  if (!(CORE_COLLECTIONS as readonly string[]).includes(name)) throw new Error(`Unknown core collection: ${name}`);
}

const collectionPath = (name: CoreCollection): string => `${COLLECTIONS_PATH}/${name}`;
/**
 * Entries are spread over 16 bucket nodes (`bucket-<hex>`, by a hash of the key), so no node lists
 * more than a few thousand links: Gun answers a node larger than one Radisk file (about 7,000
 * links) in parts (spec §31.8, OPEN-106). Keys are app ids (Talk ids, conversation ids), encoded so
 * a `/` cannot split the path.
 */
const BUCKET_PREFIX = 'bucket-';
const isBucket = (segment: string) => /^bucket-[0-9a-f]$/.test(segment);
const bucketOf = (key: string): string => `${BUCKET_PREFIX}${keyBucket(key)}`;
const entryPath = (name: CoreCollection, key: string): string => `${collectionPath(name)}/${bucketOf(key)}/${encodeURIComponent(key)}`;

/**
 * Each collection's entries as stored (key → JSON), kept once read: the core is the only writer of
 * its collections (one owner per device: the worker or the node), so every write passes here and
 * the copy stays true. Reading a bucketed collection takes two rounds of reads, and screens read
 * My Talks often (the answer dialog's lookups), so they are read once. Keyed by the store, so every
 * `CollectionStore` over it shares one copy.
 */
type CachedCollection = { ready: Promise<void>; entries: Map<string, string> };
const caches = new WeakMap<GraphStore, Map<string, CachedCollection>>();

export class CollectionStore {
  constructor(private readonly store: GraphStore) {}

  private cacheOf(): Map<string, CachedCollection> {
    let cache = caches.get(this.store);
    if (!cache) { cache = new Map(); caches.set(this.store, cache); }
    return cache;
  }

  private async loaded(name: CoreCollection): Promise<Map<string, string>> {
    const cache = this.cacheOf();
    let state = cache.get(name);
    if (!state) {
      const entries = new Map<string, string>();
      state = { entries, ready: this.read(name).then((read) => { for (const [key, json] of read) entries.set(key, json); }) };
      cache.set(name, state);
      state.ready.catch(() => { if (cache.get(name) === state) cache.delete(name); });
    }
    await state.ready;
    return state.entries;
  }

  /** A write went to storage: the copy follows (after its first read, if one is under way). */
  private async noted(name: CoreCollection, changes: Array<[string, string | null]>): Promise<void> {
    const state = this.cacheOf().get(name);
    if (!state) return;
    await state.ready.catch(() => undefined);
    for (const [key, json] of changes) {
      if (json === null) state.entries.delete(key);
      else state.entries.set(key, json);
    }
  }

  async all(name: string): Promise<Record<string, unknown>> {
    assertCollection(name);
    const out: Record<string, unknown> = {};
    for (const [key, json] of await this.loaded(name)) {
      try { out[key] = JSON.parse(json); } catch { /* an unreadable entry is left out */ }
    }
    return out;
  }

  private async read(name: CoreCollection): Promise<Array<[string, string]>> {
    // A collection never written has no node, and reading a missing node waits out storage's
    // not-found grace period — with ~16 mostly empty collections that held every boot by 1.5 s or
    // more under load (e2e stage2/95, stage2/37). Their parent lists every collection ever written
    // (and exists once one was), so one read of it answers for all the empty ones.
    if (!(await this.store.childKeys(COLLECTIONS_PATH)).includes(name)) return [];
    const buckets = (await this.store.childKeys(collectionPath(name))).filter(isBucket);
    const paths = (await Promise.all(buckets.map(async (bucket) =>
      (await this.store.childKeys(`${collectionPath(name)}/${bucket}`)).map((encoded) => `${collectionPath(name)}/${bucket}/${encoded}`)))).flat();
    const entries = await Promise.all(paths.map(async (path) => {
      const node = await this.store.get(path);
      return node && typeof node.json === 'string' && typeof node.key === 'string' ? [node.key, node.json] as [string, string] : null;
    }));
    return entries.filter((entry): entry is [string, string] => !!entry);
  }

  /** One entry, or undefined. */
  async get(name: string, key: string): Promise<unknown> {
    assertCollection(name);
    const cached = this.cacheOf().get(name);
    let json: string | undefined;
    if (cached) {
      await cached.ready.catch(() => undefined);
      json = cached.entries.get(key);
    } else {
      const node = await this.store.get(entryPath(name as CoreCollection, key));
      json = typeof node?.json === 'string' ? node.json : undefined;
    }
    if (json === undefined) return undefined;
    try { return JSON.parse(json); } catch { return undefined; }
  }

  /** Writes each entry whole; the caller has already merged it with what it replaces. */
  async upsert(name: string, entries: Record<string, unknown>): Promise<number> {
    assertCollection(name);
    const changes = Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)] as [string, string]);
    await Promise.all(changes.map(([key, json]) => this.store.put(entryPath(name, key), { key, json })));
    await this.noted(name, changes);
    return changes.length;
  }

  async remove(name: string, keys: string[]): Promise<number> {
    assertCollection(name);
    await Promise.all(keys.map((key) => this.store.put(entryPath(name, key), null)));
    await this.noted(name, keys.map((key) => [key, null]));
    return keys.length;
  }

  /**
   * Erase every entry of the retired collections, and every entry of a live collection still in
   * the layout before buckets (owner decision 2026-11-04: erased, not moved); returns how many.
   */
  async eraseRetired(): Promise<number> {
    // Only entries no read ever returned are erased, so the copies stay true; read again anyway.
    caches.delete(this.store);
    const written = await this.store.childKeys(COLLECTIONS_PATH);
    let erased = 0;
    for (const name of CORE_COLLECTIONS) {
      if (!written.includes(name)) continue;
      const flat = (await this.store.childKeys(collectionPath(name))).filter((segment) => !isBucket(segment));
      await Promise.all(flat.map((encoded) => this.store.put(`${collectionPath(name)}/${encoded}`, null)));
      erased += flat.length;
    }
    for (const name of RETIRED_COLLECTIONS) {
      if (!written.includes(name)) continue;
      const path = `${COLLECTIONS_PATH}/${name}`;
      const keys = await this.store.childKeys(path);
      await Promise.all(keys.map((encoded) => this.store.put(`${path}/${encoded}`, null)));
      erased += keys.length;
    }
    return erased;
  }
}
