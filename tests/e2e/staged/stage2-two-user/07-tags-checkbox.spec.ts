import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom, e2eTestScreenshotsDir } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed, getIncomingClusterTitlesForUser, waitForIncomingTalkCluster } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { ensureChatroomList } from '../../helpers/chatroom-nav';

// Two real browsers, two sequential broadcast+mesh-delivery round trips, plus a P2P
// match conversation — the global default (120s at higher worker counts,
// playwright.config.ts E2E_TEST_TIMEOUT_MS) has been observed too tight for this under
// real load, timing out mid-flow (the browser then closes during its own teardown,
// surfacing as a misleading "Target page ... has been closed" on the next evaluate()
// rather than the real timeout). Match the headroom other multi-step 2-user specs give
// themselves.
test.describe.configure({ timeout: 180_000 });

test.describe('Tag: create tag, answer with checkbox (match/ignore)', () => {
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

  test('Alice creates Coffee and Cat tags, sends to Tom; Tom answers Coffee checked, Cat unchecked; Alice confirms one match (Coffee)', async () => {
    // 1) Alice and Tom enter Global
    console.log('\n📍 STEP 1: Alice and Tom enter Global');
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // 2) Alice creates tag "Coffee"
    console.log('\n📍 STEP 2: Alice creates tag "' + TAG_COFFEE + '"');
    await ensureChatroomList(pageAlice);
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterNav();

    await pageAlice.click('#create-talk-btn');
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.click('input[name="talk-type-radio"][value="tag"]');
    await afterAction();
    await pageAlice.fill('#talk-title', TAG_COFFEE);
    await pageAlice.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    // 3) Alice creates tag "Cat"
    console.log('\n📍 STEP 3: Alice creates tag "' + TAG_CAT + '"');
    await pageAlice.click('#create-talk-btn');
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.click('input[name="talk-type-radio"][value="tag"]');
    await afterAction();
    await pageAlice.fill('#talk-title', TAG_CAT);
    await pageAlice.click('#talk-editor-form button[type="submit"]');
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

    // 4) Tom opens Coffee tag, checks Match, and submits.
    console.log('\n📍 STEP 4: Tom opens Coffee and checks Match → match');
    await openIncomingTalkModal(pageTom, TAG_COFFEE);
    await expect(pageTom.locator('.tag-match-checkbox')).toBeVisible();
    await pageTom.locator('#tag-match-checkbox').click({ noWaitAfter: true });
    await pageTom.locator('#tag-submit-response').click({ noWaitAfter: true });
    await waitForResponseModalClosed(pageTom);

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

    // 6) Tom opens Cat tag, leaves the single checkbox unchecked, and submits as ignored.
    console.log('\n📍 STEP 6: Tom opens Cat, leaves checkbox unchecked → ignore');
    await openIncomingTalkModal(pageTom, TAG_CAT);
    await pageTom.locator('#tag-submit-response').click({ noWaitAfter: true });
    await waitForResponseModalClosed(pageTom);

    // 7) Alice still has exactly the match conversation after Tom ignores Cat.
    await expect
      .poll(
        async () =>
          pageAlice.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).filter((conversation: any) => conversation.otherUserName === 'Tom').length;
          }),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // 8) Tom's Answer tab: Coffee = Match, Cat = Mismatch
    // docs/TODO.md §LL.2 follow-up: rows are merged by question text; the Match/Mismatch
    // outcome is carried on the row's own data-outcome attribute, no expand-in-place popup
    // anymore — same pattern as 09-four-types-chatbot.spec.ts / 02-two-talks-status-answers.spec.ts.
    await pageTom.click('.nav-btn[data-view="me"]');
    await afterSync();
    const tomContent = pageTom.locator('#answers-content');
    const coffeeRow = tomContent.locator('.answer-talk-item').filter({ hasText: TAG_COFFEE }).first();
    await expect(coffeeRow).toBeVisible({ timeout: 10000 });
    await expect(coffeeRow).toHaveAttribute('data-outcome', 'match');

    const catRow = tomContent.locator('.answer-talk-item').filter({ hasText: TAG_CAT }).first();
    await expect(catRow).toBeVisible({ timeout: 10000 });
    await expect(catRow).toHaveAttribute('data-outcome', 'mismatch');

    console.log('✅ Tag flow verified: Alice created Coffee + Cat; Tom matched Coffee, ignored Cat; Alice received one match.');
  });
});
