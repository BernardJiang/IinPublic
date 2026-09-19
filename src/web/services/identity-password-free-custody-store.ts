import {
  assertNonExtractableAesGcmKey,
  isBrowserNonExtractableKeyCustodyRecordV3,
  type BrowserPasswordFreeCustody,
} from '../../shared/identity-password-free-custody';
import type { BrowserNonExtractableKeyCustodyRecordV3 } from '../../shared/p2p-runtime';

const DATABASE_VERSION = 1;
const CUSTODY_STORE = 'custody';
const ACTIVE_KEY = 'active';
export const PASSWORD_FREE_CUSTODY_DATABASE_NAME = 'iinpublic-identity-custody-v3';

type StoredPasswordFreeCustody = {
  key: typeof ACTIVE_KEY;
  record: BrowserNonExtractableKeyCustodyRecordV3;
  wrappingKey: CryptoKey;
};

export class PasswordFreeCustodyConflictError extends Error {
  constructor() {
    super('Password-free identity custody changed in another tab');
    this.name = 'PasswordFreeCustodyConflictError';
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
      () => reject(transaction.error ?? new Error('Password-free custody transaction aborted')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Password-free custody transaction failed')),
      { once: true },
    );
  });
}

function abortTransaction(transaction: IDBTransaction): void {
  try { transaction.abort(); } catch { /* already completed or aborted */ }
}

function validateStored(value: unknown): BrowserPasswordFreeCustody {
  if (!value || typeof value !== 'object') throw new Error('Stored password-free custody is invalid');
  const stored = value as Partial<StoredPasswordFreeCustody>;
  if (stored.key !== ACTIVE_KEY || !isBrowserNonExtractableKeyCustodyRecordV3(stored.record)) {
    throw new Error('Stored password-free custody is invalid');
  }
  assertNonExtractableAesGcmKey(stored.wrappingKey as CryptoKey);
  return { record: stored.record, wrappingKey: stored.wrappingKey as CryptoKey };
}

export class BrowserPasswordFreeCustodyStore {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: { factory?: IDBFactory; databaseName?: string } = {}) {
    const factory = options.factory ?? (typeof indexedDB === 'undefined' ? null : indexedDB);
    if (!factory) throw new Error('IndexedDB is required for password-free identity custody');
    this.factory = factory;
    this.databaseName = options.databaseName ?? PASSWORD_FREE_CUSTODY_DATABASE_NAME;
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
      request.addEventListener('error', () => reject(request.error ?? new Error('Unable to open password-free custody')), {
        once: true,
      });
      request.addEventListener('blocked', () => reject(new Error('Password-free custody upgrade is blocked')), {
        once: true,
      });
    });
    return this.databasePromise;
  }

  async readActive(): Promise<BrowserPasswordFreeCustody | null> {
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    const stored = await requestResult(transaction.objectStore(CUSTODY_STORE).get(ACTIVE_KEY));
    await completion;
    return stored === undefined ? null : validateStored(stored);
  }

  async replaceActive(
    expectedCustodyId: string | null,
    next: BrowserPasswordFreeCustody,
  ): Promise<void> {
    if (!isBrowserNonExtractableKeyCustodyRecordV3(next.record)) {
      throw new Error('Invalid password-free identity custody record');
    }
    assertNonExtractableAesGcmKey(next.wrappingKey);
    const database = await this.open();
    const transaction = database.transaction(CUSTODY_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(CUSTODY_STORE);
      const currentValue = await requestResult(store.get(ACTIVE_KEY));
      const current = currentValue === undefined ? null : validateStored(currentValue);
      if ((current?.record.custodyId ?? null) !== expectedCustodyId) {
        throw new PasswordFreeCustodyConflictError();
      }
      store.put({ key: ACTIVE_KEY, ...next } satisfies StoredPasswordFreeCustody);
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
      const currentValue = await requestResult(store.get(ACTIVE_KEY));
      const current = currentValue === undefined ? null : validateStored(currentValue);
      if (!current || current.record.custodyId !== expectedCustodyId) {
        throw new PasswordFreeCustodyConflictError();
      }
      store.delete(ACTIVE_KEY);
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
