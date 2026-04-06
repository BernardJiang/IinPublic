import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay } from './helpers/timing';

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

  async function getStatusBar(page: Page): Promise<string> {
    const bar = page.locator('#status-bar-text');
    await bar.waitFor({ state: 'visible', timeout: 5000 });
    return (await bar.textContent()) || '';
  }

  async function getHeadcount(page: Page, chatroomName: string): Promise<string> {
    const headcount = page.locator(`.chatroom-item:has-text("${chatroomName}") .chatroom-headcount`);
    await headcount.waitFor({ state: 'visible', timeout: 5000 });
    return (await headcount.textContent()) || '';
  }

  async function cleanupUser(page: Page, name: string): Promise<void> {
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    console.log(`✅ ${name} cleanup called`);
  }

  test.beforeAll(async () => {
    await clearGunDatabases();
    const launch = (x: number, y: number) =>
      chromium.launch({
        headless: false,
        slowMo: delay(50, 150),
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
    const screenshotDir = path.join(__dirname, '../../test-screenshots/03-capacity');
    const storageDir = path.join(__dirname, '../../test-storage');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

    const newContext = (b: Browser) =>
      b.newContext({ viewport: { width: 640, height: 600 }, deviceScaleFactor: 1 });

    context1 = await newContext(browser1);
    page1 = await context1.newPage();
    page1.on('console', (m) => console.log('[U1]:', m.text()));
    // Clear both localStorage and the worker's IndexedDB for a completely fresh start.
    await injectIdbClear(page1);
    await page1.goto('/');
    await page1.waitForLoadState('load');
    await ensureWindowFitsViewport(page1, 640, 600);
    await page1.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await afterLoad();

    context2 = await newContext(browser2);
    page2 = await context2.newPage();
    page2.on('console', (m) => console.log('[U2]:', m.text()));
    await injectIdbClear(page2);
    await page2.goto('/');
    await page2.waitForLoadState('load');
    await ensureWindowFitsViewport(page2, 640, 600);
    await afterLoad();

    context3 = await newContext(browser3);
    page3 = await context3.newPage();
    page3.on('console', (m) => console.log('[U3]:', m.text()));
    await injectIdbClear(page3);
    await page3.goto('/');
    await page3.waitForLoadState('load');
    await ensureWindowFitsViewport(page3, 640, 600);
    await afterLoad();

    await afterSync();
    const global1 = await getHeadcount(page1, 'Global');
    expect(global1).toContain('3');
    console.log('✅ Global at capacity (3/3)');

    context4 = await newContext(browser4);
    page4 = await context4.newPage();
    page4.on('console', (m) => console.log('[U4]:', m.text()));
    await injectIdbClear(page4);
    await page4.goto('/');
    await page4.waitForLoadState('load');
    await ensureWindowFitsViewport(page4, 640, 600);
    await afterLoad();
    await afterSync();
    await afterSync();

    const status1After = await getStatusBar(page1);
    if (!status1After.includes('North America')) {
      throw new Error(`User 1 should be bumped to North America, got: ${status1After}`);
    }
    console.log('✅ User 1 bumped to North America');

    await afterAction();
    const status1Again = await getStatusBar(page1);
    expect(status1Again).toContain('North America');

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

    context1 = await browser1.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'cap-user1.json'),
    });
    page1 = await context1.newPage();
    page1.on('console', (m) => console.log('[U1]:', m.text()));
    await page1.goto('/');
    await page1.waitForLoadState('load');
    await afterLoad();
    await afterNav();

    context2 = await browser2.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'cap-user2.json'),
    });
    page2 = await context2.newPage();
    await page2.goto('/');
    await page2.waitForLoadState('load');
    await afterLoad();

    context3 = await browser3.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'cap-user3.json'),
    });
    page3 = await context3.newPage();
    await page3.goto('/');
    await page3.waitForLoadState('load');
    await afterLoad();

    context4 = await browser4.newContext({
      viewport: { width: 640, height: 600 },
      deviceScaleFactor: 1,
      storageState: path.join(storageDir, 'cap-user4.json'),
    });
    page4 = await context4.newPage();
    await page4.goto('/');
    await page4.waitForLoadState('load');
    await afterLoad();

    await afterSync();
    const s1 = await getStatusBar(page1);
    const s2 = await getStatusBar(page2);
    const s3 = await getStatusBar(page3);
    const s4 = await getStatusBar(page4);
    expect(s1).toContain('North America');
    expect(s2).toContain('Global');
    expect(s3).toContain('Global');
    expect(s4).toContain('Global');

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
