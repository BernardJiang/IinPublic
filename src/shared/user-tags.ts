import type { Tag } from './types';
import { canonicalSerialize, hashIdentityPayload, normalizeIdentityText } from './cid';

export const USER_TAGS_KEY = 'user-tags';
export const USER_TAGS_VERSION = 1;

export type UserTagWeightMap = Record<string, number>;

export type UserTagsEnvelope = {
  version: number;
  hash: string;
  tags: UserTagWeightMap;
  updatedAt: string;
};

function toPositiveWeight(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function normalizeTagKey(raw: unknown): string {
  return normalizeIdentityText(raw);
}

export function buildUserTagWeightMap(interests: Array<Partial<Tag> & { weight?: number }> | undefined): UserTagWeightMap {
  const out: UserTagWeightMap = {};
  for (const interest of interests || []) {
    const key = normalizeTagKey(interest?.name);
    if (!key) continue;
    const weight = toPositiveWeight((interest as any)?.weight ?? interest?.popularity ?? 1);
    out[key] = weight;
  }
  return out;
}

export function hashUserTagWeightMap(tags: UserTagWeightMap): string {
  return hashIdentityPayload(canonicalSerialize(tags));
}

export function buildUserTagsEnvelope(
  interests: Array<Partial<Tag> & { weight?: number }> | undefined,
  now: Date = new Date(),
): UserTagsEnvelope {
  const tags = buildUserTagWeightMap(interests);
  const hash = hashUserTagWeightMap(tags);
  return {
    version: USER_TAGS_VERSION,
    hash,
    tags,
    updatedAt: now.toISOString(),
  };
}

/**
 * Incremental tag-mutation transport (REQ-SIM-05/06, spec §22.4 / §22.6.2).
 *
 * A delta carries ONLY the changed keys, plus the new `version`/`hash` of the
 * full map so a receiver can (a) reject stale/out-of-order deltas by version and
 * (b) confirm convergence by hash. `weight === null` means the tag was deleted.
 */
export type UserTagWeightDelta = Record<string, number | null>;

export type UserTagsDelta = {
  version: number;
  /** hash of the FULL weight map AFTER applying this delta (convergence check) */
  hash: string;
  changed: UserTagWeightDelta;
  updatedAt: string;
};

/**
 * Compute the minimal delta between two weight maps. Returns the next envelope
 * (version bumped iff something changed) and the delta to publish. When nothing
 * changed, `delta` is `null` — the caller publishes nothing (REQ-SIM-NFR-03).
 */
export function diffUserTags(
  prev: UserTagsEnvelope,
  nextTags: UserTagWeightMap,
  now: Date = new Date(),
): { envelope: UserTagsEnvelope; delta: UserTagsDelta | null } {
  const nextHash = hashUserTagWeightMap(nextTags);
  // O(1) change detection by content hash — skip if unchanged (spec §22.6.2).
  if (nextHash === prev.hash) {
    return { envelope: prev, delta: null };
  }

  const changed: UserTagWeightDelta = {};
  for (const [tag, weight] of Object.entries(nextTags)) {
    if (prev.tags[tag] !== weight) changed[tag] = weight;
  }
  for (const tag of Object.keys(prev.tags)) {
    if (!(tag in nextTags)) changed[tag] = null;
  }

  const envelope: UserTagsEnvelope = {
    version: prev.version + 1,
    hash: nextHash,
    tags: { ...nextTags },
    updatedAt: now.toISOString(),
  };
  const delta: UserTagsDelta = {
    version: envelope.version,
    hash: nextHash,
    changed,
    updatedAt: envelope.updatedAt,
  };
  return { envelope, delta };
}

/**
 * Apply a delta to an envelope. Stale or replayed deltas (`version <= current`)
 * are rejected so cached pairwise scores never regress (spec §22.8.4 last bullet).
 * Returns the (possibly unchanged) envelope and whether it actually advanced.
 */
export function applyUserTagsDelta(
  current: UserTagsEnvelope,
  delta: UserTagsDelta,
): { envelope: UserTagsEnvelope; changed: boolean } {
  if (delta.version <= current.version) {
    return { envelope: current, changed: false };
  }
  const tags: UserTagWeightMap = { ...current.tags };
  for (const [tag, weight] of Object.entries(delta.changed)) {
    if (weight === null) delete tags[tag];
    else tags[tag] = weight;
  }
  const envelope: UserTagsEnvelope = {
    version: delta.version,
    hash: delta.hash,
    tags,
    updatedAt: delta.updatedAt,
  };
  return { envelope, changed: true };
}
