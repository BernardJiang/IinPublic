/**
 * F6 (docs/testing/gui-responsiveness-audit.md): opening an incoming Talk waits on
 * `getTalkWithRetry(…, { deadlineMs })`. The deadline used to be checked only between attempts,
 * so one slow local read (up to 8 s) or a hung server fallback overran it with the user waiting.
 */
import { WebTalkService } from '../../web/services/web-talk-service';
import type { WebGunService } from '../../web/services/web-gun-service';

describe('WebTalkService.getTalkWithRetry deadline', () => {
  beforeEach(() => localStorage.clear());

  test('settles at the deadline even when a single read never answers', async () => {
    const gun = {
      getStoredPair: () => ({ pub: 'alice-sea', epub: 'alice-epub' }),
      put: async () => undefined,
      get: () => new Promise(() => undefined), // a read that never answers
    } as unknown as WebGunService;
    const svc = new WebTalkService(gun, undefined, { gunTalkRepository: false });
    const started = Date.now();
    await expect(svc.getTalkWithRetry('talk-missing', { attempts: 12, gapMs: 300, deadlineMs: 300 })).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('returns a Talk that is already local, before the deadline', async () => {
    const talk = {
      id: 'talk-1', title: 'Coffee', type: 'tag', authorId: 'alice', questions: [],
    };
    const gun = {
      getStoredPair: () => ({ pub: 'alice-sea', epub: 'alice-epub' }),
      put: async () => undefined,
      get: async (key: string) => (key === 'talks/talk-1' ? { data: JSON.stringify(talk) } : null),
    } as unknown as WebGunService;
    const svc = new WebTalkService(gun, undefined, { gunTalkRepository: false });
    await expect(svc.getTalkWithRetry('talk-1', { deadlineMs: 4_000 })).resolves.toMatchObject({ id: 'talk-1' });
  });
});
