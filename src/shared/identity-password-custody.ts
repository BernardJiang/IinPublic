import { scryptAsync } from '@noble/hashes/scrypt';
import {
  toPublicSeaIdentity,
  type PasswordKeyCustodyRecordV2,
  type SeaPrivateIdentityMaterial,
  type SeaPublicIdentity,
} from './p2p-runtime';

export const IDENTITY_PASSWORD_MIN_CODE_POINTS = 15;
export const IDENTITY_PASSWORD_MAX_CODE_POINTS = 1024;
export const PASSWORD_CUSTODY_KDF_PROFILE = 'scrypt-64m-p2-v1' as const;
export const PASSWORD_CUSTODY_SCRYPT_N = 65_536 as const;
export const PASSWORD_CUSTODY_SCRYPT_R = 8 as const;
export const PASSWORD_CUSTODY_SCRYPT_P = 2 as const;
export const PASSWORD_CUSTODY_DERIVED_KEY_BYTES = 32 as const;
export const PASSWORD_CUSTODY_SALT_BYTES = 16;
export const PASSWORD_CUSTODY_IV_BYTES = 12;
export const PASSWORD_CUSTODY_TAG_BITS = 128 as const;

const PASSWORD_CUSTODY_ID_BYTES = 16;
const PASSWORD_CUSTODY_MAX_CIPHERTEXT_BASE64_LENGTH = 65_536;
const PASSWORD_CUSTODY_SCRYPT_MAX_MEMORY_BYTES =
  128 * PASSWORD_CUSTODY_SCRYPT_R * (PASSWORD_CUSTODY_SCRYPT_N + PASSWORD_CUSTODY_SCRYPT_P);
const PASSWORD_CUSTODY_PLAINTEXT_SCHEMA = 'iinpublic-sea-keypair-v1';
const GENERIC_UNLOCK_ERROR = 'Unable to unlock identity';

type PasswordCustodyPlaintext = {
  schema: typeof PASSWORD_CUSTODY_PLAINTEXT_SCHEMA;
  pair: SeaPrivateIdentityMaterial;
};

export type PasswordCustodyProgress = (progress: number) => void;

export type CreatePasswordCustodyOptions = {
  crypto?: Crypto;
  now?: Date;
  createdAt?: string;
  onProgress?: PasswordCustodyProgress;
};

export type DecryptPasswordCustodyOptions = {
  crypto?: Crypto;
  onProgress?: PasswordCustodyProgress;
};

function runtimeCrypto(provided?: Crypto): Crypto {
  const crypto = provided ?? globalThis.crypto;
  if (!crypto?.subtle || !crypto.getRandomValues) {
    throw new Error('WebCrypto is required for password custody');
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

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function normalizeIdentityPassword(password: string): Uint8Array {
  if (!isWellFormedUtf16(password)) throw new Error('Password contains invalid Unicode');
  const normalized = password.normalize('NFC');
  const codePoints = Array.from(normalized).length;
  if (codePoints < IDENTITY_PASSWORD_MIN_CODE_POINTS) {
    throw new Error(`Password must contain at least ${IDENTITY_PASSWORD_MIN_CODE_POINTS} characters`);
  }
  if (codePoints > IDENTITY_PASSWORD_MAX_CODE_POINTS) {
    throw new Error(`Password must contain no more than ${IDENTITY_PASSWORD_MAX_CODE_POINTS} characters`);
  }
  return new TextEncoder().encode(normalized);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
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

export function isPasswordKeyCustodyRecordV2(value: unknown): value is PasswordKeyCustodyRecordV2 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, [
      'version',
      'format',
      'protection',
      'custodyId',
      'publicIdentity',
      'kdf',
      'aead',
      'ciphertext',
      'createdAt',
      'updatedAt',
    ]) ||
    record.version !== 2 ||
    record.format !== 'password-aead-v2' ||
    record.protection !== 'password' ||
    typeof record.custodyId !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/.test(record.custodyId) ||
    !isPublicIdentity(record.publicIdentity) ||
    !isCanonicalTimestamp(record.createdAt) ||
    !isCanonicalTimestamp(record.updatedAt) ||
    typeof record.ciphertext !== 'string' ||
    record.ciphertext.length === 0 ||
    record.ciphertext.length > PASSWORD_CUSTODY_MAX_CIPHERTEXT_BASE64_LENGTH ||
    !record.kdf ||
    typeof record.kdf !== 'object' ||
    !record.aead ||
    typeof record.aead !== 'object'
  ) {
    return false;
  }
  const kdf = record.kdf as Record<string, unknown>;
  const aead = record.aead as Record<string, unknown>;
  return (
    hasExactKeys(kdf, ['name', 'profile', 'salt', 'N', 'r', 'p', 'outputBytes']) &&
    kdf.name === 'scrypt' &&
    kdf.profile === PASSWORD_CUSTODY_KDF_PROFILE &&
    typeof kdf.salt === 'string' &&
    kdf.salt.length === 24 &&
    kdf.N === PASSWORD_CUSTODY_SCRYPT_N &&
    kdf.r === PASSWORD_CUSTODY_SCRYPT_R &&
    kdf.p === PASSWORD_CUSTODY_SCRYPT_P &&
    kdf.outputBytes === PASSWORD_CUSTODY_DERIVED_KEY_BYTES &&
    hasExactKeys(aead, ['name', 'iv', 'tagBits']) &&
    aead.name === 'AES-256-GCM' &&
    typeof aead.iv === 'string' &&
    aead.iv.length === 16 &&
    aead.tagBits === PASSWORD_CUSTODY_TAG_BITS
  );
}

export function serializePasswordCustodyAad(
  record: Omit<PasswordKeyCustodyRecordV2, 'ciphertext'> | PasswordKeyCustodyRecordV2,
): Uint8Array {
  const aad = {
    version: record.version,
    format: record.format,
    protection: record.protection,
    custodyId: record.custodyId,
    publicIdentity: { pub: record.publicIdentity.pub, epub: record.publicIdentity.epub },
    kdf: {
      name: record.kdf.name,
      profile: record.kdf.profile,
      salt: record.kdf.salt,
      N: record.kdf.N,
      r: record.kdf.r,
      p: record.kdf.p,
      outputBytes: record.kdf.outputBytes,
    },
    aead: { name: record.aead.name, iv: record.aead.iv, tagBits: record.aead.tagBits },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return new TextEncoder().encode(JSON.stringify(aad));
}

function serializeKeypair(pair: SeaPrivateIdentityMaterial): Uint8Array {
  const plaintext: PasswordCustodyPlaintext = {
    schema: PASSWORD_CUSTODY_PLAINTEXT_SCHEMA,
    pair: { pub: pair.pub, epub: pair.epub, priv: pair.priv, epriv: pair.epriv },
  };
  return new TextEncoder().encode(JSON.stringify(plaintext));
}

function parseKeypair(bytes: ArrayBuffer): SeaPrivateIdentityMaterial {
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid plaintext');
  const plaintext = parsed as Record<string, unknown>;
  if (!hasExactKeys(plaintext, ['schema', 'pair']) || plaintext.schema !== PASSWORD_CUSTODY_PLAINTEXT_SCHEMA) {
    throw new Error('Invalid plaintext');
  }
  if (!plaintext.pair || typeof plaintext.pair !== 'object') throw new Error('Invalid keypair');
  const pair = plaintext.pair as Record<string, unknown>;
  if (
    !hasExactKeys(pair, ['pub', 'epub', 'priv', 'epriv']) ||
    typeof pair.pub !== 'string' ||
    typeof pair.epub !== 'string' ||
    typeof pair.priv !== 'string' ||
    typeof pair.epriv !== 'string' ||
    !pair.pub ||
    !pair.epub ||
    !pair.priv ||
    !pair.epriv
  ) {
    throw new Error('Invalid keypair');
  }
  return { pub: pair.pub, epub: pair.epub, priv: pair.priv, epriv: pair.epriv };
}

async function derivePasswordKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  onProgress?: PasswordCustodyProgress,
): Promise<Uint8Array> {
  return scryptAsync(passwordBytes, salt, {
    N: PASSWORD_CUSTODY_SCRYPT_N,
    r: PASSWORD_CUSTODY_SCRYPT_R,
    p: PASSWORD_CUSTODY_SCRYPT_P,
    dkLen: PASSWORD_CUSTODY_DERIVED_KEY_BYTES,
    maxmem: PASSWORD_CUSTODY_SCRYPT_MAX_MEMORY_BYTES,
    asyncTick: 10,
    ...(onProgress ? { onProgress } : {}),
  });
}

export async function createPasswordKeyCustodyRecord(
  pair: SeaPrivateIdentityMaterial,
  password: string,
  options: CreatePasswordCustodyOptions = {},
): Promise<PasswordKeyCustodyRecordV2> {
  const crypto = runtimeCrypto(options.crypto);
  const passwordBytes = normalizeIdentityPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_CUSTODY_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(PASSWORD_CUSTODY_IV_BYTES));
  const custodyIdBytes = crypto.getRandomValues(new Uint8Array(PASSWORD_CUSTODY_ID_BYTES));
  let derivedKey: Uint8Array | null = null;
  let plaintext: Uint8Array | null = null;
  try {
    derivedKey = await derivePasswordKey(passwordBytes, salt, options.onProgress);
    const now = (options.now ?? new Date()).toISOString();
    const createdAt = options.createdAt ?? now;
    const recordWithoutCiphertext: Omit<PasswordKeyCustodyRecordV2, 'ciphertext'> = {
      version: 2,
      format: 'password-aead-v2',
      protection: 'password',
      custodyId: bytesToBase64Url(custodyIdBytes),
      publicIdentity: toPublicSeaIdentity(pair),
      kdf: {
        name: 'scrypt',
        profile: PASSWORD_CUSTODY_KDF_PROFILE,
        salt: bytesToBase64(salt),
        N: PASSWORD_CUSTODY_SCRYPT_N,
        r: PASSWORD_CUSTODY_SCRYPT_R,
        p: PASSWORD_CUSTODY_SCRYPT_P,
        outputBytes: PASSWORD_CUSTODY_DERIVED_KEY_BYTES,
      },
      aead: { name: 'AES-256-GCM', iv: bytesToBase64(iv), tagBits: PASSWORD_CUSTODY_TAG_BITS },
      createdAt,
      updatedAt: now,
    };
    plaintext = serializeKeypair(pair);
    const key = await crypto.subtle.importKey(
      'raw',
      bytesToArrayBuffer(derivedKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: bytesToArrayBuffer(iv),
        additionalData: bytesToArrayBuffer(serializePasswordCustodyAad(recordWithoutCiphertext)),
        tagLength: PASSWORD_CUSTODY_TAG_BITS,
      },
      key,
      bytesToArrayBuffer(plaintext),
    );
    return { ...recordWithoutCiphertext, ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
  } finally {
    passwordBytes.fill(0);
    derivedKey?.fill(0);
    plaintext?.fill(0);
  }
}

export async function decryptPasswordKeyCustodyRecord(
  value: unknown,
  password: string,
  options: DecryptPasswordCustodyOptions = {},
): Promise<SeaPrivateIdentityMaterial> {
  let passwordBytes: Uint8Array | null = null;
  let derivedKey: Uint8Array | null = null;
  try {
    if (!isPasswordKeyCustodyRecordV2(value)) throw new Error('Invalid record');
    const record = value;
    const crypto = runtimeCrypto(options.crypto);
    passwordBytes = normalizeIdentityPassword(password);
    const salt = base64ToBytes(record.kdf.salt, PASSWORD_CUSTODY_SALT_BYTES);
    const iv = base64ToBytes(record.aead.iv, PASSWORD_CUSTODY_IV_BYTES);
    const ciphertext = base64ToBytes(record.ciphertext);
    derivedKey = await derivePasswordKey(passwordBytes, salt, options.onProgress);
    const key = await crypto.subtle.importKey(
      'raw',
      bytesToArrayBuffer(derivedKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytesToArrayBuffer(iv),
        additionalData: bytesToArrayBuffer(serializePasswordCustodyAad(record)),
        tagLength: PASSWORD_CUSTODY_TAG_BITS,
      },
      key,
      bytesToArrayBuffer(ciphertext),
    );
    try {
      const pair = parseKeypair(decrypted);
      const publicIdentity = toPublicSeaIdentity(pair);
      if (
        publicIdentity.pub !== record.publicIdentity.pub ||
        publicIdentity.epub !== record.publicIdentity.epub
      ) {
        throw new Error('Identity mismatch');
      }
      return pair;
    } finally {
      new Uint8Array(decrypted).fill(0);
    }
  } catch {
    throw new Error(GENERIC_UNLOCK_ERROR);
  } finally {
    passwordBytes?.fill(0);
    derivedKey?.fill(0);
  }
}
