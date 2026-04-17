/**
 * Content-derived talk IDs and identity keys: same canonical Q/A payload hashes to `qa_<hex>`,
 * aligned with server incoming-cluster identity (dedupe + multi-sender).
 */

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
  questions: Array<{ text: string; answers: string[] }>;
  /** Included for tag-type talks (which have no questions) to differentiate by title. */
  title?: string;
  authorId?: string;
  createdAt?: string;
  location?: { latitude: number; longitude: number };
};

/**
 * Canonical payload from talk data: type + questions with sorted answer texts (question text order).
 * Optional fields only affect the hash when flags are true.
 */
export function buildIdentityPayloadFromTalk(
  talkData: any,
  options: TalkContentIdOptions = {},
): TalkIdentityPayload {
  const o = { ...DEFAULT_TALK_CONTENT_ID_OPTIONS, ...options };
  const type = normalizeIdentityText(talkData?.type || 'flow');
  const questions = (Array.isArray(talkData?.questions) ? talkData.questions : [])
    .map((q: any) => ({
      text: normalizeIdentityText(q?.text),
      answers: (Array.isArray(q?.answers) ? q.answers : [])
        .map((a: any) => normalizeIdentityText(a?.text))
        .sort(),
    }))
    .sort((a: { text: string }, b: { text: string }) => String(a.text).localeCompare(String(b.text)));

  const payload: TalkIdentityPayload = { type, questions };

  // Tags have no questions, so include the normalized title to differentiate them.
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

/** Stable id: `qa_` + 8 hex chars (FNV-1a of JSON payload). */
export function computeTalkIdFromTalkData(
  talkData: any,
  options: TalkContentIdOptions = {},
): string {
  const payload = buildIdentityPayloadFromTalk(talkData, options);
  const payloadJson = JSON.stringify(payload);
  return `qa_${hashIdentityPayload(payloadJson)}`;
}

/** Same as computeTalkIdFromTalkData — kept for server/readability. */
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
