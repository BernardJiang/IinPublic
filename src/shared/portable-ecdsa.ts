import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

/**
 * ECDSA P-256 sign/verify for environments that do not expose a working WebCrypto
 * (`crypto.subtle`) — the same problem `portable-sha256.ts` solves for hashing, one layer up.
 *
 * Root cause this exists to route around (docs/TODO.md, Priority 3 physical-device matrix):
 * `verifySignedP2PEnvelopeProof`'s use of Gun SEA's `SEA.verify`/`SEA.sign` failed with
 * `WebCrypto SHA-256 is not available` specifically on the Android app's embedded nodejs-mobile
 * server process (not the WebView, which has a working loopback-secure-context WebCrypto) — every
 * `POST /api/p2p/signaling-relay/...` request that phone's own embedded server had to verify was
 * rejected. Reproduced directly against a real device (`RNV0217207000190`/`PM1LHMA7A2707315`),
 * confirmed via the `06-seven-client-real-device-matrix.spec.ts` real-device matrix, not
 * hypothesized. Gun's `SEA.sign`/`SEA.verify` are unconditionally coupled to `shim.subtle`
 * (`node_modules/gun/sea/shim.js`) with no pure-JS fallback path, so this bypasses SEA entirely
 * for the one specific, self-contained protocol this codebase controls end to end (the P2P
 * signaling-relay envelope proof, `createSignedP2PEnvelopeProof`/`verifySignedP2PEnvelopeProof`
 * in `p2p-runtime.ts`) rather than patching a third-party dependency.
 *
 * Uses `@noble/curves` (pure JS, audited, zero native/WebCrypto dependency — same family as the
 * already-adopted `@noble/hashes`) instead. Gun SEA pairs are ordinary NIST P-256 keys exported
 * as JWK (`node_modules/gun/sea.js`'s `SEA.pair`: `pub = base64url(x) + '.' + base64url(y)`,
 * `priv = base64url(d)`), so an existing pair's `pub`/`priv` strings decode directly into the
 * raw key material `@noble/curves` expects — no new key format, no re-keying, no migration.
 * This module is sign/verify ONLY for that one existing protocol; it is not a general-purpose
 * SEA replacement and must not be used for Gun's own graph auth or `.put()` signing.
 */

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Manual base64url codec — deliberately avoids `Buffer` (not a browser global, and this file
 *  runs in the browser bundle) and `atob`/`btoa` (not available in the Node/embedded-mobile
 *  server processes this exists to support), so it works identically everywhere. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 63];
    result += BASE64URL_ALPHABET[(chunk >> 6) & 63];
    result += BASE64URL_ALPHABET[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    result += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 63];
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    result += BASE64URL_ALPHABET[(chunk >> 12) & 63];
    result += BASE64URL_ALPHABET[(chunk >> 6) & 63];
  }
  return result;
}

function base64UrlToBytes(input: string): Uint8Array {
  const clean = String(input || '').replace(/[^A-Za-z0-9\-_]/g, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;
  for (const char of clean) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value === -1) continue;
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return bytes;
}

/** Gun SEA JWK pub format: `base64url(x) + '.' + base64url(y)` → uncompressed SEC1 point
 *  (`0x04 || x || y`, 65 bytes) that `@noble/curves`'s `p256` API expects. */
function pubToUncompressedPoint(pub: string): Uint8Array {
  const [xPart, yPart] = String(pub || '').split('.');
  const x = base64UrlToBytes(xPart || '');
  const y = base64UrlToBytes(yPart || '');
  if (x.length !== 32 || y.length !== 32) {
    throw new Error('Malformed P-256 public key (expected 32-byte x/y coordinates)');
  }
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return point;
}

/** Gun SEA JWK priv format: `base64url(d)` → the raw 32-byte scalar `@noble/curves` expects. */
function privToScalar(priv: string): Uint8Array {
  const scalar = base64UrlToBytes(priv);
  if (scalar.length !== 32) {
    throw new Error('Malformed P-256 private key (expected 32-byte scalar)');
  }
  return scalar;
}

/**
 * Native WebCrypto when this process has it (browser page, worker, Android WebView on its loopback
 * secure context, modern Node). Pure-JS P-256 costs ~0.7 s per verify on an older phone, and the
 * page verifies every signalling envelope that arrives while the app starts: a 4–5 s main-thread
 * freeze on a Honor FRD (2026-11-09) that swallowed tab taps. WebCrypto did 20 sign+verify pairs
 * in 48 ms on the same phone. Signatures are the same 64-byte r||s (IEEE P1363) either way, and
 * noble's P-256 verify accepts the high-S signatures WebCrypto may produce (`lowS: false`).
 * The embedded nodejs-mobile server (no working WebCrypto) keeps the pure-JS path.
 */
let webCryptoAllowed = true;

/** Tests only: force the pure-JS path (false) or allow WebCrypto again (true). */
export function setPortableEcdsaWebCryptoForTests(allowed: boolean): void {
  webCryptoAllowed = allowed;
  verifyKeys.clear();
  signKeys.clear();
}

function webCryptoSubtle(): SubtleCrypto | undefined {
  if (!webCryptoAllowed) return undefined;
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  return subtle && typeof subtle.importKey === 'function' && typeof subtle.verify === 'function' ? subtle : undefined;
}

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const KEY_CACHE_MAX = 256;
const verifyKeys = new Map<string, Promise<CryptoKey>>();
const signKeys = new Map<string, Promise<CryptoKey>>();

function cachedKey(cache: Map<string, Promise<CryptoKey>>, id: string, make: () => Promise<CryptoKey>): Promise<CryptoKey> {
  let key = cache.get(id);
  if (!key) {
    if (cache.size >= KEY_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    key = make();
    key.catch(() => cache.delete(id));
    cache.set(id, key);
  }
  return key;
}

function verifyKey(subtle: SubtleCrypto, pub: string): Promise<CryptoKey> {
  return cachedKey(verifyKeys, pub, async () => {
    const point = pubToUncompressedPoint(pub);
    return subtle.importKey('raw', point as Uint8Array<ArrayBuffer>, ECDSA_P256, false, ['verify']);
  });
}

function signKey(subtle: SubtleCrypto, priv: string): Promise<CryptoKey> {
  return cachedKey(signKeys, priv, async () => {
    const scalar = privToScalar(priv);
    const point = p256.getPublicKey(scalar, false);
    const jwk: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      d: bytesToBase64Url(scalar),
      x: bytesToBase64Url(point.slice(1, 33)),
      y: bytesToBase64Url(point.slice(33, 65)),
      ext: false,
    };
    return subtle.importKey('jwk', jwk, ECDSA_P256, false, ['sign']);
  });
}

/** Signs `message` (already-canonicalized, e.g. via `canonicalSerialize`) with a Gun SEA pair's
 *  `priv`. Returns a base64url-encoded compact (r||s, 64-byte) signature. */
export async function portableEcdsaSign(message: string, priv: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const subtle = webCryptoSubtle();
  if (subtle) {
    try {
      const key = await signKey(subtle, priv);
      return bytesToBase64Url(new Uint8Array(await subtle.sign(ECDSA_SHA256, key, bytes)));
    } catch {
      /* this runtime's WebCrypto refused: the pure-JS path below */
    }
  }
  const scalar = privToScalar(priv);
  const signature = p256.sign(sha256(bytes), scalar);
  return bytesToBase64Url(signature.toCompactRawBytes());
}

/** Verifies a `portableEcdsaSign` signature against `message` and a Gun SEA pair's `pub`.
 *  Never throws — a malformed signature/key is a verification failure, not an exception. */
export async function portableEcdsaVerify(signature: string, message: string, pub: string): Promise<boolean> {
  try {
    const sigBytes = base64UrlToBytes(signature);
    if (sigBytes.length !== 64) return false;
    const bytes = new TextEncoder().encode(message);
    const subtle = webCryptoSubtle();
    if (subtle) {
      try {
        const key = await verifyKey(subtle, pub);
        return await subtle.verify(ECDSA_SHA256, key, sigBytes as Uint8Array<ArrayBuffer>, bytes);
      } catch {
        /* malformed key, or this runtime's WebCrypto refused: the pure-JS path decides */
      }
    }
    const point = pubToUncompressedPoint(pub);
    return p256.verify(sigBytes, sha256(bytes), point);
  } catch {
    return false;
  }
}
