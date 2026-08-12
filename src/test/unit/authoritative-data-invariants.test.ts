import {
  AUTHORITATIVE_DATA_INVARIANTS,
  DURABLE_DATA_CLASSES,
} from '../../shared/authoritative-data-invariants';

describe('Gun-authoritative architecture invariants', () => {
  test('enumerates every durable application data class exactly once', () => {
    const actual = AUTHORITATIVE_DATA_INVARIANTS.map((row) => row.dataClass);
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual([...DURABLE_DATA_CLASSES].sort());
  });

  test('requires local Gun as the target authority and a concrete soul', () => {
    for (const row of AUTHORITATIVE_DATA_INVARIANTS) {
      expect(row.targetAuthoritativeStore).toBe('local-gun');
      expect(row.targetSoul).toMatch(/^[a-zA-Z]+\//);
      expect(row.targetSoul).not.toContain('localStorage');
    }
  });

  test('never treats relay, mailbox, localStorage, or memory as target authority', () => {
    for (const row of AUTHORITATIVE_DATA_INVARIANTS) {
      expect(row.temporaryOnlyStores).not.toContain('local-gun');
      for (const store of row.temporaryOnlyStores) {
        expect(row.currentStores).toContain(store);
      }
    }
  });

  test('keeps private data out of room-public souls', () => {
    for (const row of AUTHORITATIVE_DATA_INVARIANTS.filter((item) => item.visibility !== 'room-public')) {
      expect(row.targetSoul.startsWith('rooms/')).toBe(false);
    }
  });
});

