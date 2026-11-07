/**
 * The device graph's Talk body is content only: my own Talk read back from my Talk versions has
 * no `authorId`, `tags` or `isTemplate`. Since the graph answers `getTalk` first, the My Talks entry
 * must fill those fields, or a self-answer is saved with no sender (Me's 💬 then opens the Talk's
 * replies instead of my answers: e2e stage1/05-talks-edit "Self-answered own talk", found by the
 * 2026-11-07 release run).
 */
import { WebTalkService } from '../../web/services/web-talk-service';
import type { WebGunService } from '../../web/services/web-gun-service';
import { setMyTalks } from '../../web/ui/my-talks-storage';
import { resetCoreViewsForTests } from '../../web/services/core-views';

const gun = { put: async () => undefined, get: async () => null } as unknown as WebGunService;
const graphBody = {
  type: 'flow', language: 'en', title: 'Self Answer Test',
  questions: [{ id: 'q_0', text: 'Do you like tea?', answers: [{ id: 'a', text: 'Yes', isMatch: true }] }],
  graphTalkId: 'g1', graphVersionId: 'v1',
};

describe('WebTalkService.getTalk with a graph body', () => {
  beforeEach(() => { localStorage.clear(); resetCoreViewsForTests(); });

  test('fills authorId, tags and isTemplate from the My Talks entry; the graph content wins', async () => {
    setMyTalks({
      t1: {
        title: 'Self Answer Test', type: 'flow', timestamp: '2026-11-07T00:00:00.000Z', role: 'created',
        fullTalk: { id: 't1', title: 'Old title', authorId: 'me', tags: ['tea'], isTemplate: false, type: 'flow', questions: [] },
      } as any,
    });
    const svc = new WebTalkService(gun, undefined);
    svc.setGraphTalkSource(async () => ({ ...graphBody }));
    const talk = await svc.getTalk('t1');
    expect(talk).toMatchObject({ id: 't1', authorId: 'me', tags: ['tea'], title: 'Self Answer Test', graphVersionId: 'v1' });
    expect(talk?.questions).toHaveLength(1);
  });

  test('a graph body with no My Talks entry is returned as the graph has it', async () => {
    const svc = new WebTalkService(gun, undefined);
    svc.setGraphTalkSource(async () => ({ ...graphBody, authorId: 'them' }));
    await expect(svc.getTalk('t2')).resolves.toMatchObject({ id: 't2', authorId: 'them', title: 'Self Answer Test' });
  });
});
