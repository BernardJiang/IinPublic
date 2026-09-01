import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import type { SeaPrivateIdentityMaterial, SeaPublicIdentity } from '../../shared/p2p-runtime';
import { BrowserIdentityCustodyStore } from '../../web/services/identity-custody-store';
import {
  IdentityPasswordCustodyManager,
  type LegacyIdentityCustody,
} from '../../web/services/identity-password-custody-manager';

const pair: SeaPrivateIdentityMaterial = {
  pub: 'public-signing-key',
  epub: 'public-encryption-key',
  priv: 'private-signing-key',
  epriv: 'private-encryption-key',
};
const password = 'correct horse battery staple';
const nextPassword = 'another strong local password';
let databaseSequence = 0;

class FakeLegacyCustody implements LegacyIdentityCustody {
  present = true;
  failRemoval = false;
  failWriteAfterCommit = false;

  async assertMatches(expected: SeaPublicIdentity): Promise<void> {
    if (!this.present) throw new Error('Legacy custody is missing');
    if (expected.pub !== pair.pub || expected.epub !== pair.epub) {
      throw new Error('Legacy custody identity mismatch');
    }
  }

  async removeIfMatches(expected: SeaPublicIdentity): Promise<void> {
    if (expected.pub !== pair.pub || expected.epub !== pair.epub) {
      throw new Error('Legacy custody identity mismatch');
    }
    if (this.failRemoval) throw new Error('Injected legacy removal failure');
    this.present = false;
  }

  async writeAndVerify(expectedPair: SeaPrivateIdentityMaterial): Promise<void> {
    if (expectedPair !== pair && JSON.stringify(expectedPair) !== JSON.stringify(pair)) {
      throw new Error('Password-free identity custody mismatch');
    }
    this.present = true;
    if (this.failWriteAfterCommit) throw new Error('Injected password-free verification failure');
  }

  async assertPairMatches(expectedPair: SeaPrivateIdentityMaterial): Promise<void> {
    if (
      !this.present ||
      expectedPair.pub !== pair.pub ||
      expectedPair.epub !== pair.epub ||
      expectedPair.priv !== pair.priv ||
      expectedPair.epriv !== pair.epriv
    ) {
      throw new Error('Password-free identity custody mismatch');
    }
  }

  async clear(): Promise<void> {
    this.present = false;
  }
}

function setup(): {
  store: BrowserIdentityCustodyStore;
  legacy: FakeLegacyCustody;
  manager: IdentityPasswordCustodyManager;
} {
  databaseSequence += 1;
  const store = new BrowserIdentityCustodyStore({
    factory: new IDBFactory(),
    databaseName: `identity-password-manager-test-${databaseSequence}`,
  });
  const legacy = new FakeLegacyCustody();
  const manager = new IdentityPasswordCustodyManager(store, legacy, {
    crypto: webcrypto as unknown as Crypto,
    now: () => new Date('2026-08-22T12:00:00.000Z'),
  });
  return { store, legacy, manager };
}

describe('IdentityPasswordCustodyManager', () => {
  // Each test runs real scrypt (N=65536, r=8, p=2) KDF operations twice or more.
  // That is intentionally heavy — the profile under test is the production one —
  // and under 12-way parallel test:all load (jest shares ~50% of cores with the
  // e2e waves) it can exceed the 5s Jest default. Explicit budget, same class as
  // the e2e INCOMING_CLUSTER_ARRIVAL_MS headroom: propagation/compute lag under
  // parallel load, not a logic defect (all tests pass green in isolation).
  jest.setTimeout(30_000);
  test('sets a password, verifies the committed record, then removes legacy custody', async () => {
    const { store, legacy, manager } = setup();

    await expect(manager.getStatus()).resolves.toEqual({ state: 'not-set' });
    const record = await manager.setPassword(pair, password);

    expect(legacy.present).toBe(false);
    await expect(store.readMigration()).resolves.toBeNull();
    await expect(manager.getStatus()).resolves.toEqual({
      state: 'locked',
      publicIdentity: { pub: pair.pub, epub: pair.epub },
      updatedAt: '2026-08-22T12:00:00.000Z',
    });
    await expect(manager.unlock(password)).resolves.toEqual(pair);
    await expect(store.readActive()).resolves.toEqual(record);
    await store.close();
  });

  test('recovers an interruption after the v2 commit without losing either valid copy', async () => {
    const { store, legacy, manager } = setup();
    legacy.failRemoval = true;

    await expect(manager.setPassword(pair, password)).rejects.toThrow('Injected legacy removal failure');

    expect(legacy.present).toBe(true);
    const committed = await store.readActive();
    expect(committed).not.toBeNull();
    await expect(store.readMigration()).resolves.toMatchObject({
      targetCustodyId: committed?.custodyId,
    });

    legacy.failRemoval = false;
    await expect(manager.unlock(password)).resolves.toEqual(pair);
    expect(legacy.present).toBe(false);
    await expect(store.readMigration()).resolves.toBeNull();
    await expect(store.readActive()).resolves.toEqual(committed);
    await store.close();
  });

  test('requires the current password and keeps the old record on a failed change', async () => {
    const { store, manager } = setup();
    const original = await manager.setPassword(pair, password);

    await expect(manager.changePassword('incorrect current password', nextPassword)).rejects.toThrow(
      'Unable to unlock identity',
    );
    await expect(store.readActive()).resolves.toEqual(original);

    const changed = await manager.changePassword(password, nextPassword);
    expect(changed.custodyId).not.toBe(original.custodyId);
    expect(changed.kdf.salt).not.toBe(original.kdf.salt);
    expect(changed.aead.iv).not.toBe(original.aead.iv);
    expect(changed.createdAt).toBe(original.createdAt);
    await expect(manager.unlock(password)).rejects.toThrow('Unable to unlock identity');
    await expect(manager.unlock(nextPassword)).resolves.toEqual(pair);
    await store.close();
  });

  test('does not remove the legacy copy when an existing active record makes set fail', async () => {
    const { store, legacy, manager } = setup();
    await store.replaceActive(
      null,
      {
        version: 2,
        format: 'password-aead-v2',
        protection: 'password',
        custodyId: 'AQIDBAUGBwgJCgsMDQ4PEA',
        publicIdentity: { pub: pair.pub, epub: pair.epub },
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
        updatedAt: '2026-08-22T12:00:00.000Z',
      },
    );

    await expect(manager.setPassword(pair, password)).rejects.toThrow('already set');
    expect(legacy.present).toBe(true);
    await store.close();
  });

  test('removes an unverified v2 commit and preserves legacy custody when set read-back fails', async () => {
    const { store, legacy, manager } = setup();
    const readActive = store.readActive.bind(store);
    let reads = 0;
    const readSpy = jest.spyOn(store, 'readActive').mockImplementation(async () => {
      reads += 1;
      if (reads === 2) throw new Error('Injected committed-record read failure');
      return readActive();
    });

    await expect(manager.setPassword(pair, password)).rejects.toThrow(
      'Injected committed-record read failure',
    );
    readSpy.mockRestore();

    expect(legacy.present).toBe(true);
    await expect(store.readActive()).resolves.toBeNull();
    await expect(store.readMigration()).resolves.toBeNull();
    await store.close();
  });

  test('rolls back to the old password record when changed-custody verification fails', async () => {
    const { store, manager } = setup();
    const original = await manager.setPassword(pair, password);
    const readActive = store.readActive.bind(store);
    let reads = 0;
    const readSpy = jest.spyOn(store, 'readActive').mockImplementation(async () => {
      reads += 1;
      if (reads === 3) throw new Error('Injected changed-record read failure');
      return readActive();
    });

    await expect(manager.changePassword(password, nextPassword)).rejects.toThrow(
      'Injected changed-record read failure',
    );
    readSpy.mockRestore();

    await expect(store.readActive()).resolves.toEqual(original);
    await expect(manager.unlock(password)).resolves.toEqual(pair);
    await expect(manager.unlock(nextPassword)).rejects.toThrow('Unable to unlock identity');
    await store.close();
  });

  test('requires the current password and removes v2 only after verified password-free custody', async () => {
    const { store, legacy, manager } = setup();
    const original = await manager.setPassword(pair, password);

    await expect(manager.removePassword('incorrect current password')).rejects.toThrow(
      'Unable to unlock identity',
    );
    expect(legacy.present).toBe(false);
    await expect(store.readActive()).resolves.toEqual(original);

    await expect(manager.removePassword(password)).resolves.toEqual(pair);
    expect(legacy.present).toBe(true);
    await expect(store.readActive()).resolves.toBeNull();
    await expect(store.readMigration()).resolves.toBeNull();
    await expect(manager.getStatus()).resolves.toEqual({ state: 'not-set' });
    await store.close();
  });

  test('finishes an interrupted verified password removal during the next unlock', async () => {
    const { store, legacy, manager } = setup();
    const original = await manager.setPassword(pair, password);
    await store.beginPasswordRemoval(original.custodyId, {
      version: 1,
      kind: 'password-v2-to-legacy-device-v1',
      sourceCustodyId: original.custodyId,
      publicIdentity: original.publicIdentity,
      createdAt: '2026-08-22T12:00:00.000Z',
    });
    await legacy.writeAndVerify(pair);

    await expect(manager.unlock(password)).resolves.toEqual(pair);
    expect(legacy.present).toBe(true);
    await expect(store.readActive()).resolves.toBeNull();
    await expect(store.readMigration()).resolves.toBeNull();
    await store.close();
  });

  test('rolls back an incomplete password-removal candidate and keeps v2 authoritative', async () => {
    const { store, legacy, manager } = setup();
    const original = await manager.setPassword(pair, password);
    await store.beginPasswordRemoval(original.custodyId, {
      version: 1,
      kind: 'password-v2-to-legacy-device-v1',
      sourceCustodyId: original.custodyId,
      publicIdentity: original.publicIdentity,
      createdAt: '2026-08-22T12:00:00.000Z',
    });
    expect(legacy.present).toBe(false);

    await expect(manager.unlock(password)).resolves.toEqual(pair);
    expect(legacy.present).toBe(false);
    await expect(store.readActive()).resolves.toEqual(original);
    await expect(store.readMigration()).resolves.toBeNull();
    await store.close();
  });

  test('clears a failed downgrade candidate and keeps the password record recoverable', async () => {
    const { store, legacy, manager } = setup();
    const original = await manager.setPassword(pair, password);
    legacy.failWriteAfterCommit = true;

    await expect(manager.removePassword(password)).rejects.toThrow(
      'Injected password-free verification failure',
    );
    expect(legacy.present).toBe(false);
    await expect(store.readActive()).resolves.toEqual(original);
    await expect(store.readMigration()).resolves.toBeNull();
    await expect(manager.unlock(password)).resolves.toEqual(pair);
    await store.close();
  });
});
