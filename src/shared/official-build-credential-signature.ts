/**
 * Verifies an OfficialBuildCredential's `verifierSignature` (scenario 2, §16.5) against a
 * verifier's published public key — runs on the RECEIVING peer's side (evaluateBuildTrust's
 * `verifySignature` callback), inside the WebView/browser JS context during a P2P handshake, so
 * it must be portable the same way `portable-ecdsa.ts` already is (no reliable `crypto.subtle`
 * across every environment this app runs in — same root cause, see that file's header).
 *
 * The verifier signs with Node's `crypto.sign('sha256', data, {key, dsaEncoding:'der'})`
 * (`attestation-verifier-key-custody.js`) over a P-256 SPKI PEM key — a different key/signature
 * *format* than `portable-ecdsa.ts` handles (that one is Gun SEA's own x.y-JWK-string pub +
 * compact r||s signatures), so this is a sibling module, not a reuse of that one's functions:
 * same underlying curve library (`@noble/curves`, already a dependency), different wire shapes.
 *
 * Verified against real Node-generated keys/signatures before writing this file's logic into
 * production code (not assumed): a P-256 SPKI DER is always 91 bytes, and the last 65 are
 * exactly the raw uncompressed EC point (0x04 || x || y) `@noble/curves` needs — and
 * `p256.verify(derSignature, digest, point, { format: 'der' })` verifies a DER signature
 * directly, no manual ASN.1 unwrapping needed for the signature itself.
 */

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

const STANDARD_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Manual standard-base64 decoder — deliberately avoids `Buffer` (not a browser global) and
 * `atob` (not guaranteed available in every JS environment this shared module could run in,
 * mirroring portable-ecdsa.ts's own stated rationale) so it works identically everywhere. */
function base64ToBytes(input: string): Uint8Array {
  const clean = String(input || '').replace(/[^A-Za-z0-9+/]/g, '');
  const byteLength = Math.floor((clean.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;
  for (const char of clean) {
    const value = STANDARD_BASE64_ALPHABET.indexOf(char);
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

/** Strips PEM armor and decodes the base64 body to raw DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return base64ToBytes(body);
}

/** A P-256 SPKI DER is always exactly 91 bytes (26-byte fixed algorithm-identifier header + a
 * 1-byte unused-bits-count + the 65-byte uncompressed point 0x04||x||y) — this holds for every
 * P-256 SPKI key regardless of the specific value, since the header encodes only the fixed OIDs
 * (id-ecPublicKey, prime256v1), never key-specific data. Verified against real
 * crypto.generateKeyPairSync('ec', {namedCurve:'P-256', ...}) output before relying on it. */
function extractP256PointFromSpkiPem(publicKeyPem: string): Uint8Array {
  const der = pemToDer(publicKeyPem);
  if (der.length !== 91) {
    throw new Error(`unexpected P-256 SPKI DER length ${der.length} (expected 91)`);
  }
  const point = der.subarray(der.length - 65);
  if (point[0] !== 0x04) {
    throw new Error('SPKI does not end in an uncompressed EC point (0x04 prefix)');
  }
  return point;
}

/**
 * Verifies `signatureBase64` (base64 DER ECDSA/SHA-256, as produced by
 * `attestation-verifier-key-custody.js`'s `signWithVerifierKey`) over `data` against a verifier's
 * P-256 SPKI public key PEM. Never throws — a malformed key/signature is a verification failure
 * (returns false), not an exception; this data crosses a trust boundary (a peer's own claim) and
 * must degrade gracefully, matching `evaluateBuildTrust`'s expected `SignatureVerifier` contract.
 */
export function verifyOfficialBuildCredentialSignature(
  publicKeyPem: string,
  data: string,
  signatureBase64: string,
): boolean {
  try {
    const point = extractP256PointFromSpkiPem(publicKeyPem);
    const digest = sha256(new TextEncoder().encode(data));
    const signature = base64ToBytes(signatureBase64);
    return p256.verify(signature, digest, point, { format: 'der' });
  } catch {
    return false;
  }
}
