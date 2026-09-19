import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import type { SeaPrivateIdentityMaterial, SeaPublicIdentity } from '../../shared/p2p-runtime';
import { BrowserPasswordFreeCustodyManager } from '../../web/services/browser-password-free-custody-manager';
import { BrowserPasswordFreeCustodyStore } from '../../web/services/identity-password-free-custody-store';

const crypto = webcrypto as unknown as Crypto;
const pair: SeaPrivateIdentityMaterial = {
  pub: 'public-signing-key',
  epub: 'public-encryption-key',
  priv: 'private-signing-key',
  epriv: 'private-encryption-key',
};
let databaseSequence = 0;

function setup(): { store: BrowserPasswordFreeCustodyStore; manager: BrowserPasswordFreeCustodyManager } {
  databaseSequence += 1;
  const store = new BrowserPasswordFreeCustodyStore({
    factory: new IDBFactory(),
    databaseName: `password-free-manager-test-${databaseSequence}`,
  });
  return {
    store,
    manager: new BrowserPasswordFreeCustodyManager(store, {
      crypto,
      now: () => new Date('2026-09-18T12:00:00.000Z'),
    }),
  };
}

describe('BrowserPasswordFreeCustodyManager', () => {
  test('writes, reads back, and removes only the matching identity', async () => {
    const { store, manager } = setup();
    await manager.writeAndVerify(pair);
    await expect(manager.readPair()).resolves.toEqual(pair);
    await expect(manager.getPublicIdentity()).resolves.toEqual({ pub: pair.pub, epub: pair.epub });
    await expect(manager.removeIfMatches({ pub: 'wrong', epub: pair.epub })).rejects.toThrow(
      'Refusing to remove custody for a different identity',
    );
    await expect(manager.readPair()).resolves.toEqual(pair);
    await manager.removeIfMatches({ pub: pair.pub, epub: pair.epub });
    await expect(manager.readPair()).resolves.toBeNull();
    await store.close();
  });

  test('rolls back the committed candidate when read-back verification fails', async () => {
    const { store, manager } = setup();
    const readActive = store.readActive.bind(store);
    let reads = 0;
    const readSpy = jest.spyOn(store, 'readActive').mockImplementation(async () => {
      reads += 1;
      if (reads === 2) throw new Error('Injected read-back failure');
      return readActive();
    });
    await expect(manager.writeAndVerify(pair)).rejects.toThrow('Injected read-back failure');
    readSpy.mockRestore();
    await expect(store.readActive()).resolves.toBeNull();
    await store.close();
  });

  test('migrates copy-verify-delete and safely resumes after source cleanup fails', async () => {
    const { store, manager } = setup();
    let sourcePair: SeaPrivateIdentityMaterial | null = pair;
    let failCleanup = true;
    const source = {
      readPair: async () => sourcePair,
      removeIfMatches: async (expected: SeaPublicIdentity) => {
        expect(expected).toEqual({ pub: pair.pub, epub: pair.epub });
        if (failCleanup) throw new Error('Injected source cleanup failure');
        sourcePair = null;
      },
    };

    await expect(manager.migrateFrom(source)).rejects.toThrow('Injected source cleanup failure');
    await expect(manager.readPair()).resolves.toEqual(pair);
    expect(sourcePair).toEqual(pair);

    failCleanup = false;
    await expect(manager.migrateFrom(source)).resolves.toEqual(pair);
    expect(sourcePair).toBeNull();
    await expect(manager.readPair()).resolves.toEqual(pair);
    await store.close();
  });

  test('refuses migration when source and v3 contain different private identities', async () => {
    const { store, manager } = setup();
    await manager.writeAndVerify(pair);
    const other = { ...pair, priv: 'different-private-key' };
    await expect(manager.migrateFrom({
      readPair: async () => other,
      removeIfMatches: async () => undefined,
    })).rejects.toThrow('Password-free identity migration conflict');
    await expect(manager.readPair()).resolves.toEqual(pair);
    await store.close();
  });
});
