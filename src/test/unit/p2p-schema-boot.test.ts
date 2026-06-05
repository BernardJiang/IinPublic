/**
 * P2P-X boot-path tests.
 *
 * Verifies:
 * 1. migrateOnRead transparently upgrades a v0 record to the current version.
 * 2. Records already at the current version pass through unchanged.
 * 3. inspectSchemaVersions correctly reports pending counts for mixed batches.
 */
import {
  inspectSchemaVersions,
  migrateRecord,
  SCHEMA_VERSIONS,
} from '../../shared/p2p-schema-migrations';

// Minimal stub of WebGunService that exposes migrateOnRead without Gun deps
class StubGunService {
  migrateOnRead<T extends Record<string, unknown>>(
    kind: Parameters<typeof migrateRecord>[0],
    record: T,
  ) {
    return migrateRecord(kind, record);
  }
}

describe('P2P-X: migrateOnRead on WebGunService stub', () => {
  const svc = new StubGunService();

  it('upgrades a v0 presence record to schemaVersion 1', () => {
    const raw = { userId: 'alice', pub: 'pub_a', lastSeen: '2026-01-01T00:00:00.000Z' };
    const result = svc.migrateOnRead('presence', raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSIONS.presence);
    expect((result as Record<string, unknown>).userId).toBe('alice');
  });

  it('passes through a record that is already at the current version', () => {
    const raw = { peerId: 'peer_1', schemaVersion: 1 };
    const result = svc.migrateOnRead('peerOffer', raw);
    expect(result.schemaVersion).toBe(1);
    expect((result as Record<string, unknown>).peerId).toBe('peer_1');
  });

  it('is idempotent — calling twice does not change the result', () => {
    const raw = { kind: 'event', value: 42 };
    const once = svc.migrateOnRead('ledgerEvent', raw);
    const twice = svc.migrateOnRead('ledgerEvent', once);
    expect(once.schemaVersion).toBe(twice.schemaVersion);
    expect((twice as Record<string, unknown>).value).toBe(42);
  });

  it('covers all registered schema kinds', () => {
    for (const kind of Object.keys(SCHEMA_VERSIONS) as (keyof typeof SCHEMA_VERSIONS)[]) {
      const result = svc.migrateOnRead(kind, {});
      expect(result.schemaVersion).toBe(SCHEMA_VERSIONS[kind]);
    }
  });
});

describe('P2P-X: inspectSchemaVersions reports correct pending counts', () => {
  it('shows zero pending when all records carry the current schema version', () => {
    const records = [{ schemaVersion: 1 }, { schemaVersion: 1 }];
    const diag = inspectSchemaVersions('presence', records);
    expect(diag.pendingMigrations).toBe(0);
    expect(diag.currentVersion).toBe(SCHEMA_VERSIONS.presence);
  });

  it('counts records without schemaVersion as pending', () => {
    const records = [{}, { schemaVersion: 1 }, {}];
    const diag = inspectSchemaVersions('knownPerson', records);
    expect(diag.pendingMigrations).toBe(2);
  });

  it('reports empty store as zero pending (server startup baseline)', () => {
    const diag = inspectSchemaVersions('neighborCache', []);
    expect(diag.pendingMigrations).toBe(0);
    expect(diag.storedVersions).toEqual([]);
  });
});
