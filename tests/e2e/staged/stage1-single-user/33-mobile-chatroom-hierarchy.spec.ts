/**
 * Mobile chatroom navigation.
 * On a 390x844 phone viewport, the user opens their Nearby room from the flat list, returns, and
 * repeats it, while the bottom nav stays inside the viewport and the row stays clickable. (The
 * Global → region tile tree this used to walk is retired.)
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav, afterSync, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';

const VIEWPORT = { width: 390, height: 844 };

test.describe('Mobile chatroom navigation', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('open and leave the Nearby room on a phone viewport with the bottom nav visible', async () => {
    context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'MobileNav');
    await afterSync();

    const bottomNav = page.locator('.bottom-nav');

    const expectBottomNavInsideViewport = async (): Promise<void> => {
      await expect(bottomNav).toBeVisible({ timeout: 15000 });
      const box = await bottomNav.boundingBox();
      expect(box).toBeTruthy();
      if (box) {
        expect(box.y).toBeGreaterThan(0);
        expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height + 1);
        expect(box.width).toBeLessThanOrEqual(VIEWPORT.width + 1);
      }
    };

    const enterRoomAndReturn = async (): Promise<void> => {
      // Nearby has no room row (design §3.7); its detail opens the way the app opens it.
      await openCurrentChatroom(page);
      await afterSync();
      await expect(page.locator('#chatroom-detail-container')).toBeVisible({ timeout: 15000 });
      await expectBottomNavInsideViewport();
      const backBtn = page.locator('#back-to-chatrooms');
      await expect(backBtn).toBeVisible({ timeout: 15000 });
      await backBtn.click();
      await afterNav();
      await expect(page.locator('#chatroom-list-container')).toBeVisible({ timeout: 15000 });
    };

    // Chatrooms tab is the default view: the flat list with the user's Nearby people.
    await expect(page.locator('[data-testid="nearby-people-section"]')).toBeVisible({ timeout: 20000 });
    await expectBottomNavInsideViewport();

    await enterRoomAndReturn();
    await enterRoomAndReturn();

    // Bottom nav still works after room navigation: switch to Me tab and back.
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(page.locator('#me-view.active')).toBeAttached({ timeout: 15000 });
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await expect(page.locator('[data-testid="nearby-people-section"]')).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
