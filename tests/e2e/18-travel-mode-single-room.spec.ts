import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, delay, headless } from './helpers/timing';
import { webBaseURL } from './helpers/ports';
import { attachE2eBrowserTabLabel } from './helpers/e2e-tab-title';

test.describe('Chatrooms — hierarchy travel and return home', () => {
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

  test('user can travel Global to San Diego, London back to Global, then return home to San Diego', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'travel');

    // Start in Global with the default San Diego hierarchy visible.
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1');
    await expect(page.locator('.chatroom-item[data-chatroom-id="north-america"]')).toBeVisible();
    await expect(page.locator('.chatroom-item[data-chatroom-id="usa"]')).toBeVisible();
    await expect(page.locator('.chatroom-item[data-chatroom-id="california"]')).toBeVisible();
    await expect(page.locator('.chatroom-item[data-chatroom-id="san-diego"]')).toBeVisible();

    await expect(page.locator('#return-home-btn')).toBeVisible();
    await expect(page.locator('#return-home-btn')).toBeEnabled();

    for (const roomId of ['global', 'north-america', 'usa', 'california', 'san-diego']) {
      await page.click(`.chatroom-item[data-chatroom-id="${roomId}"]`);
      await afterSync();
      await expect(page.locator('#status-bar-text')).toContainText(
        roomId === 'usa' ? 'United States' : roomId.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join(' '),
        { timeout: 45000 },
      );
      await page.click('#back-to-chatrooms');
      await afterSync();
    }

    await expect(page.locator('.chatroom-item[data-chatroom-id="london"]')).toBeVisible();
    for (const roomId of ['london', 'uk', 'europe', 'global']) {
      await page.click(`.chatroom-item[data-chatroom-id="${roomId}"]`);
      await afterSync();
      await page.click('#back-to-chatrooms');
      await afterSync();
    }

    await page.click('#return-home-btn');
    await afterSync();
    await expect(page.locator('#status-bar-text')).toContainText('San Diego', { timeout: 45000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
