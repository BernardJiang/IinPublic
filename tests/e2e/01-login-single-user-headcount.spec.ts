import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, delay, headless } from './helpers/timing';
import { webBaseURL, e2eTestScreenshotsDir } from './helpers/ports';

test.describe('Login — single user headcount', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunDatabases();
  });

  test('Single user: login, headcount 1, exit, re-login persists', async () => {
    const screenshotDir = e2eTestScreenshotsDir('01-login');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);

    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();

    const headcount = page.locator('.chatroom-item:has-text("Global") .chatroom-headcount');
    await headcount.waitFor({ state: 'visible', timeout: 5000 });
    await expect(headcount).toContainText('1');
    await page.screenshot({ path: path.join(screenshotDir, '01-first-login.png'), fullPage: true });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await afterSync();

    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1');
    await page.screenshot({ path: path.join(screenshotDir, '02-re-login.png'), fullPage: true });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
