import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import {
  createBrowserPasswordFreeCustody,
  decryptBrowserPasswordFreeCustody,
} from '../../shared/identity-password-free-custody';
import type { SeaPrivateIdentityMaterial } from '../../shared/p2p-runtime';
import {
  BrowserPasswordFreeCustodyStore,
  PasswordFreeCustodyConflictError,
} from '../../web/services/identity-password-free-custody-store';

const crypto = webcrypto as unknown as Crypto;
const pair: SeaPrivateIdentityMaterial = {
  pub: 'public-signing-key',
  epub: 'public-encryption-key',
  priv: 'private-signing-key',
  epriv: 'private-encryption-key',
};
let databaseSequence = 0;

function stores(): [BrowserPasswordFreeCustodyStore, BrowserPasswordFreeCustodyStore] {
  databaseSequence += 1;
  const factory = new IDBFactory();
  const databaseName = `identity-password-free-test-${databaseSequence}`;
  return [
    new BrowserPasswordFreeCustodyStore({ factory, databaseName }),
    new BrowserPasswordFreeCustodyStore({ factory, databaseName }),
  ];
}

describe('BrowserPasswordFreeCustodyStore', () => {
  test('persists a non-extractable CryptoKey through IndexedDB structured cloning', async () => {
    const [writer, reader] = stores();
    const custody = await createBrowserPasswordFreeCustody(pair, { crypto });
    await writer.replaceActive(null, custody);

    const persisted = await reader.readActive();
    expect(persisted?.record).toEqual(custody.record);
    expect(persisted?.wrappingKey.extractable).toBe(false);
    await expect(
      decryptBrowserPasswordFreeCustody(persisted?.record, persisted!.wrappingKey, { crypto }),
    ).resolves.toEqual(pair);
    await expect(crypto.subtle.exportKey('raw', persisted!.wrappingKey)).rejects.toThrow();
    await writer.close();
    await reader.close();
  });

  test('uses custody-ID compare-and-swap guards for replacement and deletion', async () => {
    const [store] = stores();
    const first = await createBrowserPasswordFreeCustody(pair, { crypto });
    const second = await createBrowserPasswordFreeCustody(pair, { crypto });
    await store.replaceActive(null, first);

    await expect(store.replaceActive(null, second)).rejects.toBeInstanceOf(PasswordFreeCustodyConflictError);
    await expect(store.replaceActive('wrong-custody-id', second)).rejects.toBeInstanceOf(
      PasswordFreeCustodyConflictError,
    );
    await store.replaceActive(first.record.custodyId, second);
    await expect(store.deleteActive(first.record.custodyId)).rejects.toBeInstanceOf(
      PasswordFreeCustodyConflictError,
    );
    await store.deleteActive(second.record.custodyId);
    await expect(store.readActive()).resolves.toBeNull();
    await store.close();
  });

  test('serializes concurrent first writes so only one tab wins', async () => {
    const [firstTab, secondTab] = stores();
    await firstTab.readActive();
    await secondTab.readActive();
    const first = await createBrowserPasswordFreeCustody(pair, { crypto });
    const second = await createBrowserPasswordFreeCustody(pair, { crypto });

    const results = await Promise.allSettled([
      firstTab.replaceActive(null, first),
      secondTab.replaceActive(null, second),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(PasswordFreeCustodyConflictError),
    });
    await firstTab.close();
    await secondTab.close();
  });

  test('refuses to store an extractable wrapping key', async () => {
    const [store] = stores();
    const custody = await createBrowserPasswordFreeCustody(pair, { crypto });
    const extractable = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    await expect(store.replaceActive(null, { ...custody, wrappingKey: extractable })).rejects.toThrow(
      'Invalid password-free identity wrapping key',
    );
    await expect(store.readActive()).resolves.toBeNull();
    await store.close();
  });
});
