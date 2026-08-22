import { webcrypto } from 'node:crypto';
import {
  createPasswordKeyCustodyRecord,
  decryptPasswordKeyCustodyRecord,
  IDENTITY_PASSWORD_MAX_CODE_POINTS,
  isPasswordKeyCustodyRecordV2,
  normalizeIdentityPassword,
  serializePasswordCustodyAad,
} from '../../shared/identity-password-custody';
import type {
  PasswordKeyCustodyRecordV2,
  SeaPrivateIdentityMaterial,
} from '../../shared/p2p-runtime';

const pair: SeaPrivateIdentityMaterial = {
  pub: 'public-signing-key',
  epub: 'public-encryption-key',
  priv: 'private-signing-key',
  epriv: 'private-encryption-key',
};
const password = 'correct horse battery staple';

function deterministicCrypto(): Crypto {
  let next = 1;
  return {
    subtle: webcrypto.subtle,
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!array || !ArrayBuffer.isView(array)) throw new TypeError('Expected an array view');
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = next;
        next = (next + 1) & 0xff;
      }
      return array;
    },
  } as unknown as Crypto;
}

function cloneRecord(record: PasswordKeyCustodyRecordV2): PasswordKeyCustodyRecordV2 {
  return JSON.parse(JSON.stringify(record)) as PasswordKeyCustodyRecordV2;
}

describe('identity password custody v2', () => {
  test('normalizes well-formed Unicode with explicit length bounds', () => {
    const composed = normalizeIdentityPassword(`${'x'.repeat(14)}é`);
    const decomposed = normalizeIdentityPassword(`${'x'.repeat(14)}e\u0301`);
    expect(composed).toEqual(decomposed);
    expect(() => normalizeIdentityPassword('too short')).toThrow('at least 15');
    expect(() => normalizeIdentityPassword(`${'x'.repeat(15)}\ud800`)).toThrow('invalid Unicode');
    expect(() => normalizeIdentityPassword('x'.repeat(IDENTITY_PASSWORD_MAX_CODE_POINTS + 1))).toThrow(
      'no more than',
    );
  });

  test('uses canonical fixed-order AAD that excludes ciphertext', () => {
    const aad = new TextDecoder().decode(
      serializePasswordCustodyAad({
        version: 2,
        format: 'password-aead-v2',
        protection: 'password',
        custodyId: 'AQIDBAUGBwgJCgsMDQ4PEA',
        publicIdentity: { pub: 'pub', epub: 'epub' },
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
        createdAt: '2026-08-22T12:00:00.000Z',
        updatedAt: '2026-08-22T12:00:00.000Z',
      }),
    );
    expect(aad).toBe(
      '{"version":2,"format":"password-aead-v2","protection":"password",' +
        '"custodyId":"AQIDBAUGBwgJCgsMDQ4PEA","publicIdentity":{"pub":"pub","epub":"epub"},' +
        '"kdf":{"name":"scrypt","profile":"scrypt-64m-p2-v1",' +
        '"salt":"AQIDBAUGBwgJCgsMDQ4PEA==","N":65536,"r":8,"p":2,"outputBytes":32},' +
        '"aead":{"name":"AES-256-GCM","iv":"ERITFBUWFxgZGhsc","tagBits":128},' +
        '"createdAt":"2026-08-22T12:00:00.000Z","updatedAt":"2026-08-22T12:00:00.000Z"}',
    );
    expect(aad).not.toContain('ciphertext');
  });

  test('creates a strict record and decrypts the identical SEA keypair', async () => {
    const crypto = deterministicCrypto();
    const record = await createPasswordKeyCustodyRecord(pair, password, {
      crypto,
      now: new Date('2026-08-22T12:00:00.000Z'),
    });

    expect(isPasswordKeyCustodyRecordV2(record)).toBe(true);
    expect(record.publicIdentity).toEqual({ pub: pair.pub, epub: pair.epub });
    expect(record.kdf).toEqual({
      name: 'scrypt',
      profile: 'scrypt-64m-p2-v1',
      salt: 'AQIDBAUGBwgJCgsMDQ4PEA==',
      N: 65_536,
      r: 8,
      p: 2,
      outputBytes: 32,
    });
    expect(record.aead).toEqual({
      name: 'AES-256-GCM',
      iv: 'ERITFBUWFxgZGhsc',
      tagBits: 128,
    });
    expect(record.custodyId).toBe('HR4fICEiIyQlJicoKSorLA');
    expect(record.ciphertext).toBe(
      'nmfYIEMriqkfDUXyTRqQzFf5s7ZQ8KwbpvT8yx2zbg0HBEvR8nNPsSX0hUUyKXoP007wWuuO5E/21MCj' +
        'DsklCOuMwIES0zvgDCKENfrSi8m8PBY+iM2riLmgp613TzNsxhjng/wG+Y8bLgsUY99wwQsEYWs7ACm8G' +
        'XubaeZhbP1Omkn6zp4Inh0z1cpQXPZ2HlGHXCOhB7Pmf5iwhCr1GDYDFkJ18XXgw2jZGyreDLDJHdikwI8=',
    );
    expect(JSON.stringify(record)).not.toContain(pair.priv);
    expect(JSON.stringify(record)).not.toContain(pair.epriv);
    await expect(decryptPasswordKeyCustodyRecord(record, password, { crypto })).resolves.toEqual(pair);
  });

  test('returns one generic failure for a wrong password or authenticated-field tampering', async () => {
    const crypto = deterministicCrypto();
    const record = await createPasswordKeyCustodyRecord(pair, password, { crypto });
    const tampered = cloneRecord(record);
    tampered.publicIdentity.pub = 'substituted-public-key';

    await expect(decryptPasswordKeyCustodyRecord(record, 'this password is incorrect', { crypto })).rejects.toThrow(
      'Unable to unlock identity',
    );
    await expect(decryptPasswordKeyCustodyRecord(tampered, password, { crypto })).rejects.toThrow(
      'Unable to unlock identity',
    );
  });

  test('rejects unsupported parameters and unknown fields before starting the KDF', async () => {
    const crypto = deterministicCrypto();
    const record = await createPasswordKeyCustodyRecord(pair, password, { crypto });
    const unsupported = cloneRecord(record) as unknown as {
      kdf: { N: number };
    };
    unsupported.kdf.N = 1_048_576;
    const progress = jest.fn();
    await expect(
      decryptPasswordKeyCustodyRecord(unsupported, password, { crypto, onProgress: progress }),
    ).rejects.toThrow('Unable to unlock identity');
    expect(progress).not.toHaveBeenCalled();

    const withUnknownField = { ...record, futureMeaning: true };
    expect(isPasswordKeyCustodyRecordV2(withUnknownField)).toBe(false);
  });

  test('uses fresh salt, IV, and custody ID for each encryption', async () => {
    const first = await createPasswordKeyCustodyRecord(pair, password, { crypto: deterministicCrypto() });
    const secondCrypto = deterministicCrypto();
    secondCrypto.getRandomValues(new Uint8Array(1));
    const second = await createPasswordKeyCustodyRecord(pair, password, { crypto: secondCrypto });

    expect(second.kdf.salt).not.toBe(first.kdf.salt);
    expect(second.aead.iv).not.toBe(first.aead.iv);
    expect(second.custodyId).not.toBe(first.custodyId);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });
});
