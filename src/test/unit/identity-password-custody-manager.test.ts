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
});
