/**
 * Lean matched-pair setup — identical match mechanics to fast-dm-setup.ts
 * (`peerMeshService.cacheTalkBody` + `app.submitTalkResponsePairDirect`), but WITHOUT
 * opening the conversation overlay on either side.
 *
 * Opening the overlay proactively fires a WebRTC `ensureConnected()` attempt that, in a
 * headless CI environment where no DataChannel forms, blocks for the full
 * P2P_WEBRTC_CONNECT_TIMEOUT_MS (10s) per side. Specs that only need "two matched users
 * with a pair-local conversation record" (e.g. offline-mailbox / recovery specs that
 * close one side immediately) pay ~20s for overlays they never use. This helper skips
 * that: Gun is authoritative, so the conversation record exists without any live channel.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { bootstrapUser } from './talks-matching-flow';
import { getConversationIdBetween, waitForServerConversationBetween } from './conversation-e2e';

export type LeanMatchedPair = {
  contextA: BrowserContext;
  contextB: BrowserContext;
  pageA: Page;
  pageB: Page;
  userIdA: string;
  userIdB: string;
  nameA: string;
  nameB: string;
  conversationId: string;
};

export async function setupLeanMatchedPair(
  browserA: Browser,
  browserB: Browser,
  nameA: string,
  nameB: string,
): Promise<LeanMatchedPair> {
  const [a, b] = await Promise.all([
    bootstrapUser(browserA, nameA, nameA),
    bootstrapUser(browserB, nameB, nameB),
  ]);
  const { context: contextA, page: pageA } = a;
  const { context: contextB, page: pageB } = b;

  const [userIdA, userIdB] = await Promise.all([
    pageA.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    pageB.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
  ]);
  if (!userIdA || !userIdB) {
    throw new Error(`setupLeanMatchedPair: missing currentUser id (A=${userIdA} B=${userIdB})`);
  }

  const talkId = `lean-dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const talkTitle = `Lean DM Setup Talk ${talkId}`;

  await pageA.evaluate(
    ({ tid, authorId, title }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const mesh = app?.peerMeshService;
      const talkDef = {
        id: tid,
        authorId,
        title,
        type: 'flow',
        questions: [
          {
            id: 'q1',
            text: 'Want to chat?',
            answers: [
              { id: 'a-match', text: 'Yes, lets chat.', isMatch: true },
              { id: 'a-ignore', text: 'No thanks.', isMatch: false, isIgnore: true },
            ],
          },
        ],
      };
      mesh?.cacheTalkBody?.(tid, talkDef);
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[tid] = { role: 'created', fullTalk: talkDef };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
    },
    { tid: talkId, authorId: userIdA, title: talkTitle },
  );

  const authorEpub = await pageA.evaluate(() => {
    const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
    return pair?.epub ?? '';
  });

  await pageB.evaluate(
    async ({ tid, authorId, authorName, authorEpub: epub }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const talkDef = {
        id: tid,
        authorId,
        authorName,
        authorEpub: epub,
        title: `Lean DM Setup Talk ${tid}`,
        type: 'flow',
        questions: [
          {
            id: 'q1',
            text: 'Want to chat?',
            answers: [
              { id: 'a-match', text: 'Yes, lets chat.', isMatch: true },
              { id: 'a-ignore', text: 'No thanks.', isMatch: false, isIgnore: true },
            ],
          },
        ],
      };
      app?.peerMeshService?.cacheTalkBody?.(tid, talkDef);
      const matchAnswers = [
        { questionId: 'q1', answerId: 'a-match', answerText: 'Yes, lets chat.', mode: 'manual', isMatch: true },
      ];
      await app.submitTalkResponsePairDirect({
        talkId: tid,
        talkData: talkDef,
        answers: matchAnswers,
        isChatbotResponse: false,
        authorId,
        authorName,
        isAutoResponse: false,
      });
    },
    { tid: talkId, authorId: userIdA, authorName: nameA, authorEpub },
  );

  await Promise.all([
    waitForServerConversationBetween(pageA, userIdA, userIdB),
    waitForServerConversationBetween(pageB, userIdB, userIdA),
  ]);
  const conversationId = await getConversationIdBetween(pageA, userIdA, userIdB);

  return { contextA, contextB, pageA, pageB, userIdA, userIdB, nameA, nameB, conversationId };
}
