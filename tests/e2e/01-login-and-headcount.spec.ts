import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { wait, afterLoad, afterSync, afterNav, afterAction, delay } from './helpers/timing';

test.describe('Login and headcount', () => {
  let browser: Browser;
  let browser2: Browser;
  let context: BrowserContext;
  let context2: BrowserContext;
  let page: Page;
  let page2: Page;

  test.beforeAll(async () => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless: false,
      slowMo: delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
    browser2 = await chromium.launch({
      headless: false,
      slowMo: delay(50, 150),
      args: ['--window-position=960,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    if (browser2) await browser2.close();
    await clearGunDatabases();
  });

  test('Single user: login, headcount 1, exit, re-login persists', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/01-login');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));

    await page.goto('/');
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
    await page.goto('/');
    await page.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1');
    await page.screenshot({ path: path.join(screenshotDir, '02-re-login.png'), fullPage: true });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });

  test('Two users: headcount 1→2→1→2 and one room navigation', async () => {
    const screenshotDir = path.join(__dirname, '../../test-screenshots/01-login');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[User1]:', m.text()));
    await page.goto('/');
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1');

    context2 = await browser2.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page2 = await context2.newPage();
    page2.on('console', (m) => console.log('[User2]:', m.text()));
    await page2.goto('/');
    await page2.waitForLoadState('load');
    await ensureWindowFitsViewport(page2, 960, 1200);
    await afterLoad();
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', { timeout: 15000 });
    await expect(page2.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', { timeout: 15000 });

    await page2.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await wait(1000, 3000);
    await page2.close();
    await afterSync();

    // User 1 should see headcount 1 again (User 2 left); allow time for Gun to propagate
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1', { timeout: 20000 });

    page2 = await context2.newPage();
    page2.on('console', (m) => console.log('[User2]:', m.text()));
    await page2.goto('/');
    await page2.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', { timeout: 15000 });
    await expect(page2.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', { timeout: 15000 });

    // User 2 navigates to North America
    await page2.click('.chatroom-item:has-text("North America")');
    await afterSync();
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('1', { timeout: 15000 });
    await expect(page.locator('.chatroom-item:has-text("North America") .chatroom-headcount')).toContainText('1', { timeout: 15000 });
    await page2.locator('#back-to-chatrooms').waitFor({ state: 'visible', timeout: 15000 });
    await page2.click('#back-to-chatrooms');
    await afterAction();

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page2.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await page2.close();
    await context.close();
    await context2.close();
  });
});
