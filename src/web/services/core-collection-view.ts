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
  private loaded = false;
  private readonly pending = new Set<Promise<void>>();
  private readonly localUnconfirmed = new Map<string, T | null>();
  private localEpoch = 0;
  private readonly unsavedKey: string;

  /**
   * `fromLegacy` turns the old blob into entries when it was not already a map of them (the talk
   * ledger was one document of sections).
   */
  constructor(
    readonly collection: CoreCollection,
    private readonly legacyKey: string,
    private readonly fromLegacy: (parsed: unknown) => Record<string, T> = (parsed) =>
      (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, T> : {}),
  ) {
    this.unsavedKey = `iinpublic_core_unsaved_${collection}_v1`;
  }

  /** Whether the core's snapshot has loaded (before it, only unsaved and imported values exist). */
  isConnected(): boolean {
    return this.core !== null;
  }

  get(key: string): T | undefined {
    this.load();
    return this.entries.get(key);
  }

  all(): Record<string, T> {
    this.load();
    return Object.fromEntries(this.entries);
  }

  set(changes: Record<string, T>): void {
    this.load();
    if (Object.keys(changes).length === 0) return;
    this.localEpoch++;
    for (const [key, value] of Object.entries(changes)) this.entries.set(key, value);
    this.save(changes);
    this.notify();
  }

  remove(keys: string[]): void {
    this.load();
    if (keys.length === 0) return;
    this.localEpoch++;
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
    this.load();
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

  /** Import/journal writes must finish before a host command reads this collection. */
  async flush(): Promise<void> {
    if (!this.core) throw new Error(`${this.collection}: device core is not connected`);
    this.load();
    while (this.pending.size) await Promise.all([...this.pending]);
    if (Object.keys(this.readUnsaved()).length) throw new Error(`${this.collection}: unsaved changes remain`);
  }

  /** Refresh a stale tab from the host. The recovery journal is shared by tabs, so only this
   * view's own unconfirmed edits may overlay a host snapshot. */
  async refresh(): Promise<void> {
    if (!this.core) throw new Error(`${this.collection}: device core is not connected`);
    for (;;) {
      while (this.pending.size) await Promise.all([...this.pending]);
      const epoch = this.localEpoch;
      const link: CollectionCoreLink | null = this.core;
      if (!link) throw new Error(`${this.collection}: device core disconnected during refresh`);
      const snapshot = await link.snapshot(this.collection);
      if (this.core !== link || this.localEpoch !== epoch || this.pending.size) continue;
      this.entries.clear();
      for (const [key, value] of Object.entries(snapshot)) this.entries.set(key, value as T);
      for (const [key, value] of this.localUnconfirmed) {
        if (value === null) this.entries.delete(key);
        else this.entries.set(key, value);
      }
      this.notify();
      return;
    }
  }

  /** A committed host-command result updates only the GUI view; never write it back as a stale
   * whole-document edit. The caller has flushed pending imports before issuing the command. */
  acceptSnapshot(snapshot: Record<string, T>): void {
    this.entries.clear();
    for (const [key, value] of Object.entries(snapshot)) this.entries.set(key, value);
    this.notify();
  }

  resetForTests(): void {
    this.entries.clear();
    this.listeners.clear();
    this.localUnconfirmed.clear();
    this.core = null;
    this.loaded = false;
  }

  /**
   * What this device has before the core answers: changes the core has not confirmed (from this
   * page or one closed before saving) on the first read, then any old blob written since.
   */
  private load(): void {
    if (!this.loaded) {
      this.loaded = true;
      for (const [key, value] of Object.entries(this.readUnsaved())) {
        if (value === null) this.entries.delete(key);
        else this.entries.set(key, value);
      }
    }
    this.importLegacy();
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
    for (const [key, value] of Object.entries(changes)) this.localUnconfirmed.set(key, value);
    this.writeUnsaved({ ...this.readUnsaved(), ...changes });
    if (!this.core) return;
    const upserts = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== null));
    const removals = Object.keys(changes).filter((key) => changes[key] === null);
    const write = Promise.all([
      Object.keys(upserts).length ? this.core.upsert(this.collection, upserts) : null,
      removals.length ? this.core.remove(this.collection, removals) : null,
    ]).then(() => {
      const still = this.readUnsaved();
      // Only if not changed again meanwhile; a newer change keeps its own place in the list.
      for (const [key, value] of Object.entries(changes)) {
        if (JSON.stringify(still[key]) === JSON.stringify(value)) delete still[key];
        if (JSON.stringify(this.localUnconfirmed.get(key)) === JSON.stringify(value)) this.localUnconfirmed.delete(key);
      }
      this.writeUnsaved(still);
    }).catch((error) => console.warn(`[${this.collection}] core write failed (kept as unsaved):`, error));
    this.pending.add(write);
    void write.finally(() => this.pending.delete(write));
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
    const imported = this.fromLegacy(parsed);
    if (Object.keys(imported).length === 0) return;
    for (const [key, value] of Object.entries(imported)) this.entries.set(key, value);
    this.save(imported);
    this.notify();
  }
}

/**
 * A map kept in a collection, for code that reads a whole map, edits it and hands it back: reads
 * are copies, and a write sends only the entries that changed and removes the ones left out.
 */
export function mapStore<T>(view: CoreCollectionView<T>): { get(): Record<string, T>; set(map: Record<string, T>): void } {
  return {
    get: () => JSON.parse(JSON.stringify(view.all())) as Record<string, T>,
    set: (map) => {
      const current = view.all();
      const changed = Object.fromEntries(Object.entries(map).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
      view.set(JSON.parse(JSON.stringify(changed)) as Record<string, T>);
      view.remove(Object.keys(current).filter((key) => !(key in map)));
    },
  };
}

/** Entries of a document made of sections of maps (`{ outcomes: {...}, sent: {...} }`), one per record. */
export function sectionEntries(sections: readonly string[], doc: unknown): Record<string, unknown> {
  const source = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
  const entries: Record<string, unknown> = {};
  for (const section of sections) {
    const records = source[section];
    if (records && typeof records === 'object') for (const [key, value] of Object.entries(records)) entries[`${section}::${key}`] = value;
  }
  return entries;
}

/**
 * A document of sections of maps kept in a collection, one entry per record (`<section>::<key>`):
 * `get` rebuilds it (a copy; callers change it in place), `set` writes only what changed.
 */
export function sectionedDocStore<D extends object>(view: CoreCollectionView<unknown>, sections: readonly string[], empty: () => D): { get(): D; set(doc: D): void } {
  const map = mapStore(view);
  return {
    get: () => {
      const doc = empty() as Record<string, Record<string, unknown>>;
      for (const [entryKey, value] of Object.entries(map.get())) {
        const split = entryKey.indexOf('::');
        const section = entryKey.slice(0, split);
        if (split < 0 || !sections.includes(section)) continue;
        doc[section] ??= {};
        doc[section][entryKey.slice(split + 2)] = value;
      }
      return doc as D;
    },
    set: (doc) => map.set(sectionEntries(sections, doc)),
  };
}
