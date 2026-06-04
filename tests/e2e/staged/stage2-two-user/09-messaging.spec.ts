import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed, getIncomingClusterTitlesForUser } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import {
  assertGunStoredMessageBodies,
  prepareDirectP2PConversation,
} from '../../helpers/p2p-transport-e2e';

test.describe('Direct messaging between matched users', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';
  const TOM_MESSAGE = 'Hey Jerry, want to play tennis tomorrow?';
  const JERRY_REPLY = 'Sounds great! Meet at the courts at 9am?';

  test.setTimeout(420_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        '--window-position=0,0',
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
      ],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [
        ...WEBRTC_CHROMIUM_ARGS,
        '--window-position=640,0',
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
      ],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { }
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await clearGunForStage2Spec();
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('Tom and Jerry match on talk, then exchange messages', async () => {
    const talkTitle = `Tennis Partner ${Date.now()}`;
    // ── Bootstrap users ─────────────────────────────────────────────────────
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const tomUserId = await pageTom.evaluate(
      () => (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } }).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    );
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // ── Tom creates and broadcasts the talk ──────────────────────────────────
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', talkTitle);
    await selectTalkEditorType(pageTom, 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a tennis partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterNav();
    await waitForBroadcastableTalkIds(pageTom, 120_000);
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 240_000);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterSync();

    const jerryUserId = await pageJerry.evaluate(
      () => (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } }).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    );

    await expect
      .poll(
        async () => (await getIncomingClusterTitlesForUser(pageJerry, jerryUserId)).length,
        { message: 'Jerry should have incoming talks after broadcast', timeout: 120_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // ── Jerry answers — match ────────────────────────────────────────────────
    await openIncomingTalkModal(pageJerry, talkTitle);
    await pageJerry
      .locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`)
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();
    const conversationId = await prepareDirectP2PConversation(
      pageTom,
      pageJerry,
      tomUserId,
      jerryUserId,
      'Tom',
      'Jerry',
    );

    const tomInput = pageTom.locator('#conversation-message-input');
    await expect(tomInput).toBeVisible({ timeout: 10000 });
    await tomInput.fill(TOM_MESSAGE);
    await afterAction();

    await pageTom.click('#send-conversation-message');
    await afterSync();

    // Tom sees his own message
    await expect(
      pageTom.locator('#conversation-messages .message-text').filter({ hasText: TOM_MESSAGE }).first(),
    ).toBeVisible({ timeout: 10000 });

    await expect
      .poll(
        async () =>
          pageJerry
            .locator('#conversation-messages .message-text')
            .filter({ hasText: TOM_MESSAGE })
            .first()
            .isVisible()
            .catch(() => false),
        { message: "Jerry should see Tom's message", timeout: 30000 },
      )
      .toBe(true);

    // ── Jerry replies ────────────────────────────────────────────────────────
    const jerryInput = pageJerry.locator('#conversation-message-input');
    await expect(jerryInput).toBeVisible({ timeout: 10000 });
    await jerryInput.fill(JERRY_REPLY);
    await afterAction();

    await pageJerry.click('#send-conversation-message');
    await afterSync();

    // Jerry sees his own reply
    await expect(
      pageJerry.locator('#conversation-messages .message-text').filter({ hasText: JERRY_REPLY }).first(),
    ).toBeVisible({ timeout: 10000 });

    // ── Tom sees Jerry's reply (conversation overlay already open) ───────────
    await expect
      .poll(
        async () =>
          pageTom
            .locator('#conversation-messages .message-text')
            .filter({ hasText: JERRY_REPLY })
            .first()
            .isVisible()
            .catch(() => false),
        { message: "Tom should see Jerry's reply", timeout: 30000 },
      )
      .toBe(true);

    await assertGunStoredMessageBodies(pageTom, conversationId, 1, [TOM_MESSAGE, JERRY_REPLY]);
  });
});
