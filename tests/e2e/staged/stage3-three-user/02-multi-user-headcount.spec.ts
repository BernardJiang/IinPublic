import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { maybeClearGunDatabases, injectIdbClear } from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { wait, afterLoad, afterSync, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL, e2eTestScreenshotsDir, e2eTestStorageDir } from '../../helpers/ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';

test.describe('Multi-user headcount (3 users: FIFO exit, random re-enter)', () => {
  let browser1: Browser;
  let browser2: Browser;
  let browser3: Browser;
  let context1: BrowserContext;
  let context2: BrowserContext;
  let context3: BrowserContext;
  let page1: Page;
  let page2: Page;
  let page3: Page;

  async function expectHeadcount(page: Page, expected: number, userName: string, chatroomName = 'Global'): Promise<void> {
    const headcount = page.locator(`.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`);
    await expect(headcount, `${userName} should see headcount ${expected} in ${chatroomName}`).toContainText(
      expected.toString(),
      { timeout: 20000 },
    );
    console.log(`✅ ${userName} sees headcount = ${expected}`);
  }

  async function cleanupUser(page: Page, userName: string): Promise<void> {
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    console.log(`✅ ${userName} cleanup called`);
  }

  /**
   * Drain ghost members from Global before the test launches browsers.
   *
   * The preceding 3-user spec's closed Gun peers can flush a final membership write
   * several seconds after teardown — landing mid-test and inflating Global (e.g. 3 → 6).
   * Those entries have no live peer, so they never decrement. A single pre-test clear
   * cannot catch a write that has not happened yet, so instead we poll the members
   * endpoint until Global is *stably* clean (no non-TechSupport member across several
   * consecutive reads), re-clearing whenever a stray appears. This only clears/waits
   * before any browser launches, so it cannot perturb the test's own headcount logic.
   */
  async function drainGlobalGhosts(): Promise<void> {
    const url = `${gunBaseURL()}/api/chatrooms/global/members`;
    const requiredCleanReads = 4;
    const maxReads = 20;
    let cleanStreak = 0;
    for (let i = 0; i < maxReads && cleanStreak < requiredCleanReads; i++) {
      let strays = -1;
      try {
        const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
        if (res.ok) {
          const rows = (await res.json()) as Array<{ userId?: string }>;
          strays = rows.filter((row) => row.userId && row.userId !== TECHSUPPORT_ROOT_USER_ID).length;
        }
      } catch {
        strays = -1; // endpoint not ready yet — treat as not-clean and retry
      }
      if (strays === 0) {
        cleanStreak += 1;
      } else {
        cleanStreak = 0;
        if (strays > 0) await maybeClearGunDatabases();
      }
      await wait(1500, 1500);
    }
  }

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    // A preceding spec's closed Gun peers can still flush a final write for a few
    // seconds. Drain those writes, then reseed immediately before this spec opens
    // its three fresh browser contexts; otherwise stale members inflate Global.
    await maybeClearGunDatabases();
    await wait(3500, 3500);
    await maybeClearGunDatabases();
    // Absorb any late membership flush from the previous spec's closed peers before launching.
    await drainGlobalGhosts();
    browser1 = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=0,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browser2 = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=640,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browser3 = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=1280,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser1) await browser1.close();
    if (browser2) await browser2.close();
    if (browser3) await browser3.close();
    await maybeClearGunDatabases();
  });

  test('Three users enter sequentially, exit FIFO, re-enter random order', async () => {
    const screenshotDir = e2eTestScreenshotsDir('02-multi-user');
    const storageDir = e2eTestStorageDir();
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    const storage1Path = path.join(storageDir, 'user1-state.json');
    const storage2Path = path.join(storageDir, 'user2-state.json');
    const storage3Path = path.join(storageDir, 'user3-state.json');

    const newContext = (b: Browser) =>
      b.newContext({
        viewport: { width: 640, height: 800 },
        deviceScaleFactor: 1,
      });

    context1 = await newContext(browser1);
    page1 = await context1.newPage();
    attachFilteredConsoleLog(page1, 'User1');
    await injectIdbClear(page1);
    await page1.goto(webBaseURL());
    await page1.waitForLoadState('load');
    await ensureWindowFitsViewport(page1, 640, 800);
    await afterLoad();
    attachE2eBrowserTabLabel(page1, 'User1');
    await expectHeadcount(page1, 2, 'User 1');

    context2 = await newContext(browser2);
    page2 = await context2.newPage();
    attachFilteredConsoleLog(page2, 'User2');
    await injectIdbClear(page2);
    await page2.goto(webBaseURL());
    await page2.waitForLoadState('load');
    await ensureWindowFitsViewport(page2, 640, 800);
    await afterLoad();
    attachE2eBrowserTabLabel(page2, 'User2');
    await expectHeadcount(page1, 3, 'User 1');
    await expectHeadcount(page2, 3, 'User 2');

    context3 = await newContext(browser3);
    page3 = await context3.newPage();
    attachFilteredConsoleLog(page3, 'User3');
    await injectIdbClear(page3);
    await page3.goto(webBaseURL());
    await page3.waitForLoadState('load');
    await ensureWindowFitsViewport(page3, 640, 800);
    await afterLoad();
    attachE2eBrowserTabLabel(page3, 'User3');
    await expectHeadcount(page1, 4, 'User 1');
    await expectHeadcount(page2, 4, 'User 2');
    await expectHeadcount(page3, 4, 'User 3');

    await cleanupUser(page1, 'User 1');
    await context1.storageState({ path: storage1Path });
    await page1.close();
    await context1.close();
    await afterSync();
    await expectHeadcount(page2, 3, 'User 2');
    await expectHeadcount(page3, 3, 'User 3');

    await cleanupUser(page2, 'User 2');
    await context2.storageState({ path: storage2Path });
    await page2.close();
    await context2.close();
    await afterSync();
    await wait(2000, 5000);
    await expectHeadcount(page3, 2, 'User 3');

    await cleanupUser(page3, 'User 3');
    await context3.storageState({ path: storage3Path });
    await page3.close();
    await context3.close();
    await afterSync();

    context2 = await browser2.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage2Path,
    });
    page2 = await context2.newPage();
    attachFilteredConsoleLog(page2, 'User2');
    await page2.goto(webBaseURL());
    await page2.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    attachE2eBrowserTabLabel(page2, 'User2 re-enter');
    await expectHeadcount(page2, 2, 'User 2');

    context3 = await browser3.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage3Path,
    });
    page3 = await context3.newPage();
    attachFilteredConsoleLog(page3, 'User3');
    await page3.goto(webBaseURL());
    await page3.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    attachE2eBrowserTabLabel(page3, 'User3 re-enter');
    await expectHeadcount(page2, 3, 'User 2');
    await expectHeadcount(page3, 3, 'User 3');

    context1 = await browser1.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage1Path,
    });
    page1 = await context1.newPage();
    attachFilteredConsoleLog(page1, 'User1');
    await page1.goto(webBaseURL());
    await page1.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    attachE2eBrowserTabLabel(page1, 'User1 re-enter');
    await expectHeadcount(page1, 4, 'User 1');
    await expectHeadcount(page2, 4, 'User 2');
    await expectHeadcount(page3, 4, 'User 3');

    await cleanupUser(page1, 'User 1');
    await cleanupUser(page2, 'User 2');
    await cleanupUser(page3, 'User 3');
    await page1.close();
    await page2.close();
    await page3.close();
    await context1.close();
    await context2.close();
    await context3.close();
  });
});
