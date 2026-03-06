import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';

test.describe('New User Edit Stage Name Test', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched Chrome browser');
  });

  test.afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  test('New user changes stage name', async () => {
    context = await browser.newContext({
      viewport: { width: 960, height: 1200 },
      deviceScaleFactor: 1,
    });

    page = await context.newPage();
    page.on('console', (msg) => console.log(`[Browser]:`, msg.text()));

    // 1) User login
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await ensureWindowFitsViewport(page, 960, 1200);
    await page.waitForTimeout(3000);
    console.log('✅ User logged in');

    const screenshotDir = path.join(__dirname, '../../test-screenshots/new-user-edit-stage-name');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    await page.screenshot({ path: path.join(screenshotDir, '01-login.png'), fullPage: true });

    // 2) Click "Me" button on navigation bar at the bottom
    console.log('⏳ Waiting for "Me" button...');
    await page.waitForSelector('.nav-btn[data-view="me"]');
    await page.click('.nav-btn[data-view="me"]');
    await page.waitForTimeout(1000);
    console.log('✅ Clicked "Me" button');
    await page.screenshot({ path: path.join(screenshotDir, '02-me-page.png'), fullPage: true });

    // 3) Click "Edit Stage Name" button
    console.log('⏳ Waiting for "Edit Stage Name" button...');
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await page.waitForTimeout(1000);
    console.log('✅ Clicked "Edit Stage Name" button');
    await page.screenshot({
      path: path.join(screenshotDir, '03-edit-stage-name-dialog.png'),
      fullPage: true,
    });

    // 4) Then enter "Tom" and save
    await page.fill('#new-stage-name', 'Tom');
    // Using css selector for submit button in form
    await page.click('#edit-stagename-form button[type="submit"]');
    await page.waitForTimeout(1000);
    console.log('✅ Entered "Tom" and saved');
    await page.screenshot({
      path: path.join(screenshotDir, '04-saved-stage-name.png'),
      fullPage: true,
    });

    // 5) Go back to chatroom tab
    await page.click('.nav-btn[data-view="chatrooms"]');
    await page.waitForTimeout(1000);
    console.log('✅ Clicked chatroom tab');
    await page.screenshot({
      path: path.join(screenshotDir, '05-chatroom-page.png'),
      fullPage: true,
    });

    // 6) New stagename appears on it
    // Wait for the header user info to show the new name
    await page.waitForFunction(() => {
      const el = document.querySelector('.header-user-info');
      return el && el.textContent && el.textContent.includes('Tom');
    });

    const stageName = await page.evaluate(() => {
      const el = document.querySelector('.header-user-info');
      return el ? el.textContent : '';
    });
    expect(stageName).toContain('Tom');
    console.log('✅ New stage name "Tom" is visible');

    await page.close();
    await context.close();
  });
});
