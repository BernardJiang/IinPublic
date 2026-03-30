/**
 * Bridge for Playwright e2e: use the same talk id / identity rules as the app (src/shared/talk-content-id).
 *
 * Example (strict id check once you build a minimal talk-shaped object):
 *   import { computeTalkIdFromTalkData } from './helpers/talk-content-id';
 *   expect(await row.getAttribute('data-talk-id')).toBe(computeTalkIdFromTalkData({ type: 'matching', questions: [...] }));
 */
export {
  computeTalkIdFromTalkData,
  buildTalkIdentityKey,
  DEFAULT_TALK_CONTENT_ID_OPTIONS,
  type TalkContentIdOptions,
} from '../../../src/shared/talk-content-id';
