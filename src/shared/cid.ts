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

// ─── Talk content identity (Phase G: consolidated from talk-content-id.ts) ───
//
// All functions from src/shared/talk-content-id.ts are now exported from this
// file. Import from 'shared/cid' instead of 'shared/talk-content-id'.
// talk-content-id.ts has been removed.
//
// computeTalkCIDv1 is the new canonical async entry point (uses real SHA-256 CIDv1).
// computeTalkIdFromTalkData / buildTalkIdentityKey are kept for backward compat in
// sync contexts (UI callbacks, talk-engine). They produce the legacy `qa_XXXXXXXX` format.

export type TalkContentIdOptions = {
  /** Include author user id in the hash (default false). */
  includeAuthorId?: boolean;
  /** Include createdAt ISO string in the hash (default false). */
  includeCreatedAt?: boolean;
  /** Include authorLocation (lat/lng rounded) in the hash (default false). */
  includeLocation?: boolean;
};

/** Default: content-only (questions + answers text), same as historical server identity key. */
export const DEFAULT_TALK_CONTENT_ID_OPTIONS: Required<TalkContentIdOptions> = {
  includeAuthorId: false,
  includeCreatedAt: false,
  includeLocation: false,
};

export function normalizeIdentityText(input: unknown): string {
  return String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** FNV-1a 32-bit — matches server IinPublicServer.hashIdentityPayload. */
export function hashIdentityPayload(payload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type TalkIdentityPayload = {
  type: string;
  language: string;
  questions: Array<{ text: string; answers: string[] }>;
  /** Included for tag-type talks (which have no questions) to differentiate by title. */
  title?: string;
  authorId?: string;
  createdAt?: string;
  location?: { latitude: number; longitude: number };
};

/**
 * Canonical payload from talk data: type + language + questions with sorted answer texts.
 * Optional fields only affect the hash when flags are true.
 */
export function buildIdentityPayloadFromTalk(
  talkData: any,
  options: TalkContentIdOptions = {},
): TalkIdentityPayload {
  const o = { ...DEFAULT_TALK_CONTENT_ID_OPTIONS, ...options };
  const type = normalizeIdentityText(talkData?.type || 'flow');
  const language = normalizeIdentityText(talkData?.language || 'en');
  const questions = (Array.isArray(talkData?.questions) ? talkData.questions : [])
    .map((q: any) => ({
      text: normalizeIdentityText(q?.text),
      answers: (Array.isArray(q?.answers) ? q.answers : [])
        .map((a: any) => normalizeIdentityText(a?.text))
        .sort(),
    }))
    .sort((a: { text: string }, b: { text: string }) => String(a.text).localeCompare(String(b.text)));

  const payload: TalkIdentityPayload = { type, language, questions };

  if (type === 'tag' && talkData?.title) {
    payload.title = normalizeIdentityText(talkData.title);
  }
  if (o.includeAuthorId && talkData?.authorId) {
    payload.authorId = normalizeIdentityText(talkData.authorId);
  }
  if (o.includeCreatedAt && talkData?.createdAt != null) {
    const d =
      talkData.createdAt instanceof Date ? talkData.createdAt : new Date(talkData.createdAt);
    payload.createdAt = Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (o.includeLocation && talkData?.authorLocation) {
    const lat = Number(talkData.authorLocation.latitude);
    const lng = Number(talkData.authorLocation.longitude);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      payload.location = {
        latitude: Math.round(lat * 1000) / 1000,
        longitude: Math.round(lng * 1000) / 1000,
      };
    }
  }

  return payload;
}

/**
 * Stable sync id: `qa_` + 8 hex chars (FNV-1a of JSON payload).
 * Kept for backward compatibility in sync contexts (UI, talk-engine).
 * New talk creations in async contexts should use `computeTalkCIDv1`.
 */
export function computeTalkIdFromTalkData(
  talkData: any,
  options: TalkContentIdOptions = {},
): string {
  const payload = buildIdentityPayloadFromTalk(talkData, options);
  const payloadJson = JSON.stringify(payload);
  return `qa_${hashIdentityPayload(payloadJson)}`;
}

/** Alias for computeTalkIdFromTalkData — kept for server/readability. */
export function buildTalkIdentityKey(talkData: any, options?: TalkContentIdOptions): string {
  return computeTalkIdFromTalkData(talkData, options);
}

/**
 * Normalize legacy cluster keys (JSON identityKey) to canonical `qa_*` form.
 */
export function canonicalIdentityKeyFromStoredCluster(cluster: any): string {
  if (!cluster) return buildTalkIdentityKey({ type: 'flow', questions: [] });

  const key = typeof cluster.identityKey === 'string' ? cluster.identityKey : '';
  if (key.startsWith('qa_')) {
    return key;
  }

  if (key) {
    try {
      const parsed = JSON.parse(key);
      const payload = {
        type: normalizeIdentityText(parsed?.type ?? cluster?.type ?? 'flow'),
        language: normalizeIdentityText(parsed?.language ?? cluster?.language ?? 'en'),
        questions: (Array.isArray(parsed?.questions)
          ? parsed.questions.map((q: any) => ({
              text: normalizeIdentityText(q?.text),
              answers: (Array.isArray(q?.answers) ? q.answers : [])
                .map((a: any) => normalizeIdentityText(a))
                .sort(),
            }))
          : [])
          .sort((a: any, b: any) => String(a.text).localeCompare(String(b.text))),
      };
      return `qa_${hashIdentityPayload(JSON.stringify(payload))}`;
    } catch {
      // fall through
    }
  }

  return buildTalkIdentityKey(cluster);
}

// ─── Response CIDv1 (REQ-LEDGER-04/12) ──────────────────────────────────────

/**
 * Compute a CIDv1 response id from the stable response-identity triple.
 *
 * REQ-LEDGER-04: every response has a stable, content-derived id so that duplicate
 * deliveries (mesh dedup miss, queue re-send) are idempotent on both sides.
 *
 * The payload { talkId, responderId, responseContentJson } is canonically serialised
 * before hashing so the id is independent of JSON key order.
 *
 * // REQ-LEDGER-12 CIDv1: this is the v1 seam — step 9 (change-of-mind / supersession)
 * will extend the payload with a `version` counter if needed.
 */
export async function computeResponseId(opts: {
  talkId: string;
  responderId: string;
  /** Canonical JSON of the response answers array (already serialised by caller). */
  responseContentJson: string;
}): Promise<string> {
  return computeCIDv1({ talkId: opts.talkId, responderId: opts.responderId, responseContentJson: opts.responseContentJson });
}

/**
 * Synchronous fallback for contexts where async is not available.
 * Uses computeCIDv1Sync (FNV-1a, NOT cryptographic) — same caveat as computeCIDv1Sync.
 *
 * Production callers must use computeResponseId.
 */
export function computeResponseIdSync(opts: {
  talkId: string;
  responderId: string;
  responseContentJson: string;
}): string {
  return computeCIDv1Sync({ talkId: opts.talkId, responderId: opts.responderId, responseContentJson: opts.responseContentJson });
}

/**
 * Phase G — CIDv1 talk identity (REQ-LEDGER-ENTITY-IDs).
 *
 * Async replacement for `computeTalkIdFromTalkData`. Uses the same canonical
 * payload (type + language + questions/answers) but hashes with real SHA-256
 * via `computeCIDv1`, producing a proper CIDv1 base32 string instead of `qa_`.
 *
 * Use this for ALL new talk creations. Legacy `qa_` IDs continue to work for
 * backward compat during the Phase G transition window.
 */
export async function computeTalkCIDv1(talkData: any, options?: TalkContentIdOptions): Promise<string> {
  const payload = buildIdentityPayloadFromTalk(talkData, options);
  return computeCIDv1(payload);
}
