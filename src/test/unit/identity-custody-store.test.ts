import { IDBFactory } from 'fake-indexeddb';
import type { PasswordKeyCustodyRecordV2 } from '../../shared/p2p-runtime';
import {
  BrowserIdentityCustodyStore,
  IdentityCustodyConflictError,
  type IdentityCustodyMigrationMarker,
} from '../../web/services/identity-custody-store';

let databaseSequence = 0;

function record(custodyId: string, updatedAt = '2026-08-22T12:00:00.000Z'): PasswordKeyCustodyRecordV2 {
  return {
    version: 2,
    format: 'password-aead-v2',
    protection: 'password',
    custodyId,
    publicIdentity: { pub: 'public-signing-key', epub: 'public-encryption-key' },
    kdf: {
      name: 'scrypt',
      profile: 'scrypt-64m-p2-v1',
      salt: 'AQIDBAUGBwgJCgsMDQ4PEA==',
      N: 65_536,
      r: 8,
      p: 2,
      outputBytes: 32,
    },
    aead: { name: 'AES-256-GCM', iv: 'ERITFBUWFxgZGhsc', tagBits: 128 },
    ciphertext: 'AAAA',
    createdAt: '2026-08-22T12:00:00.000Z',
    updatedAt,
  };
}

function marker(target: PasswordKeyCustodyRecordV2): IdentityCustodyMigrationMarker {
  return {
    version: 1,
    kind: 'legacy-device-to-password-v2',
    targetCustodyId: target.custodyId,
    publicIdentity: target.publicIdentity,
    legacyRecordStorageKey: 'iinpublic_key_custody_v1',
    legacySecretStorageKey: 'iinpublic_key_custody_device_secret_v1',
    createdAt: '2026-08-22T12:00:00.000Z',
  };
}

function stores(): [BrowserIdentityCustodyStore, BrowserIdentityCustodyStore] {
  const factory = new IDBFactory();
  databaseSequence += 1;
  const databaseName = `identity-custody-test-${databaseSequence}`;
  return [
    new BrowserIdentityCustodyStore({ factory, databaseName }),
    new BrowserIdentityCustodyStore({ factory, databaseName }),
  ];
}

describe('BrowserIdentityCustodyStore', () => {
  test('stores and reads an active record with its migration marker atomically', async () => {
    const [store] = stores();
    const active = record('AQIDBAUGBwgJCgsMDQ4PEA');
    const migration = marker(active);

    await store.replaceActive(null, active, migration);

    await expect(store.readActive()).resolves.toEqual(active);
    await expect(store.readMigration()).resolves.toEqual(migration);
    await store.close();
  });

  test('uses custody ID compare-and-swap guards for replacement', async () => {
    const [store] = stores();
    const first = record('AQIDBAUGBwgJCgsMDQ4PEA');
    const second = record('ERITFBUWFxgZGhscHR4fIA', '2026-08-22T12:01:00.000Z');
    await store.replaceActive(null, first);

    await expect(store.replaceActive(null, second)).rejects.toBeInstanceOf(IdentityCustodyConflictError);
    await expect(store.replaceActive('wrong-custody-id', second)).rejects.toBeInstanceOf(
      IdentityCustodyConflictError,
    );
    await store.replaceActive(first.custodyId, second);
    await expect(store.readActive()).resolves.toEqual(second);
    await store.close();
  });

  test('serializes concurrent first writes so only one tab can win', async () => {
    const [firstTab, secondTab] = stores();
    await firstTab.readActive();
    await secondTab.readActive();
    const first = record('AQIDBAUGBwgJCgsMDQ4PEA');
    const second = record('ERITFBUWFxgZGhscHR4fIA');

    const results = await Promise.allSettled([
      firstTab.replaceActive(null, first),
      secondTab.replaceActive(null, second),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(IdentityCustodyConflictError) });
    const persisted = await firstTab.readActive();
    expect([first.custodyId, second.custodyId]).toContain(persisted?.custodyId);
    await firstTab.close();
    await secondTab.close();
  });

  test('clears only a matching migration and active record', async () => {
    const [store] = stores();
    const active = record('AQIDBAUGBwgJCgsMDQ4PEA');
    await store.replaceActive(null, active, marker(active));

    await expect(store.completeMigration('wrong-custody-id')).rejects.toBeInstanceOf(
      IdentityCustodyConflictError,
    );
    await store.completeMigration(active.custodyId);
    await expect(store.readMigration()).resolves.toBeNull();
    await expect(store.deleteActive('wrong-custody-id')).rejects.toBeInstanceOf(
      IdentityCustodyConflictError,
    );
    await store.deleteActive(active.custodyId);
    await expect(store.readActive()).resolves.toBeNull();
    await store.close();
  });

  test('rejects mismatched migration metadata before changing storage', async () => {
    const [store] = stores();
    const active = record('AQIDBAUGBwgJCgsMDQ4PEA');
    const mismatched = { ...marker(active), targetCustodyId: 'ERITFBUWFxgZGhscHR4fIA' };

    await expect(store.replaceActive(null, active, mismatched)).rejects.toThrow(
      'Invalid identity custody migration marker',
    );
    await expect(store.readActive()).resolves.toBeNull();
    await store.close();
  });

  test('serializes password removal and deletes v2 only with its matching marker', async () => {
    const [firstTab, secondTab] = stores();
    const active = record('AQIDBAUGBwgJCgsMDQ4PEA');
    await firstTab.replaceActive(null, active);
    const removal = {
      version: 1 as const,
      kind: 'password-v2-to-legacy-device-v1' as const,
      sourceCustodyId: active.custodyId,
      publicIdentity: active.publicIdentity,
      createdAt: '2026-08-22T12:00:00.000Z',
    };

    await firstTab.beginPasswordRemoval(active.custodyId, removal);
    await expect(secondTab.beginPasswordRemoval(active.custodyId, removal)).rejects.toBeInstanceOf(
      IdentityCustodyConflictError,
    );
    await expect(secondTab.replaceActive(active.custodyId, record('ERITFBUWFxgZGhscHR4fIA'))).rejects
      .toBeInstanceOf(IdentityCustodyConflictError);
    await expect(firstTab.completePasswordRemoval('wrong-custody-id')).rejects.toBeInstanceOf(
      IdentityCustodyConflictError,
    );
    await firstTab.completePasswordRemoval(active.custodyId);
    await expect(firstTab.readActive()).resolves.toBeNull();
    await expect(firstTab.readMigration()).resolves.toBeNull();
    await firstTab.close();
    await secondTab.close();
  });

  test('can cancel a matching password-removal marker without deleting v2', async () => {
    const [store] = stores();
    const active = record('AQIDBAUGBwgJCgsMDQ4PEA');
    await store.replaceActive(null, active);
    await store.beginPasswordRemoval(active.custodyId, {
      version: 1,
      kind: 'password-v2-to-legacy-device-v1',
      sourceCustodyId: active.custodyId,
      publicIdentity: active.publicIdentity,
      createdAt: '2026-08-22T12:00:00.000Z',
    });

    await store.cancelPasswordRemoval(active.custodyId);
    await expect(store.readActive()).resolves.toEqual(active);
    await expect(store.readMigration()).resolves.toBeNull();
    await store.close();
  });
});
