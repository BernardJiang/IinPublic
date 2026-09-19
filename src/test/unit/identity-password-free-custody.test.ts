import { webcrypto } from 'node:crypto';
import {
  assertNonExtractableAesGcmKey,
  createBrowserPasswordFreeCustody,
  decryptBrowserPasswordFreeCustody,
  isBrowserNonExtractableKeyCustodyRecordV3,
} from '../../shared/identity-password-free-custody';
import type { BrowserNonExtractableKeyCustodyRecordV3, SeaPrivateIdentityMaterial } from '../../shared/p2p-runtime';

const crypto = webcrypto as unknown as Crypto;
const pair: SeaPrivateIdentityMaterial = {
  pub: 'public-signing-key',
  epub: 'public-encryption-key',
  priv: 'private-signing-key',
  epriv: 'private-encryption-key',
};

function cloneRecord(record: BrowserNonExtractableKeyCustodyRecordV3): BrowserNonExtractableKeyCustodyRecordV3 {
  return JSON.parse(JSON.stringify(record)) as BrowserNonExtractableKeyCustodyRecordV3;
}

describe('browser password-free identity custody v3', () => {
  test('encrypts the SEA pair with a non-extractable AES key and round-trips it', async () => {
    const custody = await createBrowserPasswordFreeCustody(pair, {
      crypto,
      now: new Date('2026-09-18T12:00:00.000Z'),
    });

    expect(isBrowserNonExtractableKeyCustodyRecordV3(custody.record)).toBe(true);
    expect(custody.record).toMatchObject({
      version: 3,
      format: 'webcrypto-nonextractable-v3',
      protection: 'device',
      provider: 'webcrypto-indexeddb',
      publicIdentity: { pub: pair.pub, epub: pair.epub },
    });
    expect(JSON.stringify(custody.record)).not.toContain(pair.priv);
    expect(JSON.stringify(custody.record)).not.toContain(pair.epriv);
    expect(custody.wrappingKey.extractable).toBe(false);
    assertNonExtractableAesGcmKey(custody.wrappingKey);
    await expect(crypto.subtle.exportKey('raw', custody.wrappingKey)).rejects.toThrow();
    await expect(
      decryptBrowserPasswordFreeCustody(custody.record, custody.wrappingKey, { crypto }),
    ).resolves.toEqual(pair);
  });

  test.each([
    ['public identity', (record: BrowserNonExtractableKeyCustodyRecordV3) => { record.publicIdentity.pub = 'substituted'; }],
    ['provider', (record: BrowserNonExtractableKeyCustodyRecordV3) => { record.provider = 'wrong' as never; }],
    ['IV', (record: BrowserNonExtractableKeyCustodyRecordV3) => { record.aead.iv = 'AAAAAAAAAAAAAAAA'; }],
    ['ciphertext', (record: BrowserNonExtractableKeyCustodyRecordV3) => {
      record.ciphertext = `${record.ciphertext.startsWith('A') ? 'B' : 'A'}${record.ciphertext.slice(1)}`;
    }],
  ])('rejects tampered %s with one generic error', async (_label, tamper) => {
    const custody = await createBrowserPasswordFreeCustody(pair, { crypto });
    const changed = cloneRecord(custody.record);
    tamper(changed);
    await expect(
      decryptBrowserPasswordFreeCustody(changed, custody.wrappingKey, { crypto }),
    ).rejects.toThrow('Unable to unlock password-free identity');
  });

  test('rejects a different non-extractable key', async () => {
    const custody = await createBrowserPasswordFreeCustody(pair, { crypto });
    const other = await createBrowserPasswordFreeCustody(pair, { crypto });
    await expect(
      decryptBrowserPasswordFreeCustody(custody.record, other.wrappingKey, { crypto }),
    ).rejects.toThrow('Unable to unlock password-free identity');
  });

  test('rejects extractable keys even when their algorithm and usages match', async () => {
    const extractable = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    expect(() => assertNonExtractableAesGcmKey(extractable)).toThrow(
      'Invalid password-free identity wrapping key',
    );
  });
});
