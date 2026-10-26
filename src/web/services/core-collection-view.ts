/**
 * The GUI's in-memory view of one device-core collection (OPEN-91 P3, src/core/collections.ts).
 * Screens read it synchronously; the collection itself lives in the core's Gun.
 *
 * - A change updates the view at once and goes to the core.
 * - At start-up the view loads the core's snapshot.
 * - The old localStorage blob (earlier app versions, test seeds) is imported the moment it is seen,
 *   then removed.
 * - A change is not safe until the core confirms it: a reload can stop the worker mid-save (e2e
 *   stage1/94). Until then it waits in a small localStorage list (a removal as `null`) and is sent
 *   again at the next start; while listed it wins over the core's copy.
 */
import type { CoreCollection } from '../../core/collections';

export type CollectionCoreLink = {
  snapshot(collection: CoreCollection): Promise<Record<string, unknown>>;
  upsert(collection: CoreCollection, entries: Record<string, unknown>): Promise<unknown>;
  remove(collection: CoreCollection, keys: string[]): Promise<unknown>;
};

export class CoreCollectionView<T> {
  private readonly entries = new Map<string, T>();
  private readonly listeners = new Set<() => void>();
  private core: CollectionCoreLink | null = null;
  private readonly unsavedKey: string;

  constructor(readonly collection: CoreCollection, private readonly legacyKey: string) {
    this.unsavedKey = `iinpublic_core_unsaved_${collection}_v1`;
  }

  get(key: string): T | undefined {
    this.importLegacy();
    return this.entries.get(key);
  }

  all(): Record<string, T> {
    this.importLegacy();
    return Object.fromEntries(this.entries);
  }

  set(changes: Record<string, T>): void {
    this.importLegacy();
    if (Object.keys(changes).length === 0) return;
    for (const [key, value] of Object.entries(changes)) this.entries.set(key, value);
    this.save(changes);
    this.notify();
  }

  remove(keys: string[]): void {
    this.importLegacy();
    if (keys.length === 0) return;
    for (const key of keys) this.entries.delete(key);
    this.save(Object.fromEntries(keys.map((key) => [key, null])));
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connects to the core and loads its snapshot; listed unsaved changes win and are sent again. */
  async connect(link: CollectionCoreLink): Promise<void> {
    this.core = link;
    this.importLegacy();
    const unsaved = this.readUnsaved();
    const snapshot = await link.snapshot(this.collection);
    for (const [key, value] of Object.entries(snapshot)) {
      if (!(key in unsaved) && !this.entries.has(key)) this.entries.set(key, value as T);
    }
    for (const [key, value] of Object.entries(unsaved)) {
      if (value === null) this.entries.delete(key);
      else this.entries.set(key, value);
    }
    this.save(unsaved);
    this.notify();
  }

  resetForTests(): void {
    this.entries.clear();
    this.listeners.clear();
    this.core = null;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A screen's refresh failing must not stop the others.
      }
    }
  }

  private readUnsaved(): Record<string, T | null> {
    try {
      const parsed = JSON.parse((typeof localStorage === 'undefined' ? null : localStorage.getItem(this.unsavedKey)) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeUnsaved(unsaved: Record<string, T | null>): void {
    try {
      if (Object.keys(unsaved).length === 0) localStorage.removeItem(this.unsavedKey);
      else localStorage.setItem(this.unsavedKey, JSON.stringify(unsaved));
    } catch {
      // Storage unavailable: the change still goes to the core; only its crash safety is lost.
    }
  }

  /** Sends changes (null = remove) to the core, listing each until the core has stored it. */
  private save(changes: Record<string, T | null>): void {
    if (Object.keys(changes).length === 0) return;
    this.writeUnsaved({ ...this.readUnsaved(), ...changes });
    if (!this.core) return;
    const upserts = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== null));
    const removals = Object.keys(changes).filter((key) => changes[key] === null);
    Promise.all([
      Object.keys(upserts).length ? this.core.upsert(this.collection, upserts) : null,
      removals.length ? this.core.remove(this.collection, removals) : null,
    ]).then(() => {
      const still = this.readUnsaved();
      // Only if not changed again meanwhile; a newer change keeps its own place in the list.
      for (const [key, value] of Object.entries(changes)) if (JSON.stringify(still[key]) === JSON.stringify(value)) delete still[key];
      this.writeUnsaved(still);
    }).catch((error) => console.warn(`[${this.collection}] core write failed (kept as unsaved):`, error));
  }

  private importLegacy(): void {
    let raw: string | null = null;
    try {
      raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(this.legacyKey);
    } catch {
      return;
    }
    if (raw === null) return;
    try {
      localStorage.removeItem(this.legacyKey);
    } catch {
      // Storage gone mid-way: the parsed copy below still lands in the view and the core.
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const imported = parsed as Record<string, T>;
    if (Object.keys(imported).length === 0) return;
    for (const [key, value] of Object.entries(imported)) this.entries.set(key, value);
    this.save(imported);
    this.notify();
  }
}
