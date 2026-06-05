import {
  SCHEMA_VERSIONS,
  inspectSchemaVersions,
  migrateRecord,
  migrateRecords,
  runStartupMigrations,
} from '../../shared/p2p-schema-migrations';

describe('migrateRecord', () => {
  it('adds schemaVersion to a v0 presence record', () => {
    const record = { userId: 'alice', pub: 'pub_a', lastSeen: '2026-01-01T00:00:00.000Z' };
    const result = migrateRecord('presence', record);
    expect(result.schemaVersion).toBe(SCHEMA_VERSIONS.presence);
  });

  it('is idempotent — re-running on an already-current record returns equivalent output', () => {
    const record = { userId: 'alice', pub: 'pub_a', schemaVersion: 1 };
    const first = migrateRecord('presence', record);
    const second = migrateRecord('presence', first);
    expect(second.schemaVersion).toBe(first.schemaVersion);
  });

  it('treats missing schemaVersion as v0', () => {
    const record = { peerId: 'peer_1', offers: [] };
    const result = migrateRecord('peerOffer', record);
    expect(result.schemaVersion).toBe(1);
  });

  it('handles all known schema kinds', () => {
    for (const kind of Object.keys(SCHEMA_VERSIONS) as (keyof typeof SCHEMA_VERSIONS)[]) {
      const result = migrateRecord(kind, {});
      expect(result.schemaVersion).toBe(SCHEMA_VERSIONS[kind]);
    }
  });

  it('preserves existing fields during migration', () => {
    const record = { userId: 'alice', extras: { a: 1 } };
    const result = migrateRecord('knownPerson', record);
    expect((result as Record<string, unknown>).userId).toBe('alice');
    expect((result as Record<string, unknown>).extras).toEqual({ a: 1 });
  });
});

describe('migrateRecords', () => {
  it('migrates an array of records', () => {
    const records = [
      { userId: 'a' },
      { userId: 'b', schemaVersion: 1 },
    ];
    const results = migrateRecords('presence', records);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.schemaVersion === 1)).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(migrateRecords('ledgerEvent', [])).toEqual([]);
  });
});

describe('inspectSchemaVersions', () => {
  it('reports no pending migrations when all records are current', () => {
    const records = [{ schemaVersion: 1 }, { schemaVersion: 1 }];
    const diag = inspectSchemaVersions('presence', records);
    expect(diag.pendingMigrations).toBe(0);
    expect(diag.currentVersion).toBe(1);
  });

  it('counts records without schemaVersion as pending', () => {
    const records = [{}, { schemaVersion: 1 }, {}];
    const diag = inspectSchemaVersions('peerOffer', records);
    expect(diag.pendingMigrations).toBe(2);
  });

  it('lists unique stored versions', () => {
    const records = [{ schemaVersion: 0 }, {}, { schemaVersion: 1 }];
    const diag = inspectSchemaVersions('presence', records);
    expect(diag.storedVersions).toContain(0);
    expect(diag.storedVersions).toContain(1);
  });
});

describe('runStartupMigrations', () => {
  it('migrates all kinds with pending records', () => {
    const store = {
      presence: [{ userId: 'alice' }],
      knownPerson: [{ peerId: 'peer_1' }],
    };
    const { migrated, diagnostics } = runStartupMigrations(store);
    expect(migrated.presence?.[0].schemaVersion).toBe(1);
    expect(migrated.knownPerson?.[0].schemaVersion).toBe(1);
    const presenceDiag = diagnostics.find((d) => d.kind === 'presence');
    expect(presenceDiag?.pendingMigrations).toBe(1);
  });

  it('passes through already-current records without change', () => {
    const record = { userId: 'bob', schemaVersion: 1 };
    const store = { presence: [record] };
    const { migrated } = runStartupMigrations(store);
    // Same schemaVersion; reference may differ but content is equivalent
    expect(migrated.presence?.[0].schemaVersion).toBe(1);
    expect((migrated.presence?.[0] as Record<string, unknown>).userId).toBe('bob');
  });

  it('covers all registered schema kinds in diagnostics', () => {
    const { diagnostics } = runStartupMigrations({});
    const kinds = diagnostics.map((d) => d.kind);
    for (const kind of Object.keys(SCHEMA_VERSIONS)) {
      expect(kinds).toContain(kind);
    }
  });
});
