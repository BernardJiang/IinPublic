import {
  toPublicSeaIdentity,
  type BrowserNonExtractableKeyCustodyRecordV3,
  type SeaPrivateIdentityMaterial,
  type SeaPublicIdentity,
} from './p2p-runtime';

export const PASSWORD_FREE_CUSTODY_IV_BYTES = 12;
export const PASSWORD_FREE_CUSTODY_TAG_BITS = 128 as const;
const PASSWORD_FREE_CUSTODY_ID_BYTES = 16;
const PASSWORD_FREE_CUSTODY_MAX_CIPHERTEXT_BASE64_LENGTH = 65_536;
const PASSWORD_FREE_CUSTODY_PLAINTEXT_SCHEMA = 'iinpublic-sea-keypair-v1';
const GENERIC_DECRYPT_ERROR = 'Unable to unlock password-free identity';

type PasswordFreeCustodyPlaintext = {
  schema: typeof PASSWORD_FREE_CUSTODY_PLAINTEXT_SCHEMA;
  pair: SeaPrivateIdentityMaterial;
};

export type BrowserPasswordFreeCustody = {
  record: BrowserNonExtractableKeyCustodyRecordV3;
  wrappingKey: CryptoKey;
};

type CreateBrowserPasswordFreeCustodyOptions = {
  crypto?: Crypto;
  now?: Date;
  createdAt?: string;
};

function runtimeCrypto(provided?: Crypto): Crypto {
  const crypto = provided ?? globalThis.crypto;
  if (!crypto?.subtle || !crypto.getRandomValues) {
    throw new Error('WebCrypto is required for password-free identity custody');
  }
  return crypto;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string, expectedBytes?: number): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Invalid base64');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) throw new Error('Invalid byte length');
  if (bytesToBase64(bytes) !== value) throw new Error('Non-canonical base64');
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
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

function isPublicIdentity(value: unknown): value is SeaPublicIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Record<string, unknown>;
  return (
    hasExactKeys(identity, ['pub', 'epub']) &&
    typeof identity.pub === 'string' &&
    identity.pub.length > 0 &&
    identity.pub.length <= 4096 &&
    typeof identity.epub === 'string' &&
    identity.epub.length > 0 &&
    identity.epub.length <= 4096
  );
}

export function isBrowserNonExtractableKeyCustodyRecordV3(
  value: unknown,
): value is BrowserNonExtractableKeyCustodyRecordV3 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, [
      'version',
      'format',
      'protection',
      'provider',
      'custodyId',
      'publicIdentity',
      'aead',
      'ciphertext',
      'createdAt',
      'updatedAt',
    ]) ||
    record.version !== 3 ||
    record.format !== 'webcrypto-nonextractable-v3' ||
    record.protection !== 'device' ||
    record.provider !== 'webcrypto-indexeddb' ||
    typeof record.custodyId !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/.test(record.custodyId) ||
    !isPublicIdentity(record.publicIdentity) ||
    !record.aead ||
    typeof record.aead !== 'object' ||
    typeof record.ciphertext !== 'string' ||
    record.ciphertext.length === 0 ||
    record.ciphertext.length > PASSWORD_FREE_CUSTODY_MAX_CIPHERTEXT_BASE64_LENGTH ||
    !isCanonicalTimestamp(record.createdAt) ||
    !isCanonicalTimestamp(record.updatedAt)
  ) {
    return false;
  }
  const aead = record.aead as Record<string, unknown>;
  return (
    hasExactKeys(aead, ['name', 'iv', 'tagBits']) &&
    aead.name === 'AES-256-GCM' &&
    typeof aead.iv === 'string' &&
    aead.iv.length === 16 &&
    aead.tagBits === PASSWORD_FREE_CUSTODY_TAG_BITS
  );
}

export function assertNonExtractableAesGcmKey(key: CryptoKey): void {
  const algorithm = key?.algorithm as AesKeyAlgorithm | undefined;
  if (
    !key ||
    key.type !== 'secret' ||
    key.extractable !== false ||
    algorithm?.name !== 'AES-GCM' ||
    algorithm.length !== 256 ||
    key.usages.length !== 2 ||
    !key.usages.includes('encrypt') ||
    !key.usages.includes('decrypt')
  ) {
    throw new Error('Invalid password-free identity wrapping key');
  }
}

export function serializePasswordFreeCustodyAad(
  record: Omit<BrowserNonExtractableKeyCustodyRecordV3, 'ciphertext'> | BrowserNonExtractableKeyCustodyRecordV3,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: record.version,
    format: record.format,
    protection: record.protection,
    provider: record.provider,
    custodyId: record.custodyId,
    publicIdentity: { pub: record.publicIdentity.pub, epub: record.publicIdentity.epub },
    aead: { name: record.aead.name, iv: record.aead.iv, tagBits: record.aead.tagBits },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

function serializePair(pair: SeaPrivateIdentityMaterial): Uint8Array {
  const plaintext: PasswordFreeCustodyPlaintext = {
    schema: PASSWORD_FREE_CUSTODY_PLAINTEXT_SCHEMA,
    pair: { pub: pair.pub, epub: pair.epub, priv: pair.priv, epriv: pair.epriv },
  };
  return new TextEncoder().encode(JSON.stringify(plaintext));
}

function parsePair(bytes: Uint8Array): SeaPrivateIdentityMaterial {
  const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Partial<PasswordFreeCustodyPlaintext>;
  const pair = decoded.pair;
  if (
    decoded.schema !== PASSWORD_FREE_CUSTODY_PLAINTEXT_SCHEMA ||
    !pair ||
    typeof pair.pub !== 'string' ||
    typeof pair.epub !== 'string' ||
    typeof pair.priv !== 'string' ||
    typeof pair.epriv !== 'string' ||
    !pair.pub || !pair.epub || !pair.priv || !pair.epriv
  ) {
    throw new Error('Invalid password-free custody plaintext');
  }
  return { pub: pair.pub, epub: pair.epub, priv: pair.priv, epriv: pair.epriv };
}

export async function createBrowserPasswordFreeCustody(
  pair: SeaPrivateIdentityMaterial,
  options: CreateBrowserPasswordFreeCustodyOptions = {},
): Promise<BrowserPasswordFreeCustody> {
  const crypto = runtimeCrypto(options.crypto);
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const custodyIdBytes = new Uint8Array(PASSWORD_FREE_CUSTODY_ID_BYTES);
  const iv = new Uint8Array(PASSWORD_FREE_CUSTODY_IV_BYTES);
  crypto.getRandomValues(custodyIdBytes);
  crypto.getRandomValues(iv);
  const wrappingKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  assertNonExtractableAesGcmKey(wrappingKey);
  const recordWithoutCiphertext: Omit<BrowserNonExtractableKeyCustodyRecordV3, 'ciphertext'> = {
    version: 3,
    format: 'webcrypto-nonextractable-v3',
    protection: 'device',
    provider: 'webcrypto-indexeddb',
    custodyId: bytesToBase64Url(custodyIdBytes),
    publicIdentity: toPublicSeaIdentity(pair),
    aead: { name: 'AES-256-GCM', iv: bytesToBase64(iv), tagBits: PASSWORD_FREE_CUSTODY_TAG_BITS },
    createdAt: options.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const plaintext = serializePair(pair);
  try {
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: bytesToArrayBuffer(iv),
        additionalData: bytesToArrayBuffer(serializePasswordFreeCustodyAad(recordWithoutCiphertext)),
        tagLength: PASSWORD_FREE_CUSTODY_TAG_BITS,
      },
      wrappingKey,
      bytesToArrayBuffer(plaintext),
    );
    return { record: { ...recordWithoutCiphertext, ciphertext: bytesToBase64(new Uint8Array(encrypted)) }, wrappingKey };
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptBrowserPasswordFreeCustody(
  value: unknown,
  wrappingKey: CryptoKey,
  options: { crypto?: Crypto } = {},
): Promise<SeaPrivateIdentityMaterial> {
  try {
    if (!isBrowserNonExtractableKeyCustodyRecordV3(value)) throw new Error('Invalid record');
    assertNonExtractableAesGcmKey(wrappingKey);
    const crypto = runtimeCrypto(options.crypto);
    const iv = base64ToBytes(value.aead.iv, PASSWORD_FREE_CUSTODY_IV_BYTES);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytesToArrayBuffer(iv),
        additionalData: bytesToArrayBuffer(serializePasswordFreeCustodyAad(value)),
        tagLength: value.aead.tagBits,
      },
      wrappingKey,
      bytesToArrayBuffer(base64ToBytes(value.ciphertext)),
    );
    const plaintext = new Uint8Array(decrypted);
    try {
      const pair = parsePair(plaintext);
      const publicIdentity = toPublicSeaIdentity(pair);
      if (
        publicIdentity.pub !== value.publicIdentity.pub ||
        publicIdentity.epub !== value.publicIdentity.epub
      ) {
        throw new Error('Public identity mismatch');
      }
      return pair;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error(GENERIC_DECRYPT_ERROR);
  }
}
