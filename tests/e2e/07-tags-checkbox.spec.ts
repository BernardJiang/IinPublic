import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import * as fs from 'fs';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from './helpers/timing';
import { gunBaseURL, webBaseURL, e2eTestScreenshotsDir } from './helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from './helpers/talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';

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
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserAlice = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
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
    await clearGunDatabases();
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
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await afterAction();
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await afterNav();

    const headerStageName = page.locator('[data-testid="user-stage-name"]');
    await expect(headerStageName).toContainText(stageName);

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    return { context, page };
  }

  async function waitForNotification(page: Page, contains: string, label: string): Promise<void> {
    const locator = page.getByText(contains, { exact: false }).first();
    await expect(locator).toBeVisible({ timeout: 15000 });
    console.log(`✅ ${label} saw notification: "${contains}"`);
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
    await pageAlice.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
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

    await pageAlice.click('#broadcast-talk-btn');

    await confirmBroadcastTagPreambleIfVisible(pageAlice);
    await afterAction();
    // Poll server until Tom has received both tags (broadcast takes time to register)
    const tomUserId = await pageTom.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    await expect
      .poll(
        async () => {
          const res = await pageAlice.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}/incoming-talks`,
          );
          if (!res.ok()) return 0;
          return (await res.json() as any[]).length;
        },
        { message: 'Tom should have incoming talks after broadcast', timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // 4) Tom opens Coffee tag, checks checkbox, submits → match
    console.log('\n📍 STEP 4: Tom opens Coffee, checks checkbox, submits → match');
    await openIncomingTalkModal(pageTom, TAG_COFFEE);
    await expect(pageTom.locator('.tag-match-checkbox')).toBeVisible();
    await pageTom.locator('#tag-match-checkbox').check();
    await pageTom.click('#tag-submit-btn');
    await expect(pageTom.getByText('Match!').first()).toBeVisible({ timeout: 15000 });
    await waitForResponseModalClosed(pageTom);

    // 5) Alice sees match notification for Coffee (one match)
    await expect(pageAlice.getByText('Match!').first()).toBeVisible({ timeout: 15000 });

    // 6) Tom opens Cat tag, leaves checkbox unchecked, submits → ignore
    console.log('\n📍 STEP 6: Tom opens Cat, leaves checkbox unchecked → ignore');
    await openIncomingTalkModal(pageTom, TAG_CAT);
    await pageTom.click('#tag-submit-btn');
    await waitForResponseModalClosed(pageTom);

    // 7) Alice confirms one match: Talks tab shows "Matched with: Tom" for Coffee; status shows 1 match
    await pageAlice.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(pageAlice.getByText(/Matched with:/).first()).toBeVisible({ timeout: 10000 });
    const statusBar = pageAlice.locator('#status-bar-text');
    await expect(statusBar).toContainText(/1 match(es)?/, { timeout: 15000 });

    // 8) Tom's Answer tab: Coffee = Match, Cat = Mismatch
    await pageTom.click('.nav-btn[data-view="answers"]');
    await afterSync();
    const tomContent = pageTom.locator('#answers-content');
    await expect(tomContent.getByText(TAG_COFFEE).first()).toBeVisible({ timeout: 10000 });
    await expect(tomContent.getByText(TAG_CAT).first()).toBeVisible({ timeout: 10000 });
    await expect(tomContent.getByText(/Match/).first()).toBeVisible({ timeout: 10000 });
    await expect(tomContent.getByText(/Mismatch/).first()).toBeVisible({ timeout: 10000 });

    console.log('✅ Tag flow verified: Alice created Coffee + Cat; Tom matched Coffee, ignored Cat; Alice received one match.');
  });
});
