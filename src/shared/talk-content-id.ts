/**
 * @deprecated Phase G: All exports have been consolidated into `src/shared/cid.ts`.
 * Import from `'../shared/cid'` instead of this file.
 * This file is kept as a re-export shim for backward compatibility with test files
 * that still reference it; it will be removed once all imports are updated.
 */

export {
  type TalkContentIdOptions,
  DEFAULT_TALK_CONTENT_ID_OPTIONS,
  normalizeIdentityText,
  hashIdentityPayload,
  type TalkIdentityPayload,
  buildIdentityPayloadFromTalk,
  computeTalkIdFromTalkData,
  buildTalkIdentityKey,
  canonicalIdentityKeyFromStoredCluster,
  computeTalkCIDv1,
} from './cid';
