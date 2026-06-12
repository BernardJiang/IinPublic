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

export function buildUserTagsEnvelope(
  interests: Array<Partial<Tag> & { weight?: number }> | undefined,
  now: Date = new Date(),
): UserTagsEnvelope {
  const tags = buildUserTagWeightMap(interests);
  const hash = hashIdentityPayload(canonicalSerialize(tags));
  return {
    version: USER_TAGS_VERSION,
    hash,
    tags,
    updatedAt: now.toISOString(),
  };
}
