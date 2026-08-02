/**
 * Multi-partner conversation list sorting: the Contacts tab's default "recent" sort
 * ranks matched peers by lastInteractionAt descending (src/web/ui/contacts-view.ts:697),
 * fed by conversation.lastMessageTime (src/web/services/local-peer-derivation.ts:159,
 * updated on every message via ui-manager.ts#syncConversationMessageSummary:7399-7400).
 *
 * NOTE: the older "conversations list" (#conversations-list / .conversation-list-item in
 * src/web/ui/conversations-view.ts) is unreachable dead code — no static HTML template
 * defines a `#conversations-list` element outside of a unit-test fixture
 * (src/test/unit/ui-extracted-modules.test.ts:302), so displayConversationsList() never
 * finds its target in the real app and silently no-ops. The Contacts tab
 * (#contacts-list / .contact-item[data-contact-user-id]) is the real, rendered, sorted
 * list — confirmed live in 06-contacts-tab.spec.ts (`#contacts-list .contact-item`). This
 * spec targets that list and its default 'recent' sort.
 *
 * Three users: C is the hub, matched with A and with B (two independent matches sharing
 * the same C). A sends C a message → A's contact row should rank above B's (most recent
 * first; B has no message yet so its lastInteractionAt falls back to conversation
 * createdAt, which is older). B then sends C a message → B's row moves above A's. Reload
 * C → order survives (Contacts render reads localStorage myConversations, which persists).
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync, reloadAppReady } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { getConversationIdBetween, waitForServerConversationBetween } from '../../helpers/conversation-e2e';

/**
 * Send a DM without waiting for the WebRTC notify leg to settle.
 *
 * `WebConversationService.sendMessage` (src/web/services/web-conversation-service.ts:215)
 * persists to Gun and echoes locally *before* it tries the WebRTC DataChannel notify
 * (direct-p2p-conversation-transport.ts:259-277); the WebRTC attempt is wrapped in its own
 * try/catch with an offline-mailbox fallback, so the promise only resolves once that ~10s
 * `ensureConnected()` timeout (or connect) finishes. In this environment no DataChannel
 * forms, so every first send on a fresh conversation pays the full 10s. Since Gun is
 * authoritative (CLAUDE.md "Direct P2P conversation transport") and the receiver's local
 * `lastMessageTime` is populated from a Gun subscription (app.ts#ensureConversationPreviewSubscription
 * -> WebConversationService#subscribeToMessages), not from the sender's WebRTC leg, the test
 * does not need to await that leg — only that the Gun write happened, which is synchronous
 * inside sendMessage before the WebRTC try/catch. Fire the call and don't await its settle.
 */
async function sendConversationMessageNoWait(
  page: Page,
  conversationId: string,
  senderId: string,
  text: string,
): Promise<void> {
  await page.evaluate(
    ({ cid, sid, body }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      // Intentionally not awaited inside the page either — just kick off the send.
      void app.conversationService.sendMessage(cid, sid, body);
    },
    { cid: conversationId, sid: senderId, body: text },
  );
}

/**
 * Same pair-direct mesh mechanics as fast-match-lean.ts's setupLeanMatchedPair, split into
 * two phases so a single hub author (C) can stage two independent matches (with A and with
 * B) without bootstrapping two brand-new users per call (setupLeanMatchedPair's shared
 * helpers always mint fresh users). Phase 1 (cheap, author-side only) runs sequentially per
 * match to avoid racing localStorage read-modify-write on the shared hub page; phase 2
 * (the responder's pair-direct submit + conversation-visible wait, the expensive part) is
 * returned as a thunk so the caller can run both matches' phase 2 concurrently.
 */
async function stageAuthorSideTalk(
  authorPage: Page,
  authorId: string,
  responderId: string,
): Promise<{ talkId: string; talkTitle: string; authorEpub: string }> {
  const talkId = `sort29-${authorId.slice(0, 6)}-${responderId.slice(0, 6)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const talkTitle = `Sorting Spec Talk ${talkId}`;

  await authorPage.evaluate(
    ({ tid, authorId: aid, title }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const talkDef = {
        id: tid,
        authorId: aid,
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
      app?.peerMeshService?.cacheTalkBody?.(tid, talkDef);
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[tid] = { role: 'created', fullTalk: talkDef };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
    },
    { tid: talkId, authorId, title: talkTitle },
  );

  const authorEpub = await authorPage.evaluate(() => {
    const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
    return pair?.epub ?? '';
  });

  return { talkId, talkTitle, authorEpub };
}

async function respondAndAwaitMatch(
  authorPage: Page,
  authorId: string,
  authorName: string,
  responderPage: Page,
  responderId: string,
  staged: { talkId: string; talkTitle: string; authorEpub: string },
): Promise<string> {
  const { talkId, authorEpub } = staged;
  await responderPage.evaluate(
    async ({ tid, authorId: aid, authorName: aname, authorEpub: epub }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const talkDef = {
        id: tid,
        authorId: aid,
        authorName: aname,
        authorEpub: epub,
        title: `Sorting Spec Talk ${tid}`,
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
        authorId: aid,
        authorName: aname,
        isAutoResponse: false,
      });
    },
    { tid: talkId, authorId, authorName, authorEpub },
  );

  await Promise.all([
    waitForServerConversationBetween(authorPage, authorId, responderId),
    waitForServerConversationBetween(responderPage, responderId, authorId),
  ]);
  return getConversationIdBetween(authorPage, authorId, responderId);
}

test.describe('Contacts tab recency sort with two independent matches sharing a hub user', () => {
  let browser: Browser;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let contextC: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;
  let pageC: Page | undefined;

  test.beforeAll(async ({ browser: fixtureBrowser, e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
    browser = fixtureBrowser;
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch {
        /* ignore */
      }
    };
    await cleanup(pageA);
    await cleanup(pageB);
    await cleanup(pageC);
    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
    await contextC?.close().catch(() => {});
    await clearGunForStage3Spec();
  });

  test('A message then B message reorders C contacts by recency; order survives reload', async () => {
    const t0 = Date.now();
    const mark = (label: string) => console.log(`[TIMING] +${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`);
    // ── Bootstrap C, A, B in parallel (all fresh users on separate contexts) ────────────
    const [c, a, b] = await Promise.all([
      bootstrapUser(browser, 'HubC', 'HubC'),
      bootstrapUser(browser, 'SpokeA', 'SpokeA'),
      bootstrapUser(browser, 'SpokeB', 'SpokeB'),
    ]);
    contextC = c.context;
    pageC = c.page;
    contextA = a.context;
    pageA = a.page;
    contextB = b.context;
    pageB = b.page;

    const [userIdC, userIdA, userIdB] = await Promise.all([
      pageC.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageA.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
      pageB.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    ]);
    expect(userIdC).toBeTruthy();
    expect(userIdA).toBeTruthy();
    expect(userIdB).toBeTruthy();
    mark('bootstrapped 3 users');

    // ── C matches with A, then C matches with B (C is the author/hub both times) ───────
    // Phase 1 (author-side talk caching on the shared hub page C) runs sequentially — it's
    // a couple of fast localStorage read-modify-writes and racing two page.evaluate calls
    // against the same 'myTalks' JSON blob risks a lost update. Phase 2 (the responder's
    // pair-direct submit + conversation-visible wait, the ~expensive part with Gun sync and
    // WebRTC-connect-attempt side effects) is independent per pair (different responder
    // pages) — run both concurrently to fit the time budget.
    const stagedCA = await stageAuthorSideTalk(pageC, userIdC, userIdA);
    const stagedCB = await stageAuthorSideTalk(pageC, userIdC, userIdB);
    mark('staged both author-side talks');
    await Promise.all([
      respondAndAwaitMatch(pageC, userIdC, 'HubC', pageA, userIdA, stagedCA),
      respondAndAwaitMatch(pageC, userIdC, 'HubC', pageB, userIdB, stagedCB),
    ]);
    mark('both matches confirmed on both sides');

    // ── C's Contacts tab shows both A and B as matched contacts ─────────────────────────
    await pageC.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageC, 'contacts');
    const rowA = pageC.locator(`.contact-item[data-contact-user-id="${userIdA}"]`);
    const rowB = pageC.locator(`.contact-item[data-contact-user-id="${userIdB}"]`);
    await expect(rowA).toBeVisible({ timeout: 15_000 });
    await expect(rowB).toBeVisible({ timeout: 15_000 });
    mark('both contact rows visible on C');

    /** Index of a contact row among all non-support .contact-item rows (0 = topmost). */
    async function contactRowIndex(userId: string): Promise<number> {
      const ids = await pageC!
        .locator('.contact-item:not([data-support-contact="true"])')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-contact-user-id')));
      return ids.indexOf(userId);
    }

    // ── A sends C a message: A's row should now rank above B's (A has a real message;
    // B's lastInteractionAt is still the match's createdAt, which is older) ─────────────
    const conversationIdCA = await getConversationIdBetween(pageC, userIdC, userIdA);
    await sendConversationMessageNoWait(pageA, conversationIdCA, userIdA, 'Hello from A');
    await afterSync();

    // Force a fresh Contacts render on C by leaving and re-entering the tab.
    await pageC.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageC.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageC, 'contacts');

    await expect
      .poll(async () => contactRowIndex(userIdA), { timeout: 20_000, message: 'A row index after A message' })
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(
        async () => {
          const idxA = await contactRowIndex(userIdA);
          const idxB = await contactRowIndex(userIdB);
          return idxA >= 0 && idxB >= 0 && idxA < idxB;
        },
        { timeout: 20_000, message: 'A should rank above B after A messages C' },
      )
      .toBe(true);
    mark('A ranked above B');

    // ── B sends C a message: B's row should now move above A's ─────────────────────────
    const conversationIdCB = await getConversationIdBetween(pageC, userIdC, userIdB);
    await sendConversationMessageNoWait(pageB, conversationIdCB, userIdB, 'Hello from B');
    await afterSync();

    await pageC.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageC.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageC, 'contacts');

    await expect
      .poll(
        async () => {
          const idxA = await contactRowIndex(userIdA);
          const idxB = await contactRowIndex(userIdB);
          return idxA >= 0 && idxB >= 0 && idxB < idxA;
        },
        { timeout: 20_000, message: 'B should rank above A after B messages C' },
      )
      .toBe(true);
    mark('B ranked above A');

    // ── Reload C: order (B above A) survives ────────────────────────────────────────────
    await reloadAppReady(pageC);
    mark('reloaded C');
    await pageC.click('.nav-btn[data-view="contacts"]');
    mark('clicked contacts after reload');
    await waitForTabActive(pageC, 'contacts');
    mark('contacts tab active after reload');
    await expect(pageC.locator(`.contact-item[data-contact-user-id="${userIdA}"]`)).toBeVisible({ timeout: 15_000 });
    mark('row A visible after reload');
    await expect(pageC.locator(`.contact-item[data-contact-user-id="${userIdB}"]`)).toBeVisible({ timeout: 15_000 });
    mark('row B visible after reload');

    const idxAAfterReload = await contactRowIndex(userIdA);
    const idxBAfterReload = await contactRowIndex(userIdB);
    expect(idxBAfterReload).toBeGreaterThanOrEqual(0);
    expect(idxAAfterReload).toBeGreaterThanOrEqual(0);
    expect(idxBAfterReload).toBeLessThan(idxAAfterReload);
  });
});
