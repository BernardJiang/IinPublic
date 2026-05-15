import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, delay, headless } from './helpers/timing';
import { webBaseURL } from './helpers/ports';
import { attachE2eBrowserTabLabel } from './helpers/e2e-tab-title';

test.describe('Chatrooms — return home single-room presence', () => {
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

  test('return home uses the smallest regional room for this location', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'travel');

    // Start in Global.
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1');

    await expect(page.locator('#return-home-btn')).toBeVisible();
    await expect(page.locator('#return-home-btn')).toBeEnabled();

    // Travel to North America.
    await page.click('.chatroom-item:has-text("North America")');
    await afterSync();

    // Back in list: current room should now be North America.
    await page.click('#back-to-chatrooms');
    await afterSync();
    await expect(page.locator('.chatroom-item.current-room:has-text("North America")')).toBeVisible();

    // Return home → smallest regional room for the default test location (California).
    await page.click('#return-home-btn');
    await afterSync();
    // Best-practice: assert on the authoritative, stable status bar text (not list highlight timing).
    await expect(page.locator('#status-bar-text')).toContainText('California', { timeout: 45000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
