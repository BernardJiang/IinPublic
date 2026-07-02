/**
 * Mobile chatroom hierarchy navigation.
 * On a 390x844 phone viewport, the user enters Global → Europe → UK → London
 * (returning to the list between rooms) while the bottom nav stays visible
 * inside the viewport and hierarchy items stay clickable.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav, afterSync, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';

const VIEWPORT = { width: 390, height: 844 };

test.describe('Mobile chatroom hierarchy navigation', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: ['--window-position=0,0', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('enter Europe, UK, London rooms on phone viewport with bottom nav visible', async () => {
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
    attachE2eBrowserTabLabel(page, 'MobileHierarchy');
    await afterSync();

    const statusBar = page.locator('#status-bar-text');
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

    const enterRoomAndReturn = async (roomId: string, expectedStatusText: string): Promise<void> => {
      const item = page.locator(`.chatroom-item[data-chatroom-id="${roomId}"]`);
      await expect(item).toBeVisible({ timeout: 15000 });
      await item.scrollIntoViewIfNeeded();
      // A successful click proves the item is not covered by the bottom nav.
      await item.click();
      await afterSync();
      await expect(statusBar).toContainText(expectedStatusText, { timeout: 15000 });
      await expectBottomNavInsideViewport();
      const backBtn = page.locator('#back-to-chatrooms');
      await expect(backBtn).toBeVisible({ timeout: 15000 });
      await backBtn.click();
      await afterNav();
    };

    // Chatrooms tab is the default view; hierarchy list shows Global level.
    await expect(page.locator('.chatroom-item[data-chatroom-id="global"]')).toBeVisible({ timeout: 20000 });
    await expectBottomNavInsideViewport();

    await enterRoomAndReturn('europe', 'Europe');
    await enterRoomAndReturn('uk', 'United Kingdom');
    await enterRoomAndReturn('london', 'London');

    // Bottom nav still works after hierarchy traversal: switch to Me tab and back.
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await expect(page.locator('#me-view.active')).toBeAttached({ timeout: 15000 });
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await expect(page.locator('.chatroom-item[data-chatroom-id="global"]')).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
