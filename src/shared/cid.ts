/**
 * src/shared/cid.ts
 *
 * Canonical serialization and CIDv1 computation.
 *
 * Spec: REQ-LEDGER-01 — every interaction event has an id that is the CIDv1 of
 * its dag-json-encoded content, computed with sha2-256.
 *
 * CIDv1 wire format (binary):
 *   <version=1 varint> <codec varint> <multihash>
 * where multihash = <hash-fn varint> <digest-len varint> <digest bytes>
 *
 * dag-json codec: 0x0129
 * sha2-256 hash fn: 0x12, digest length: 0x20 (32 bytes)
 *
 * The resulting CIDv1 is base32-lower-case encoded (multibase prefix 'b') which
 * is the canonical string form used everywhere in the ledger.
 *
 * Uses globalThis.crypto.subtle (Web Crypto API) — available in Node 18+ and all
 * modern browsers without any additional dependencies.
 */

// ─── Multicodec / Multihash constants ────────────────────────────────────────

/** dag-json multicodec code */
const DAG_JSON_CODE = 0x0129;
/** sha2-256 multihash function code */
const SHA2_256_CODE = 0x12;
/** SHA-256 digest length in bytes */
const SHA2_256_DIGEST_LENGTH = 32;

// ─── Varint encoding ─────────────────────────────────────────────────────────

function encodeVarint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = n >>> 7;
  }
  out.push(n & 0x7f);
  return out;
}

// ─── Base32 lower-case (RFC 4648, no padding) ─────────────────────────────────

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

// ─── Canonical serialization ──────────────────────────────────────────────────

/**
 * Deterministically serialize an object to a JSON string:
 *   - keys are sorted alphabetically (deep)
 *   - undefined and null values are omitted
 *   - arrays are preserved in order
 *
 * This is the canonical form used as input for CIDv1 computation.
 */
export function canonicalSerialize(obj: unknown): string {
  return JSON.stringify(sortedReplace(obj));
}

function sortedReplace(val: unknown): unknown {
  if (val === null || val === undefined) return undefined;
  if (Array.isArray(val)) {
    return val.map(sortedReplace).filter((v) => v !== undefined);
  }
  if (typeof val === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(val as object).sort()) {
      const child = sortedReplace((val as Record<string, unknown>)[key]);
      if (child !== undefined) {
        sorted[key] = child;
      }
    }
    return sorted;
  }
  return val;
}

// ─── CIDv1 computation ────────────────────────────────────────────────────────

/**
 * Compute a CIDv1 (dag-json, sha2-256) for the given object.
 *
 * The object is first canonically serialized with `canonicalSerialize`, then
 * hashed with SHA-256 via the Web Crypto API.
 *
 * Returns the CIDv1 as a base32-lower-case multibase string (prefix 'b').
 *
 * @example
 *   const id = await computeCIDv1({ kind: 'TALK_CREATED', talkId: 'abc' });
 *   // → 'bafyreib...'
 */
export async function computeCIDv1(obj: unknown): Promise<string> {
  const canonical = canonicalSerialize(obj);
  const encoded = new TextEncoder().encode(canonical);

  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const digest = new Uint8Array(hashBuffer);

  // Multihash: <hash-fn varint> <digest-len varint> <digest>
  const multihash = new Uint8Array([
    ...encodeVarint(SHA2_256_CODE),
    ...encodeVarint(SHA2_256_DIGEST_LENGTH),
    ...digest,
  ]);

  // CIDv1 bytes: <version=1> <codec varint> <multihash>
  const cidBytes = new Uint8Array([
    ...encodeVarint(1),
    ...encodeVarint(DAG_JSON_CODE),
    ...multihash,
  ]);

  // Multibase base32-lower prefix 'b'
  return 'b' + base32Encode(cidBytes);
}

/**
 * Synchronous CID computation for environments where async is not available.
 * Uses a simple deterministic hash substitute (NOT cryptographically secure —
 * only use for testing or non-security-critical deduplication).
 *
 * Production code must use `computeCIDv1`.
 */
export function computeCIDv1Sync(obj: unknown): string {
  const canonical = canonicalSerialize(obj);
  // FNV-1a 64-bit (simulated in 32-bit pairs) as a fast deterministic hash
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c >>> 4) ^ (c << 4);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return `bsync${hex}`;
}
