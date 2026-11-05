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

export class CollectionStore {
  constructor(private readonly store: GraphStore) {}

  async all(name: string): Promise<Record<string, unknown>> {
    assertCollection(name);
    // A collection never written has no node, and reading a missing node waits out storage's
    // not-found grace period — with ~16 mostly empty collections that held every boot by 1.5 s or
    // more under load (e2e stage2/95, stage2/37). Their parent lists every collection ever written
    // (and exists once one was), so one read of it answers for all the empty ones.
    if (!(await this.store.childKeys(COLLECTIONS_PATH)).includes(name)) return {};
    const buckets = (await this.store.childKeys(collectionPath(name))).filter(isBucket);
    const paths = (await Promise.all(buckets.map(async (bucket) =>
      (await this.store.childKeys(`${collectionPath(name)}/${bucket}`)).map((encoded) => `${collectionPath(name)}/${bucket}/${encoded}`)))).flat();
    const entries = await Promise.all(paths.map(async (path) => {
      const node = await this.store.get(path);
      if (!node || typeof node.json !== 'string' || typeof node.key !== 'string') return null;
      try {
        return [node.key, JSON.parse(node.json)] as const;
      } catch {
        return null;
      }
    }));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, unknown] => !!entry));
  }

  /** One entry, or undefined. */
  async get(name: string, key: string): Promise<unknown> {
    assertCollection(name);
    const node = await this.store.get(entryPath(name as CoreCollection, key));
    if (!node || typeof node.json !== 'string') return undefined;
    try { return JSON.parse(node.json); } catch { return undefined; }
  }

  /** Writes each entry whole; the caller has already merged it with what it replaces. */
  async upsert(name: string, entries: Record<string, unknown>): Promise<number> {
    assertCollection(name);
    await Promise.all(Object.entries(entries).map(([key, value]) => this.store.put(entryPath(name, key), { key, json: JSON.stringify(value) })));
    return Object.keys(entries).length;
  }

  async remove(name: string, keys: string[]): Promise<number> {
    assertCollection(name);
    await Promise.all(keys.map((key) => this.store.put(entryPath(name, key), null)));
    return keys.length;
  }

  /**
   * Erase every entry of the retired collections, and every entry of a live collection still in
   * the layout before buckets (owner decision 2026-11-04: erased, not moved); returns how many.
   */
  async eraseRetired(): Promise<number> {
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
