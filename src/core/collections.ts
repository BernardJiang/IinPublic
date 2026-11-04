/**
 * Keyed collections in the device core (OPEN-91 P3): the logs that lived as one localStorage JSON
 * blob each, rewritten whole on every change, become one Gun node per entry under
 * `local/collections/<collection>/<key>`, which never leaves the device
 * (docs/design/data-sharing-privacy-rules.md). The GUI keeps an in-memory view of each
 * (src/web/services/core-collection-view.ts).
 */
import type { GraphStore } from './graph-store';

/** Every collection the core keeps. A name not listed is refused, so a typo cannot start a new log. */
export const CORE_COLLECTIONS = [
  'chatbotTemplates', 'myTalks', 'myConversations', 'talkLedger', 'myAnswerHistory',
  'dealTalkByConversation', 'needKeyByConversation',
  'answeredTalkByContent', 'tagOppositePairRegistry',
  'talkRevisionSent', 'appData', 'settings',
] as const;
export type CoreCollection = typeof CORE_COLLECTIONS[number];

/**
 * Collections no longer kept: the old chatbot's copies of my answers, replaced by the device graph
 * (OPEN-106 step 2e v). Erased, not migrated (owner decision); only `eraseRetired` touches them.
 */
export const RETIRED_COLLECTIONS = [
  'answerPreferences', 'flattenedAnswerPreferences', 'questionDefaultContracts',
  'myQuestionAnswers', 'exactChatbotMemory', 'typedPreferenceState',
] as const;

export const COLLECTIONS_PATH = 'local/collections';

function assertCollection(name: string): asserts name is CoreCollection {
  if (!(CORE_COLLECTIONS as readonly string[]).includes(name)) throw new Error(`Unknown core collection: ${name}`);
}

const collectionPath = (name: CoreCollection): string => `${COLLECTIONS_PATH}/${name}`;
// Keys are app ids (Talk CIDs, conversation ids); encoded so a `/` cannot split the path.
const entryPath = (name: CoreCollection, key: string): string => `${collectionPath(name)}/${encodeURIComponent(key)}`;

export class CollectionStore {
  constructor(private readonly store: GraphStore) {}

  async all(name: string): Promise<Record<string, unknown>> {
    assertCollection(name);
    // A collection never written has no node, and reading a missing node waits out storage's
    // not-found grace period — with ~16 mostly empty collections that held every boot by 1.5 s or
    // more under load (e2e stage2/95, stage2/37). Their parent lists every collection ever written
    // (and exists once one was), so one read of it answers for all the empty ones.
    if (!(await this.store.childKeys(COLLECTIONS_PATH)).includes(name)) return {};
    const keys = await this.store.childKeys(collectionPath(name));
    const entries = await Promise.all(keys.map(async (encoded) => {
      const node = await this.store.get(`${collectionPath(name)}/${encoded}`);
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

  /** Erase every entry of the retired collections; returns how many there were. */
  async eraseRetired(): Promise<number> {
    const written = await this.store.childKeys(COLLECTIONS_PATH);
    let erased = 0;
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
