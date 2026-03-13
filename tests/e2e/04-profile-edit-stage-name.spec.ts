import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterNav, afterAction, delay } from './helpers/timing';

test.describe('Profile: edit stage name', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless: false,
      slowMo: delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunDatabases();
  });

  test('New user changes stage name to Tom and sees it in header', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/04-profile');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));

    await page.goto('/');
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await afterAction();
    await page.fill('#new-stage-name', 'Tom');
    await page.click('#edit-stagename-form button[type="submit"]');
    await afterNav();

    await expect(page.locator('[data-testid="user-stage-name"]')).toContainText('Tom');
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await expect(page.locator('.header-user-info')).toContainText('Tom');

    await page.close();
    await context.close();
  });
});
