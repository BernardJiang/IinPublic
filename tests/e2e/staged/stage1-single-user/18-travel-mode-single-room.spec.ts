import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Chatrooms — hierarchy travel and return home', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('user can travel Global to San Diego, London back to Global, then return home to San Diego', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'travel');
    await afterSync();

    const waitForRoomVisible = async (roomId: string): Promise<void> => {
      await expect(page.locator(`.chatroom-item[data-chatroom-id="${roomId}"]`)).toBeVisible({ timeout: 45_000 });
    };

    const roomLabelById: Record<string, string> = {
      global: 'Global',
      'north-america': 'North America',
      usa: 'United States',
      california: 'California',
      'san-diego': 'San Diego',
      london: 'London',
      uk: 'United Kingdom',
      europe: 'Europe',
    };

    const openRoomAndReturn = async (roomId: string): Promise<void> => {
      const expectedStatusText = roomLabelById[roomId] || roomId;
      await waitForRoomVisible(roomId);
      await page.click(`.chatroom-item[data-chatroom-id="${roomId}"]`);
      await afterSync();
      await expect(page.locator('#status-bar-text')).toContainText(expectedStatusText, { timeout: 45_000 });
      await expect(page.locator('#back-to-chatrooms')).toBeVisible({ timeout: 45_000 });
      await page.click('#back-to-chatrooms');
      await afterSync();
    };

    // Start in Global with the default San Diego hierarchy visible.
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', {
      timeout: 45_000,
    });
    await waitForRoomVisible('north-america');
    await waitForRoomVisible('usa');
    await waitForRoomVisible('california');
    await waitForRoomVisible('san-diego');

    await expect(page.locator('#return-home-btn')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#return-home-btn')).toBeEnabled({ timeout: 45_000 });

    for (const roomId of ['global', 'north-america', 'usa', 'california', 'san-diego']) {
      await openRoomAndReturn(roomId);
    }

    await waitForRoomVisible('london');
    for (const roomId of ['london', 'uk', 'europe', 'global']) {
      await openRoomAndReturn(roomId);
    }

    await page.click('#return-home-btn');
    await afterSync();
    await expect(page.locator('#status-bar-text')).toContainText('San Diego', { timeout: 45000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
