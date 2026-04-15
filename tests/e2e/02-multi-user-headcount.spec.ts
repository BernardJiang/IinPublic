import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { wait, afterLoad, afterSync, afterNav, delay, headless } from './helpers/timing';

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

  test.beforeAll(async () => {
    await clearGunDatabases();
    browser1 = await chromium.launch({
      headless,
      slowMo: delay(50, 150),
      args: ['--window-position=0,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browser2 = await chromium.launch({
      headless,
      slowMo: delay(50, 150),
      args: ['--window-position=640,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
    browser3 = await chromium.launch({
      headless,
      slowMo: delay(50, 150),
      args: ['--window-position=1280,0', '--window-size=640,1000', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser1) await browser1.close();
    if (browser2) await browser2.close();
    if (browser3) await browser3.close();
    await clearGunDatabases();
  });

  test('Three users enter sequentially, exit FIFO, re-enter random order', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/02-multi-user');
    const storageDir = path.join(__dirname, '../../test-storage');
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
    page1.on('console', (m) => console.log('[User1]:', m.text()));
    await injectIdbClear(page1);
    await page1.goto('/');
    await page1.waitForLoadState('load');
    await ensureWindowFitsViewport(page1, 640, 800);
    await afterLoad();
    await expectHeadcount(page1, 1, 'User 1');

    context2 = await newContext(browser2);
    page2 = await context2.newPage();
    page2.on('console', (m) => console.log('[User2]:', m.text()));
    await injectIdbClear(page2);
    await page2.goto('/');
    await page2.waitForLoadState('load');
    await ensureWindowFitsViewport(page2, 640, 800);
    await afterLoad();
    await expectHeadcount(page1, 2, 'User 1');
    await expectHeadcount(page2, 2, 'User 2');

    context3 = await newContext(browser3);
    page3 = await context3.newPage();
    page3.on('console', (m) => console.log('[User3]:', m.text()));
    await injectIdbClear(page3);
    await page3.goto('/');
    await page3.waitForLoadState('load');
    await ensureWindowFitsViewport(page3, 640, 800);
    await afterLoad();
    await expectHeadcount(page1, 3, 'User 1');
    await expectHeadcount(page2, 3, 'User 2');
    await expectHeadcount(page3, 3, 'User 3');

    await cleanupUser(page1, 'User 1');
    await context1.storageState({ path: storage1Path });
    await page1.close();
    await context1.close();
    await afterSync();
    await expectHeadcount(page2, 2, 'User 2');
    await expectHeadcount(page3, 2, 'User 3');

    await cleanupUser(page2, 'User 2');
    await context2.storageState({ path: storage2Path });
    await page2.close();
    await context2.close();
    await afterSync();
    await wait(2000, 5000);
    await expectHeadcount(page3, 1, 'User 3');

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
    page2.on('console', (m) => console.log('[User2]:', m.text()));
    await page2.goto('/');
    await page2.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    await expectHeadcount(page2, 1, 'User 2');

    context3 = await browser3.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage3Path,
    });
    page3 = await context3.newPage();
    page3.on('console', (m) => console.log('[User3]:', m.text()));
    await page3.goto('/');
    await page3.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    await expectHeadcount(page2, 2, 'User 2');
    await expectHeadcount(page3, 2, 'User 3');

    context1 = await browser1.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      storageState: storage1Path,
    });
    page1 = await context1.newPage();
    page1.on('console', (m) => console.log('[User1]:', m.text()));
    await page1.goto('/');
    await page1.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    await expectHeadcount(page1, 3, 'User 1');
    await expectHeadcount(page2, 3, 'User 2');
    await expectHeadcount(page3, 3, 'User 3');

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
