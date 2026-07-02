/**
 * Fast matched-DM setup for messaging-gap specs (29-32 in stage2-two-user).
 *
 * The generic 09-messaging.spec.ts flow drives the talk editor UI, the chatroom
 * broadcast button, and the incoming-talk response modal — realistic, but far too
 * slow for specs whose actual point is the message list/read-state/order behaviour
 * *after* a match already exists.
 *
 * This helper reproduces the same outcome (two matched users + an open, connected
 * direct-p2p conversation) using the same lower-level calls that
 * `tests/e2e/talks-matching/03-mesh-response-match.spec.ts` uses to prove match
 * correctness without the UI: `peerMeshService.cacheTalkBody` +
 * `app.submitTalkResponsePairDirect(...)`. No talk editor, no broadcast button, no
 * response modal — the two users go from "just logged in" to "matched conversation
 * ready for messaging" in a couple of `page.evaluate` round-trips.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { bootstrapUser } from './talks-matching-flow';
import { getConversationIdBetween, openConversationViaServer, waitForServerConversationBetween } from './conversation-e2e';

export type FastDmPair = {
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

/**
 * Bootstrap two users (in parallel) on separate browsers, then create a match between
 * them directly via the pair-direct mesh response path (bypassing talk-editor / broadcast
 * / response-modal UI), then bring up the direct-p2p WebRTC channel for both.
 *
 * Returns everything a messaging spec needs: pages, contexts, user ids/names, and the
 * deterministic conversationId with the conversation overlay already open on both sides.
 */
export async function setupFastMatchedDm(
  browserA: Browser,
  browserB: Browser,
  nameA: string,
  nameB: string,
): Promise<FastDmPair> {
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
    throw new Error(`setupFastMatchedDm: missing currentUser id (A=${userIdA} B=${userIdB})`);
  }

  const talkId = `fast-dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const talkTitle = `Fast DM Setup Talk ${talkId}`;

  // Author (A) caches the talk body on its own mesh service and records it as an owned talk.
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

  // Responder (B) submits a MATCH answer directly against the pair-direct response path —
  // same code the incoming-talk response modal calls on radio click, without the modal.
  await pageB.evaluate(
    async ({ tid, authorId, authorName, authorEpub: epub }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const talkDef = {
        id: tid,
        authorId,
        authorName,
        authorEpub: epub,
        title: `Fast DM Setup Talk ${tid}`,
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

  // Do NOT wait for a live WebRTC DataChannel here: direct-p2p is a notify/sync layer
  // on top of Gun (which is authoritative — see CLAUDE.md §"Direct P2P conversation
  // transport"). When the channel cannot connect, `sendMessage` still persists to local
  // Gun and falls back to the encrypted offline mailbox (Phase 4), which the recipient's
  // running app drains automatically (drainMailbox is polled every 3s — see app.ts
  // `startMailboxPolling`). Blocking setup on WebRTC would make every messaging spec
  // depend on a live DataChannel connecting, which is unnecessary for testing message
  // ordering/read-state/history behaviour and is not guaranteed within a test's time budget
  // on every environment.
  await Promise.all([
    waitForServerConversationBetween(pageA, userIdA, userIdB),
    waitForServerConversationBetween(pageB, userIdB, userIdA),
  ]);
  const conversationId = await getConversationIdBetween(pageA, userIdA, userIdB);
  // Open both overlays concurrently — each open proactively calls ensureConnected() once
  // (warms the WebRTC channel for real deployments); running them in parallel means the two
  // ~10s connect attempts overlap instead of serializing to ~20s when the channel can't connect.
  await Promise.all([
    openConversationViaServer(pageA, userIdA, nameB, userIdB),
    openConversationViaServer(pageB, userIdB, nameA, userIdA),
  ]);

  return {
    contextA,
    contextB,
    pageA,
    pageB,
    userIdA,
    userIdB,
    nameA,
    nameB,
    conversationId,
  };
}

/**
 * Send a DM through the real WebConversationService.sendMessage path (same call the
 * message-input "Send" button makes) via page.evaluate — skips filling/clicking the
 * input box for specs that fire many messages back-to-back.
 */
export async function sendConversationMessage(
  page: Page,
  conversationId: string,
  senderId: string,
  text: string,
): Promise<void> {
  await page.evaluate(
    async ({ cid, sid, body }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      await app.conversationService.sendMessage(cid, sid, body);
    },
    { cid: conversationId, sid: senderId, body: text },
  );
}

/**
 * Poll until a message with this exact text is visible in the open conversation overlay.
 * Works regardless of delivery path (live WebRTC notify or offline-mailbox drain).
 */
export async function waitForMessageVisible(
  page: Page,
  text: string,
  timeoutMs = 20_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  await expect
    .poll(
      () =>
        page
          .locator('#conversation-messages .message-text')
          .filter({ hasText: text })
          .first()
          .isVisible()
          .catch(() => false),
      { timeout: timeoutMs, message: `message "${text}" should become visible` },
    )
    .toBe(true);
}

/** Best-effort teardown mirroring the other stage2-two-user specs' afterAll pattern. */
export async function teardownFastDmPair(pair: Partial<FastDmPair>): Promise<void> {
  const cleanup = async (p?: Page) => {
    if (!p) return;
    try {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    } catch {
      /* ignore */
    }
  };
  await cleanup(pair.pageA);
  await cleanup(pair.pageB);
  await pair.pageA?.close().catch(() => {});
  await pair.pageB?.close().catch(() => {});
  await pair.contextA?.close().catch(() => {});
  await pair.contextB?.close().catch(() => {});
}
