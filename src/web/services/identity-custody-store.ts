import { isPasswordKeyCustodyRecordV2 } from '../../shared/identity-password-custody';
import type { PasswordKeyCustodyRecordV2, SeaPublicIdentity } from '../../shared/p2p-runtime';

const DATABASE_VERSION = 1;
const CUSTODY_STORE = 'custody';
const ACTIVE_KEY = 'active';
const MIGRATION_KEY = 'migration';
export const IDENTITY_CUSTODY_DATABASE_NAME = 'iinpublic-identity-custody-v2';

type StoredActiveRecord = {
  key: typeof ACTIVE_KEY;
  record: PasswordKeyCustodyRecordV2;
};

type StoredMigrationRecord = {
  key: typeof MIGRATION_KEY;
  marker: IdentityCustodyMigrationMarker;
};

export type LegacyToPasswordMigrationMarker = {
  version: 1;
  kind: 'legacy-device-to-password-v2';
  targetCustodyId: string;
  publicIdentity: SeaPublicIdentity;
  legacyRecordStorageKey: string;
  legacySecretStorageKey: string;
  createdAt: string;
};

export type PasswordToLegacyMigrationMarker = {
  version: 1;
  kind: 'password-v2-to-legacy-device-v1';
  sourceCustodyId: string;
  publicIdentity: SeaPublicIdentity;
  createdAt: string;
};

export type IdentityCustodyMigrationMarker =
  | LegacyToPasswordMigrationMarker
  | PasswordToLegacyMigrationMarker;

export interface IdentityCustodyStore {
  readActive(): Promise<PasswordKeyCustodyRecordV2 | null>;
  readMigration(): Promise<IdentityCustodyMigrationMarker | null>;
  replaceActive(
    expectedCustodyId: string | null,
    next: PasswordKeyCustodyRecordV2,
    migration?: IdentityCustodyMigrationMarker | null,
  ): Promise<void>;
  completeMigration(expectedCustodyId: string): Promise<void>;
  beginPasswordRemoval(
    expectedCustodyId: string,
    marker: PasswordToLegacyMigrationMarker,
  ): Promise<void>;
  completePasswordRemoval(expectedCustodyId: string): Promise<void>;
  cancelPasswordRemoval(expectedCustodyId: string): Promise<void>;
  deleteActive(expectedCustodyId: string): Promise<void>;
}

export class IdentityCustodyConflictError extends Error {
  constructor() {
    super('Identity custody changed in another tab');
    this.name = 'IdentityCustodyConflictError';
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true,
    });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Identity custody transaction aborted')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Identity custody transaction failed')),
      { once: true },
    );
  });
}

function abortTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // A request error may already have completed or aborted the transaction.
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isMigrationMarker(value: unknown): value is IdentityCustodyMigrationMarker {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Record<string, unknown>;
  const commonValid =
    marker.version === 1 &&
    isCanonicalTimestamp(marker.createdAt) &&
    !!marker.publicIdentity &&
    typeof marker.publicIdentity === 'object';
  if (!commonValid) return false;
  const identity = marker.publicIdentity as Record<string, unknown>;
  if (
    !hasExactKeys(identity, ['pub', 'epub']) ||
    typeof identity.pub !== 'string' ||
    identity.pub.length === 0 ||
    typeof identity.epub !== 'string' ||
    identity.epub.length === 0
  ) {
    return false;
  }
  if (marker.kind === 'password-v2-to-legacy-device-v1') {
    return (
      hasExactKeys(marker, ['version', 'kind', 'sourceCustodyId', 'publicIdentity', 'createdAt']) &&
      typeof marker.sourceCustodyId === 'string' &&
      /^[A-Za-z0-9_-]{22}$/.test(marker.sourceCustodyId)
    );
  }
  if (
    !hasExactKeys(marker, [
      'version',
      'kind',
      'targetCustodyId',
      'publicIdentity',
      'legacyRecordStorageKey',
      'legacySecretStorageKey',
      'createdAt',
    ]) ||
    marker.kind !== 'legacy-device-to-password-v2' ||
    typeof marker.targetCustodyId !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/.test(marker.targetCustodyId) ||
    typeof marker.legacyRecordStorageKey !== 'string' ||
    marker.legacyRecordStorageKey.length === 0 ||
    typeof marker.legacySecretStorageKey !== 'string' ||
    marker.legacySecretStorageKey.length === 0 ||
    !isCanonicalTimestamp(marker.createdAt)
  ) {
    return false;
  }
  return true;
}

function assertMigrationMatches(
  marker: IdentityCustodyMigrationMarker,
  record: PasswordKeyCustodyRecordV2,
): void {
  if (
    !isMigrationMarker(marker) ||
    marker.kind !== 'legacy-device-to-password-v2' ||
    marker.targetCustodyId !== record.custodyId ||
    marker.publicIdentity.pub !== record.publicIdentity.pub ||
    marker.publicIdentity.epub !== record.publicIdentity.epub
  ) {
    throw new Error('Invalid identity custody migration marker');
  }
}

export class BrowserIdentityCustodyStore implements IdentityCustodyStore {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: { factory?: IDBFactory; databaseName?: string } = {}) {
    const factory = options.factory ?? (typeof indexedDB === 'undefined' ? null : indexedDB);
    if (!factory) throw new Error('IndexedDB is required for password custody');
    this.factory = factory;
    this.databaseName = options.databaseName ?? IDENTITY_CUSTODY_DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CUSTODY_STORE)) {
          database.createObjectStore(CUSTODY_STORE, { keyPath: 'key' });
        }
      });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error ?? new Error('Unable to open identity custody')), {
        once: true,
      });
      request.addEventListener('blocked', () => reject(new Error('Identity custody upgrade is blocked')), {
        once: true,
      });
    });
    return this.databasePromise;
  }

  async readActive(): Promise<PasswordKeyCustodyRecordV2 | null> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const stored = (await requestResult(transaction.objectStore(CUSTODY_STORE).get(ACTIVE_KEY))) as
      | StoredActiveRecord
      | undefined;
    await completion;
    if (stored === undefined) return null;
    if (
      !stored ||
      typeof stored !== 'object' ||
      stored.key !== ACTIVE_KEY ||
      !isPasswordKeyCustodyRecordV2(stored.record)
    ) {
      throw new Error('Stored identity custody record is invalid');
    }
    return stored.record;
  }

  async readMigration(): Promise<IdentityCustodyMigrationMarker | null> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const stored = (await requestResult(transaction.objectStore(CUSTODY_STORE).get(MIGRATION_KEY))) as
      | StoredMigrationRecord
      | undefined;
    await completion;
    if (stored === undefined) return null;
    if (!stored || stored.key !== MIGRATION_KEY || !isMigrationMarker(stored.marker)) {
      throw new Error('Stored identity custody migration marker is invalid');
    }
    return stored.marker;
  }

  async replaceActive(
    expectedCustodyId: string | null,
    next: PasswordKeyCustodyRecordV2,
    migration?: IdentityCustodyMigrationMarker | null,
  ): Promise<void> {
    if (!isPasswordKeyCustodyRecordV2(next)) throw new Error('Invalid identity custody record');
    if (migration) assertMigrationMatches(migration, next);
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const current = (await requestResult(store.get(ACTIVE_KEY))) as StoredActiveRecord | undefined;
      const storedMigration = (await requestResult(store.get(MIGRATION_KEY))) as
        | StoredMigrationRecord
        | undefined;
      if (current !== undefined && !isPasswordKeyCustodyRecordV2(current.record)) {
        throw new Error('Stored identity custody record is invalid');
      }
      if (storedMigration && !isMigrationMarker(storedMigration.marker)) {
        throw new Error('Stored identity custody migration marker is invalid');
      }
      if (
        storedMigration &&
        isMigrationMarker(storedMigration.marker) &&
        storedMigration.marker.kind === 'password-v2-to-legacy-device-v1'
      ) {
        throw new IdentityCustodyConflictError();
      }
      const currentCustodyId = current?.record.custodyId ?? null;
      if (currentCustodyId !== expectedCustodyId) throw new IdentityCustodyConflictError();
      store.put({ key: ACTIVE_KEY, record: next } satisfies StoredActiveRecord);
      if (migration === null) store.delete(MIGRATION_KEY);
      else if (migration !== undefined) {
        store.put({ key: MIGRATION_KEY, marker: migration } satisfies StoredMigrationRecord);
      }
      await completion;
    } catch (error) {
      abortTransaction(transaction);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async completeMigration(expectedCustodyId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const current = (await requestResult(store.get(ACTIVE_KEY))) as StoredActiveRecord | undefined;
      const storedMigration = (await requestResult(store.get(MIGRATION_KEY))) as
        | StoredMigrationRecord
        | undefined;
      if (!current || !isPasswordKeyCustodyRecordV2(current.record)) {
        throw new IdentityCustodyConflictError();
      }
      if (
        current.record.custodyId !== expectedCustodyId ||
        !storedMigration ||
        !isMigrationMarker(storedMigration.marker) ||
        storedMigration.marker.kind !== 'legacy-device-to-password-v2' ||
        storedMigration.marker.targetCustodyId !== expectedCustodyId
      ) {
        throw new IdentityCustodyConflictError();
      }
      store.delete(MIGRATION_KEY);
      await completion;
    } catch (error) {
      abortTransaction(transaction);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async beginPasswordRemoval(
    expectedCustodyId: string,
    marker: PasswordToLegacyMigrationMarker,
  ): Promise<void> {
    if (
      !isMigrationMarker(marker) ||
      marker.kind !== 'password-v2-to-legacy-device-v1' ||
      marker.sourceCustodyId !== expectedCustodyId
    ) {
      throw new Error('Invalid password removal marker');
    }
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const current = (await requestResult(store.get(ACTIVE_KEY))) as StoredActiveRecord | undefined;
      const existingMigration = await requestResult(store.get(MIGRATION_KEY));
      if (
        !current ||
        !isPasswordKeyCustodyRecordV2(current.record) ||
        current.record.custodyId !== expectedCustodyId ||
        current.record.publicIdentity.pub !== marker.publicIdentity.pub ||
        current.record.publicIdentity.epub !== marker.publicIdentity.epub ||
        existingMigration !== undefined
      ) {
        throw new IdentityCustodyConflictError();
      }
      store.put({ key: MIGRATION_KEY, marker } satisfies StoredMigrationRecord);
      await completion;
    } catch (error) {
      abortTransaction(transaction);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async completePasswordRemoval(expectedCustodyId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const current = (await requestResult(store.get(ACTIVE_KEY))) as StoredActiveRecord | undefined;
      const storedMigration = (await requestResult(store.get(MIGRATION_KEY))) as
        | StoredMigrationRecord
        | undefined;
      if (
        !current ||
        !isPasswordKeyCustodyRecordV2(current.record) ||
        current.record.custodyId !== expectedCustodyId ||
        !storedMigration ||
        !isMigrationMarker(storedMigration.marker) ||
        storedMigration.marker.kind !== 'password-v2-to-legacy-device-v1' ||
        storedMigration.marker.sourceCustodyId !== expectedCustodyId
      ) {
        throw new IdentityCustodyConflictError();
      }
      store.delete(ACTIVE_KEY);
      store.delete(MIGRATION_KEY);
      await completion;
    } catch (error) {
      abortTransaction(transaction);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async cancelPasswordRemoval(expectedCustodyId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const current = (await requestResult(store.get(ACTIVE_KEY))) as StoredActiveRecord | undefined;
      const storedMigration = (await requestResult(store.get(MIGRATION_KEY))) as
        | StoredMigrationRecord
        | undefined;
      if (
        !current ||
        !isPasswordKeyCustodyRecordV2(current.record) ||
        current.record.custodyId !== expectedCustodyId ||
        !storedMigration ||
        !isMigrationMarker(storedMigration.marker) ||
        storedMigration.marker.kind !== 'password-v2-to-legacy-device-v1' ||
        storedMigration.marker.sourceCustodyId !== expectedCustodyId
      ) {
        throw new IdentityCustodyConflictError();
      }
      store.delete(MIGRATION_KEY);
      await completion;
    } catch (error) {
      abortTransaction(transaction);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async deleteActive(expectedCustodyId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const current = (await requestResult(store.get(ACTIVE_KEY))) as StoredActiveRecord | undefined;
      if (!current || !isPasswordKeyCustodyRecordV2(current.record)) {
        throw new IdentityCustodyConflictError();
      }
      if (current.record.custodyId !== expectedCustodyId) throw new IdentityCustodyConflictError();
      store.delete(ACTIVE_KEY);
      store.delete(MIGRATION_KEY);
      await completion;
    } catch (error) {
      abortTransaction(transaction);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}
