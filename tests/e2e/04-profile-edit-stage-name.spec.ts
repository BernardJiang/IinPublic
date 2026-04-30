import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import * as fs from 'fs';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterNav, afterAction, delay, headless } from './helpers/timing';
import { webBaseURL, gunBaseURL, e2eTestScreenshotsDir } from './helpers/ports';

test.describe('Profile foundation', () => {
  let browser: Browser;
  let browserPeer: Browser;
  let context: BrowserContext;
  let contextPeer: BrowserContext;
  let page: Page;
  let peerPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
    browserPeer = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=960,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    if (browserPeer) await browserPeer.close();
    await clearGunDatabases();
  });

  test.afterEach(async () => {
    await page?.close();
    await peerPage?.close();
    await context?.close();
    await contextPeer?.close();
  });

  async function bootstrapUser(targetBrowser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const nextContext = await targetBrowser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    const nextPage = await nextContext.newPage();
    await injectIdbClear(nextPage);
    await nextPage.goto(webBaseURL());
    await nextPage.waitForLoadState('load');
    await ensureWindowFitsViewport(nextPage, 960, 1200);
    await afterLoad();
    await nextPage.click('.nav-btn[data-view="me"]');
    await afterNav();
    await nextPage.waitForSelector('#edit-stagename-btn');
    await nextPage.click('#edit-stagename-btn');
    await afterAction();
    await nextPage.fill('#new-stage-name', stageName);
    await nextPage.click('#edit-stagename-form button[type="submit"]');
    await afterNav();
    return { context: nextContext, page: nextPage };
  }

  test('New user edits stage name and public profile, then peers can see it', async () => {
    const screenshotDir = e2eTestScreenshotsDir('04-profile');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    const me = await bootstrapUser(browser, 'Tom');
    context = me.context;
    page = me.page;
    page.on('console', (m) => console.log('[Tom]:', m.text()));

    await expect(page.locator('[data-testid="user-stage-name"]')).toContainText('Tom');
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await expect(page.locator('.header-user-info')).toContainText('Tom');

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.click('#edit-profile-btn');
    await afterAction();
    await page.click('label:has(input[value="😎"])');
    await page.fill('#profile-languages-input', 'en, zh');
    await page.locator('.profile-qa-row').first().locator('.profile-question-input').fill('Favorite drink');
    await page.locator('.profile-qa-row').first().locator('.profile-answer-input').fill('Coffee');
    await page.click('#add-profile-qa-btn');
    await page.locator('.profile-qa-row').nth(1).locator('.profile-question-input').fill('Usual city');
    await page.locator('.profile-qa-row').nth(1).locator('.profile-answer-input').fill('San Francisco');
    await page.click('#save-profile-btn');
    await afterNav();

    await expect(page.locator('#user-info-me')).toContainText('Languages: en, zh');
    await expect(page.locator('#user-info-me')).toContainText('Favorite drink');
    await expect(page.locator('#user-info-me')).toContainText('Coffee');
    await expect(page.locator('#user-info-me')).toContainText('Usual city');
    await expect(page.locator('#user-info-me .user-avatar').first()).toContainText('😎');
    const tomUserId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}`);
          if (!res.ok()) return 'request-failed';
          const user = await res.json() as any;
          const languages = Array.isArray(user?.languages) ? user.languages.join(',') : 'missing';
          const profileCount = Array.isArray(user?.profile) ? user.profile.length : 0;
          return `${languages}|${profileCount}`;
        },
        { timeout: 30000, message: 'public user profile should propagate to the server view' },
      )
      .toBe('en,zh|2');

    const peer = await bootstrapUser(browserPeer, 'Jerry');
    contextPeer = peer.context;
    peerPage = peer.page;
    peerPage.on('console', (m) => console.log('[Jerry]:', m.text()));

    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterNav();

    await peerPage.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await peerPage.click('.chatroom-item:has-text("Global")');
    await afterNav();

    await expect(peerPage.locator('.chatroom-member-item').filter({ hasText: 'Tom' }).first()).toBeVisible({ timeout: 15000 });
    await peerPage.locator('.chatroom-member-item').filter({ hasText: 'Tom' }).first().click();
    await afterNav();
    await expect(peerPage.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Public Profile');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Languages: en, zh');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Favorite drink');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Coffee');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Usual city');
    await expect(peerPage.locator('#peer-stats-section .user-avatar').first()).toContainText('😎');
  });
});
