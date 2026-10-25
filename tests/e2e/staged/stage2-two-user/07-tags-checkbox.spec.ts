import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webAppURLStableChatroom, e2eTestScreenshotsDir } from '../../helpers/ports';
import {
  clickIncomingTagDecision,
  getIncomingClusterTitlesForUser,
  waitForIncomingTalkCluster,
} from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { ensureChatroomList, openCurrentChatroom } from '../../helpers/chatroom-nav';
import { openTalkEditor } from '../../helpers/open-talk-editor';

// Two real browsers, two sequential broadcast+mesh-delivery round trips, plus a P2P
// match conversation — the global default (120s at higher worker counts,
// playwright.config.ts E2E_TEST_TIMEOUT_MS) has been observed too tight for this under
// real load, timing out mid-flow (the browser then closes during its own teardown,
// surfacing as a misleading "Target page ... has been closed" on the next evaluate()
// rather than the real timeout). Match the headroom other multi-step 2-user specs give
// themselves.
test.describe.configure({ timeout: 180_000 });

test.describe('Tag: create tag, answer with Like/Pass actions', () => {
  let browserAlice: Browser;
  let browserTom: Browser;
  let contextAlice: BrowserContext;
  let contextTom: BrowserContext;
  let pageAlice: Page;
  let pageTom: Page;

  const TAG_COFFEE = 'Coffee';
  const TAG_CAT = 'Cat';
  const screenshotDir = e2eTestScreenshotsDir('07-tags');

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserAlice = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched 2 Chrome browsers: Alice, Tom');
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => {
          const webApp = (window as any).__iinpublic_app;
          if (webApp?.getApp) webApp.getApp().manualCleanup();
        });
      } catch {
        // ignore
      }
    };
    await manualCleanup(pageAlice);
    await manualCleanup(pageTom);
    await pageAlice?.close();
    await pageTom?.close();
    await contextAlice?.close();
    await contextTom?.close();
    await browserAlice?.close();
    await browserTom?.close();
    await clearGunForStage2Spec();
    console.log('✅ Cleanup complete');
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      viewport: { width: 640, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (msg) => console.log(`[${label}]:`, msg.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();

    const headerStageName = page.locator('[data-testid="user-stage-name"]');
    await expect(headerStageName).toContainText(stageName);

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  test('Alice sends Coffee and Cat; Tom Likes Coffee and Passes Cat; Alice sees one match', async () => {
    // 1) Alice and Tom enter Global
    console.log('\n📍 STEP 1: Alice and Tom enter Global');
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await openCurrentChatroom(pageAlice);
    await afterSync();

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await openCurrentChatroom(pageTom);
    await afterSync();

    // 2) Alice creates tag "Coffee"
    console.log('\n📍 STEP 2: Alice creates tag "' + TAG_COFFEE + '"');
    await ensureChatroomList(pageAlice);
    await openCurrentChatroom(pageAlice);
    await afterNav();
    await pageAlice.click('.nav-btn[data-view="talks"]');
    await afterNav();

    await openTalkEditor(pageAlice);
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.click('input[name="talk-type-radio"][value="tag"]');
    await afterAction();
    await pageAlice.fill('#talk-title', TAG_COFFEE);
    await pageAlice.click('#talk-submit-btn');
    await afterSync();

    // 3) Alice creates tag "Cat"
    console.log('\n📍 STEP 3: Alice creates tag "' + TAG_CAT + '"');
    await openTalkEditor(pageAlice);
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.click('input[name="talk-type-radio"][value="tag"]');
    await afterAction();
    await pageAlice.fill('#talk-title', TAG_CAT);
    await pageAlice.click('#talk-submit-btn');
    await afterSync();

    await clickBroadcastUntilBulkAck(pageAlice);
    await afterAction();
    await waitForIncomingTalkCluster(pageTom, TAG_COFFEE, { timeout: 90_000 });
    const tomUserId = await pageTom.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    await expect
      .poll(
        async () => (await getIncomingClusterTitlesForUser(pageTom, tomUserId)).length,
        { message: 'Tom should have incoming talks after broadcast', timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // 4) Tom Likes Coffee directly from its compact tag row.
    console.log('\n📍 STEP 4: Tom Likes Coffee → match');
    const incomingCoffeeRow = pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: TAG_COFFEE });
    await clickIncomingTagDecision(pageTom, TAG_COFFEE, 'like', { timeout: 90_000 });
    await expect(incomingCoffeeRow).toHaveCount(0);

    // 5) Alice eventually sees the responder relationship as a direct P2P conversation.
    await expect
      .poll(
        async () =>
          pageAlice.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((conversation: any) => conversation.otherUserName === 'Tom');
          }),
        { timeout: 30_000, message: 'Alice should have a match conversation with Tom' },
      )
      .toBe(true);

    // 6) Tom privately Passes Cat directly from its compact tag row.
    console.log('\n📍 STEP 6: Tom Passes Cat → ignored');
    const incomingCatRow = pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: TAG_CAT });
    await clickIncomingTagDecision(pageTom, TAG_CAT, 'pass', { timeout: 90_000 });
    await expect(incomingCatRow).toHaveCount(0);

    // 7) Alice still has exactly the match conversation after Tom ignores Cat.
    // Same `myConversations` read as step 5's identical check just above (30s there) — this one
    // was left at 10s, an outlier among this file's other Gun-sync polls (30-90s), and it
    // reproducibly timed out in real `test:all` runs (2026-09-17) waiting on the same settle
    // delay step 5 already budgets for. Match step 5's timeout rather than a bare guess.
    await expect
      .poll(
        async () =>
          pageAlice.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).filter((conversation: any) => conversation.otherUserName === 'Tom').length;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // 8) Tom's Me tab contains the Like, while private Pass stays only in Passed/Ignored.
    await pageTom.click('.nav-btn[data-view="me"]');
    await afterSync();
    const tomContent = pageTom.locator('#answers-content');
    const coffeeRow = tomContent.locator('.answer-talk-item').filter({ hasText: TAG_COFFEE }).first();
    await expect(coffeeRow).toBeVisible({ timeout: 10000 });
    await expect(coffeeRow).toHaveAttribute('data-outcome', 'match');

    const catRow = tomContent.locator('.answer-talk-item').filter({ hasText: TAG_CAT }).first();
    await expect(catRow).toHaveCount(0);

    console.log('✅ Tag flow verified: Alice created Coffee + Cat; Tom matched Coffee, ignored Cat; Alice received one match.');
  });
});
