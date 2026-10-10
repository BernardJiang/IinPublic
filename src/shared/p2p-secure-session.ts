/**
 * End-to-end session encryption above WebRTC DTLS.
 *
 * DTLS protects the hop selected by WebRTC. This layer binds fresh ECDH keys to
 * the signed IinPublic identities exchanged in the DataChannel handshake, so an
 * application frame is neither readable nor replaceable by signaling relays,
 * TURN servers, or a peer that only captured a previous session.
 */

function utf8Encode(value: string): Uint8Array {
  const escaped = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let i = 0; i < escaped.length; i += 1) {
    if (escaped[i] === '%') {
      bytes.push(Number.parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(escaped.charCodeAt(i));
    }
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes: ArrayBuffer): string {
  let escaped = '';
  for (const byte of new Uint8Array(bytes)) escaped += `%${byte.toString(16).padStart(2, '0')}`;
  return decodeURIComponent(escaped);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', asArrayBuffer(utf8Encode(value))));
}

export type SecureSessionOffer = {
  version: 1;
  ephemeralPublicKey: string;
  sessionNonce: string;
};

export type SecureSessionEndpoint = SecureSessionOffer & {
  userId: string;
  publicKey: string;
};

export type GeneratedSecureSessionOffer = {
  offer: SecureSessionOffer;
  privateKey: CryptoKey;
};

export type DerivedSecureSession = {
  key: CryptoKey;
  sessionId: string;
};

export type SecureSessionCiphertext = {
  iv: string;
  ciphertext: string;
};

/** Unknown peers have no pin; Contacts must keep matching their first pinned stable key. */
export function pinnedIdentityAccepts(pinnedPublicKey: string | undefined, observedPublicKey: string): boolean {
  return !pinnedPublicKey || pinnedPublicKey === observedPublicKey;
}

export async function generateSecureSessionOffer(): Promise<GeneratedSecureSessionOffer> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  return {
    offer: {
      version: 1,
      ephemeralPublicKey: bytesToBase64Url(rawPublicKey),
      sessionNonce: bytesToBase64Url(nonce),
    },
    privateKey: keyPair.privateKey,
  };
}

export function secureSessionTranscript(
  conversationId: string,
  local: SecureSessionEndpoint,
  remote: SecureSessionEndpoint,
): string {
  const endpoints = [local, remote]
    .map((endpoint) => ({
      userId: endpoint.userId,
      publicKey: endpoint.publicKey,
      ephemeralPublicKey: endpoint.ephemeralPublicKey,
      sessionNonce: endpoint.sessionNonce,
    }))
    .sort((a, b) => a.publicKey.localeCompare(b.publicKey));
  return JSON.stringify({ version: 1, conversationId, endpoints });
}

export async function deriveSecureSession(params: {
  conversationId: string;
  privateKey: CryptoKey;
  local: SecureSessionEndpoint;
  remote: SecureSessionEndpoint;
}): Promise<DerivedSecureSession> {
  const remoteRaw = base64UrlToBytes(params.remote.ephemeralPublicKey);
  if (remoteRaw.length !== 65) throw new Error('invalid ephemeral public key length');
  const remotePublicKey = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(remoteRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: remotePublicKey },
    params.privateKey,
    256,
  );
  const transcript = secureSessionTranscript(params.conversationId, params.local, params.remote);
  const transcriptHash = await sha256(transcript);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asArrayBuffer(transcriptHash),
      info: asArrayBuffer(utf8Encode('iinpublic/p2p-secure-session/v1')),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, sessionId: bytesToBase64Url(transcriptHash) };
}

function sessionAad(sessionId: string): Uint8Array {
  return utf8Encode(`iinpublic/p2p-secure-frame/v1/${sessionId}`);
}

export async function encryptSecureSessionJson(
  key: CryptoKey,
  sessionId: string,
  value: unknown,
): Promise<SecureSessionCiphertext> {
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8Encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(ivBytes), additionalData: asArrayBuffer(sessionAad(sessionId)), tagLength: 128 },
    key,
    asArrayBuffer(plaintext),
  );
  return { iv: bytesToBase64Url(ivBytes), ciphertext: bytesToBase64Url(new Uint8Array(encrypted)) };
}

export async function decryptSecureSessionJson<T>(
  key: CryptoKey,
  sessionId: string,
  encrypted: SecureSessionCiphertext,
): Promise<T> {
  const iv = base64UrlToBytes(encrypted.iv);
  if (iv.length !== 12) throw new Error('invalid AES-GCM IV length');
  const ciphertext = base64UrlToBytes(encrypted.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: asArrayBuffer(sessionAad(sessionId)), tagLength: 128 },
    key,
    asArrayBuffer(ciphertext),
  );
  return JSON.parse(utf8Decode(plaintext)) as T;
}
