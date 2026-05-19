import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL, e2eTestScreenshotsDir } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';

test.describe('Profile foundation', () => {
  let browser: Browser;
  let browserPeer: Browser;
  let context: BrowserContext;
  let contextPeer: BrowserContext;
  let page: Page;
  let peerPage: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
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
    await clearGunForStage2Spec();
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
    await nextPage.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await nextPage.waitForSelector('#settings-stage-name-input');
    await nextPage.fill('#settings-stage-name-input', stageName);
    await nextPage.locator('#settings-stage-name-input').blur();
    await afterNav();
    attachE2eBrowserTabLabel(nextPage, stageName);
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

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.selectOption('#settings-headshot-select', '😎');
    await page.selectOption('#settings-profile-languages', 'en');
    await page.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const user = app?.currentUser;
      if (!user?.id || !app?.uiManager?.onProfileChange) throw new Error('Profile callback not ready');
      await app.uiManager.onProfileChange(user.id, {
        headshot: '😎',
        languages: ['en'],
        interests: [],
        profile: [
          {
            id: 'profile_1',
            question: 'Favorite drink',
            answer: 'Coffee',
            isAuto: false,
            answeredAt: new Date(),
          },
          {
            id: 'profile_2',
            question: 'Usual city',
            answer: 'San Diego',
            isAuto: false,
            answeredAt: new Date(),
          },
        ],
      });
    });
    await afterNav();

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-profile-languages')).toHaveValue('en');
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
      .toBe('en|2');

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
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Languages: en');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Favorite drink');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Coffee');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('Usual city');
    await expect(peerPage.locator('#peer-stats-section')).toContainText('San Diego');
    await expect(peerPage.locator('#peer-stats-section .user-avatar').first()).toContainText('😎');
  });
});
