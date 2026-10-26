/**
 * Keyed collections in the device core (OPEN-91 P3): the logs that lived as one localStorage JSON
 * blob each, rewritten whole on every change, become one Gun node per entry under
 * `local/collections/<collection>/<key>`, which never leaves the device
 * (docs/design/data-sharing-privacy-rules.md). The GUI keeps an in-memory view of each
 * (src/web/services/core-collection-view.ts).
 */
import type { GraphStore } from './graph-store';

/** Every collection the core keeps. A name not listed is refused, so a typo cannot start a new log. */
export const CORE_COLLECTIONS = ['chatbotTemplates'] as const;
export type CoreCollection = typeof CORE_COLLECTIONS[number];

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
}
