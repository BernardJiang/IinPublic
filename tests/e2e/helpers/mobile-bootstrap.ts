/**
 * Mobile-viewport variants of talks-matching-flow's `bootstrapUser` and fast-dm-setup's
 * `setupFastMatchedDm`, for specs whose whole point is a 390x844 phone viewport on one side.
 *
 * `bootstrapUser` (talks-matching-flow.ts) hardcodes a 640x1000 desktop-ish context and is
 * used by many other specs — not edited here per policy. This file duplicates the minimum
 * bootstrap steps with `isMobile`/`hasTouch`/a 390x844 viewport instead.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from './fixtures';
import { injectIdbClear, gotoWebApp } from './clear-database';
import { attachFilteredConsoleLog } from './e2e-console';
import { attachE2eBrowserTabLabel } from './e2e-tab-title';
import { afterLoad, afterNav, E2E_ASSERT_TIMEOUT_MS } from './timing';
import { webAppURLStableChatroom } from './ports';
import {
  expectTechSupportGreetingReceived,
  pinStableE2eLocation,
} from './talks-matching-flow';
import { getConversationIdBetween, openConversationViaServer, waitForServerConversationBetween } from './conversation-e2e';
import { expectCurrentUserIsOrdinaryUser } from './techsupport-contract';
import { openSettingsSection } from './settings-nav';

export const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Same bootstrap steps as talks-matching-flow's bootstrapUser, but on a 390x844 mobile context. */
export async function bootstrapMobileUser(
  browser: Browser,
  label: string,
  stageName: string,
  appReadyTimeoutMs?: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  attachFilteredConsoleLog(page, label);
  await injectIdbClear(page);
  await gotoWebApp(page, webAppURLStableChatroom(), appReadyTimeoutMs);
  await afterLoad();
  await page.click('.nav-btn[data-view="settings"]');
  await afterNav();
  await openSettingsSection(page, 'settings-section-profile');
  await page.waitForSelector('#settings-stage-name-input', { timeout: appReadyTimeoutMs ?? E2E_ASSERT_TIMEOUT_MS });
  await page.fill('#settings-stage-name-input', stageName);
  await page.locator('#settings-stage-name-input').blur();
  await afterNav();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.stageName ?? ''),
      { timeout: appReadyTimeoutMs ?? E2E_ASSERT_TIMEOUT_MS },
    )
    .toBe(stageName);
  await expectCurrentUserIsOrdinaryUser(page, stageName);
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await pinStableE2eLocation(page);
  await expectTechSupportGreetingReceived(page);
  attachE2eBrowserTabLabel(page, label);
  return { context, page };
}

export type FastMobileDmPair = {
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
 * Same outcome as fast-dm-setup's setupFastMatchedDm (two matched users + open conversation
 * overlay both sides), but B is bootstrapped on a 390x844 mobile context instead of desktop.
 * Reuses the exact same pair-direct mesh response call fast-dm-setup uses for match creation.
 */
export async function setupFastMatchedMobileDm(
  browserA: Browser,
  browserB: Browser,
  nameA: string,
  nameB: string,
): Promise<FastMobileDmPair> {
  const { bootstrapUser } = await import('./talks-matching-flow');
  const [a, b] = await Promise.all([
    bootstrapUser(browserA, nameA, nameA),
    bootstrapMobileUser(browserB, nameB, nameB),
  ]);
  const { context: contextA, page: pageA } = a;
  const { context: contextB, page: pageB } = b;

  const [userIdA, userIdB] = await Promise.all([
    pageA.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
    pageB.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '')),
  ]);
  if (!userIdA || !userIdB) {
    throw new Error(`setupFastMatchedMobileDm: missing currentUser id (A=${userIdA} B=${userIdB})`);
  }

  const talkId = `fast-mobile-dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const talkTitle = `Fast Mobile DM Setup Talk ${talkId}`;

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
        title: `Fast Mobile DM Setup Talk ${tid}`,
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

/** Best-effort teardown mirroring fast-dm-setup's teardownFastDmPair. */
export async function teardownFastMobileDmPair(pair: Partial<FastMobileDmPair>): Promise<void> {
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
