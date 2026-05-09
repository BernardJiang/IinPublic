import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from './helpers/timing';
import { webBaseURL, e2eTestStorageDir } from './helpers/ports';
import { attachE2eBrowserTabLabel } from './helpers/e2e-tab-title';

/**
 * Navigate to the app with e2e_capacity=3 and e2e_fifo=true URL params so the
 * web bundle uses capacity=3 + FIFO enabled for this test, without needing a
 * separate webpack build.  The playwright.config.ts runs servers with
 * CHATROOM_MAX_CAPACITY=50 to keep other tests stable; this URL-param override
 * lets 03-capacity-eviction run in the same server process.
 */
const E2E_URL = '/?e2e_capacity=3&e2e_fifo=true';

test.describe('Capacity and eviction', () => {
  let browser1: Browser;
  let browser2: Browser;
  let browser3: Browser;
  let browser4: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let context3: BrowserContext;
  let context4: BrowserContext;
  let page1: Page;
  let page2: Page;
  let page3: Page;
  let page4: Page;

  async function expectStatusBar(page: Page, contains: string, label: string): Promise<void> {
    const bar = page.locator('#status-bar-text');
    await expect(bar, `${label} status bar should contain "${contains}"`).toContainText(contains, {
      timeout: 20000,
    });
  }

  async function expectHeadcount(page: Page, expected: number, label: string, chatroomName = 'Global'): Promise<void> {
    const headcount = page.locator(`.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`);
    await expect(headcount, `${label} should see headcount ${expected} in ${chatroomName}`).toContainText(
      expected.toString(),
      { timeout: 20000 },
    );
    console.log(`✅ ${label} sees headcount = ${expected}`);
  }

  async function cleanupUser(page: Page, name: string): Promise<void> {
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    console.log(`✅ ${name} cleanup called`);
  }

  /** Launch a new page that navigates with capacity/FIFO URL params. */
  async function newCapacityPage(context: BrowserContext, label: string): Promise<Page> {
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    // IDB clear must run before any script; addInitScript fires before page scripts.
    await injectIdbClear(page);
    await page.goto(webBaseURL() + E2E_URL);
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 640, 600);
    await afterLoad();
    attachE2eBrowserTabLabel(page, label);
    return page;
  }

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    const launch = (x: number, y: number) =>
      chromium.launch({
        headless,
        slowMo: headless ? 0 : delay(50, 150),
        args: [`--window-position=${x},${y}`, '--window-size=640,800', '--force-device-scale-factor=1'],
      });
    browser1 = await launch(0, 0);
    browser2 = await launch(640, 0);
    browser3 = await launch(0, 600);
    browser4 = await launch(640, 600);
  });

  test.afterAll(async () => {
    if (browser1) await browser1.close();
    if (browser2) await browser2.close();
    if (browser3) await browser3.close();
    if (browser4) await browser4.close();
    await clearGunDatabases();
  });

  test('Four users: Global fills to 3, fourth bumps first to North America; persistence after re-enter', async () => {
    const storageDir = e2eTestStorageDir();
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

    const newContext = (b: Browser) =>
      b.newContext({ viewport: { width: 640, height: 600 }, deviceScaleFactor: 1 });

    // --- Phase 1: Four users join sequentially; U4 should evict U1 to North America ---

    context1 = await newContext(browser1);
    page1 = await newCapacityPage(context1, 'U1');

    context2 = await newContext(browser2);
    page2 = await newCapacityPage(context2, 'U2');

    context3 = await newContext(browser3);
    page3 = await newCapacityPage(context3, 'U3');

    await afterSync();
    await expectHeadcount(page1, 3, 'U1');
    console.log('✅ Global at capacity (3/3)');

    context4 = await newContext(browser4);
    page4 = await newCapacityPage(context4, 'U4');
    await afterSync();
    await afterSync();

    // U1 should have been evicted to North America by FIFO logic
    await expectStatusBar(page1, 'North America', 'U1 after eviction');
    console.log('✅ U1 bumped to North America');

    await afterAction();
    await expectStatusBar(page1, 'North America', 'U1 stable after action');

    // Save storage states before closing
    await context1.storageState({ path: path.join(storageDir, 'cap-user1.json') });
    await context2.storageState({ path: path.join(storageDir, 'cap-user2.json') });
    await context3.storageState({ path: path.join(storageDir, 'cap-user3.json') });
    await context4.storageState({ path: path.join(storageDir, 'cap-user4.json') });

    await cleanupUser(page1, 'U1');
    await cleanupUser(page2, 'U2');
    await cleanupUser(page3, 'U3');
    await cleanupUser(page4, 'U4');
    await page1.close();
    await page2.close();
    await page3.close();
    await page4.close();
    await afterSync();

    // --- Phase 2: All four re-enter; U1 should still be in North America ---

    const reenterContext = async (browser: Browser, storageFile: string) =>
      browser.newContext({
        viewport: { width: 640, height: 600 },
        deviceScaleFactor: 1,
        storageState: path.join(storageDir, storageFile),
      });

    context1 = await reenterContext(browser1, 'cap-user1.json');
    page1 = await context1.newPage();
    page1.on('console', (m) => console.log('[U1]:', m.text()));
    await page1.goto(webBaseURL() + E2E_URL);
    await page1.waitForLoadState('load');
    await afterLoad();
    await afterNav();
    attachE2eBrowserTabLabel(page1, 'U1 re-enter');

    context2 = await reenterContext(browser2, 'cap-user2.json');
    page2 = await context2.newPage();
    await page2.goto(webBaseURL() + E2E_URL);
    await page2.waitForLoadState('load');
    await afterLoad();
    attachE2eBrowserTabLabel(page2, 'U2 re-enter');

    context3 = await reenterContext(browser3, 'cap-user3.json');
    page3 = await context3.newPage();
    await page3.goto(webBaseURL() + E2E_URL);
    await page3.waitForLoadState('load');
    await afterLoad();
    attachE2eBrowserTabLabel(page3, 'U3 re-enter');

    context4 = await reenterContext(browser4, 'cap-user4.json');
    page4 = await context4.newPage();
    await page4.goto(webBaseURL() + E2E_URL);
    await page4.waitForLoadState('load');
    await afterLoad();
    attachE2eBrowserTabLabel(page4, 'U4 re-enter');

    await afterSync();
    await expectStatusBar(page1, 'North America', 'U1 persistence check');
    await expectStatusBar(page2, 'Global', 'U2 persistence check');
    await expectStatusBar(page3, 'Global', 'U3 persistence check');
    await expectStatusBar(page4, 'Global', 'U4 persistence check');

    await cleanupUser(page1, 'U1');
    await cleanupUser(page2, 'U2');
    await cleanupUser(page3, 'U3');
    await cleanupUser(page4, 'U4');
    await page1.close();
    await page2.close();
    await page3.close();
    await page4.close();
    await context1.close();
    await context2.close();
    await context3.close();
    await context4.close();
  });
});
