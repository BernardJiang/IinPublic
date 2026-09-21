export type PinnableList = 'contacts' | 'talks' | 'answers';

const LIST_PINS_STORAGE_KEY = 'iinpublic_list_pins_v1';

type StoredListPins = Record<PinnableList, string[]>;

function emptyStoredPins(): StoredListPins {
  return {
    contacts: [],
    talks: [],
    answers: [],
  };
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function readStoredPins(): StoredListPins {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIST_PINS_STORAGE_KEY) || '{}') as Partial<StoredListPins>;
    return {
      contacts: normalizeIds(parsed.contacts),
      talks: normalizeIds(parsed.talks),
      answers: normalizeIds(parsed.answers),
    };
  } catch {
    return emptyStoredPins();
  }
}

function writeStoredPins(pins: StoredListPins): void {
  try {
    localStorage.setItem(LIST_PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Pinning is a local convenience. A disabled/full storage backend must not break a list.
  }
}

export function getPinnedIds(list: PinnableList): ReadonlySet<string> {
  return new Set(readStoredPins()[list]);
}

export function isListItemPinned(list: PinnableList, id: string): boolean {
  return getPinnedIds(list).has(id);
}

/** Returns the item's new pinned state. */
export function toggleListItemPin(list: PinnableList, id: string): boolean {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return false;

  const pins = readStoredPins();
  const existingIndex = pins[list].indexOf(normalizedId);
  if (existingIndex >= 0) {
    pins[list].splice(existingIndex, 1);
    writeStoredPins(pins);
    return false;
  }

  pins[list].push(normalizedId);
  writeStoredPins(pins);
  return true;
}

/** Stable partition: pinned rows first, preserving the list's existing order within each tier. */
export function pinnedFirst<T>(items: readonly T[], list: PinnableList, getId: (item: T) => string): T[] {
  const pinnedIds = getPinnedIds(list);
  if (pinnedIds.size === 0) return [...items];
  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const item of items) {
    (pinnedIds.has(getId(item)) ? pinned : unpinned).push(item);
  }
  return [...pinned, ...unpinned];
}
