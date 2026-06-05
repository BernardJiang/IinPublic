/**
 * P2P-S — Schema Versions + Deterministic Migration Registry
 *
 * Defines schema versions for all locally-stored P2P objects and provides a
 * deterministic, idempotent startup/read migrator.  Every stored object must
 * carry a `schemaVersion` field so the migrator can decide whether to upgrade.
 *
 * REQ-P2P-13 / REQ-P2P-16
 */

// ---------------------------------------------------------------------------
// Schema version constants
// ---------------------------------------------------------------------------

export const SCHEMA_VERSIONS = {
  presence: 1,
  peerOffer: 1,
  catalogRecord: 1,
  pairResponse: 1,
  pairConversation: 1,
  knownPerson: 1,
  neighborCache: 1,
  ledgerEvent: 1,
  localInIndex: 1,
  localOutIndex: 1,
  peerTrustRecord: 1,
  handshakeRecord: 1,
} as const;

export type SchemaKind = keyof typeof SCHEMA_VERSIONS;
export type CurrentSchemaVersion<K extends SchemaKind> = (typeof SCHEMA_VERSIONS)[K];

// ---------------------------------------------------------------------------
// Versioned base type
// ---------------------------------------------------------------------------

export type VersionedRecord = { schemaVersion: number };

// ---------------------------------------------------------------------------
// Migration function type
// ---------------------------------------------------------------------------

/**
 * A migration takes a record at `fromVersion` and returns a new record at
 * `toVersion`.  Migrations must be pure and idempotent: calling them on an
 * already-migrated record (same `fromVersion`) must return an equivalent output.
 */
export type MigrationFn = (record: Record<string, unknown>) => Record<string, unknown>;

export type MigrationStep = {
  kind: SchemaKind;
  fromVersion: number;
  toVersion: number;
  migrate: MigrationFn;
};

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

const MIGRATION_REGISTRY: MigrationStep[] = [
  // presence v0 → v1: add schemaVersion field
  {
    kind: 'presence',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // peerOffer v0 → v1
  {
    kind: 'peerOffer',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // catalogRecord v0 → v1
  {
    kind: 'catalogRecord',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // pairResponse v0 → v1
  {
    kind: 'pairResponse',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // pairConversation v0 → v1
  {
    kind: 'pairConversation',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // knownPerson v0 → v1
  {
    kind: 'knownPerson',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // neighborCache v0 → v1
  {
    kind: 'neighborCache',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // ledgerEvent v0 → v1
  {
    kind: 'ledgerEvent',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // localInIndex v0 → v1
  {
    kind: 'localInIndex',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // localOutIndex v0 → v1
  {
    kind: 'localOutIndex',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
  // peerTrustRecord v0 → v1
  {
    kind: 'peerTrustRecord',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1, version: 1 }),
  },
  // handshakeRecord v0 → v1
  {
    kind: 'handshakeRecord',
    fromVersion: 0,
    toVersion: 1,
    migrate: (r) => ({ ...r, schemaVersion: 1 }),
  },
];

// ---------------------------------------------------------------------------
// Migrator
// ---------------------------------------------------------------------------

/**
 * Run all pending migration steps for a record of the given kind.
 *
 * The function is deterministic and idempotent:
 * - If the record is already at the current version, it is returned unchanged.
 * - If the record has no `schemaVersion`, it is treated as version 0.
 * - Steps are applied in-order; each step only runs when
 *   `record.schemaVersion === step.fromVersion`.
 */
export function migrateRecord<T extends Record<string, unknown>>(
  kind: SchemaKind,
  record: T,
): T & VersionedRecord {
  const currentVersion = SCHEMA_VERSIONS[kind];
  let current: Record<string, unknown> = { ...record };
  const existingVersion = typeof current.schemaVersion === 'number' ? current.schemaVersion : 0;

  if (existingVersion === currentVersion) {
    return current as T & VersionedRecord;
  }

  const steps = MIGRATION_REGISTRY.filter(
    (s) => s.kind === kind && s.fromVersion >= existingVersion,
  ).sort((a, b) => a.fromVersion - b.fromVersion);

  for (const step of steps) {
    const recordVersion = typeof current.schemaVersion === 'number' ? current.schemaVersion : 0;
    if (recordVersion === step.fromVersion) {
      current = step.migrate(current);
    }
  }

  return current as T & VersionedRecord;
}

/**
 * Migrate an array of records of the same kind.  Records already at the
 * current version pass through without allocation.
 */
export function migrateRecords<T extends Record<string, unknown>>(
  kind: SchemaKind,
  records: T[],
): Array<T & VersionedRecord> {
  return records.map((r) => migrateRecord(kind, r));
}

// ---------------------------------------------------------------------------
// Storage inspector diagnostics
// ---------------------------------------------------------------------------

export type SchemaVersionDiagnostics = {
  kind: SchemaKind;
  currentVersion: number;
  storedVersions: number[];
  pendingMigrations: number;
};

/**
 * Inspect a batch of records and report how many need migration.
 */
export function inspectSchemaVersions(
  kind: SchemaKind,
  records: Array<Record<string, unknown>>,
): SchemaVersionDiagnostics {
  const currentVersion = SCHEMA_VERSIONS[kind];
  const storedVersions = [
    ...new Set(
      records.map((r) => (typeof r.schemaVersion === 'number' ? r.schemaVersion : 0)),
    ),
  ].sort((a, b) => a - b);
  const pendingMigrations = records.filter((r) => {
    const v = typeof r.schemaVersion === 'number' ? r.schemaVersion : 0;
    return v < currentVersion;
  }).length;
  return { kind, currentVersion, storedVersions, pendingMigrations };
}

/**
 * Run the migrator over all known schema kinds for a flat object store.
 * Returns a map of `kind → migrated records` and a diagnostic summary.
 */
export function runStartupMigrations(
  store: Partial<Record<SchemaKind, Array<Record<string, unknown>>>>,
): {
  migrated: Partial<Record<SchemaKind, Array<Record<string, unknown> & VersionedRecord>>>;
  diagnostics: SchemaVersionDiagnostics[];
} {
  const migrated: Partial<Record<SchemaKind, Array<Record<string, unknown> & VersionedRecord>>> = {};
  const diagnostics: SchemaVersionDiagnostics[] = [];

  for (const kind of Object.keys(SCHEMA_VERSIONS) as SchemaKind[]) {
    const records = store[kind] ?? [];
    const diag = inspectSchemaVersions(kind, records);
    diagnostics.push(diag);
    if (diag.pendingMigrations > 0) {
      migrated[kind] = migrateRecords(kind, records);
    } else {
      migrated[kind] = records as Array<Record<string, unknown> & VersionedRecord>;
    }
  }

  return { migrated, diagnostics };
}
