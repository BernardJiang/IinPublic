import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { GRID_PLACES, gridRoomIdAt, openGridRoomAt } from '../../helpers/chatroom-nav';

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

  test('user can travel Global → London grid → Tokyo grid → Global, then return home to the San Diego grid', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'travel');
    await afterSync();

    // Travel targets are coarse GPS grid rooms (map tap), not continent/country/state rooms.
    const travelTo = async (place: { latitude: number; longitude: number } | 'global', statusText: string): Promise<void> => {
      if (place === 'global') {
        await page.click('.chatroom-item[data-chatroom-id="global"]');
        await afterSync();
      } else {
        await openGridRoomAt(page, place);
      }
      await expect(page.locator('#status-bar-text')).toContainText(statusText, { timeout: 45_000 });
      await expect(page.locator('#back-to-chatrooms')).toBeVisible({ timeout: 45_000 });
      await page.click('#back-to-chatrooms');
      await afterSync();
    };

    // Start in Global; the tree is Global → continents → grid rooms — no country/state rooms.
    await expect(page.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', {
      timeout: 45_000,
    });
    // Region rooms are L1 tiles labeled by continent; no country/state rooms.
    await expect(page.locator('.chatroom-item[data-chatroom-id="tile_1_2_1"]')).toContainText('North America');
    await expect(page.locator('.chatroom-item[data-chatroom-id="usa"]')).toHaveCount(0);

    await expect(page.locator('#return-home-btn')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#return-home-btn')).toBeEnabled({ timeout: 45_000 });

    await travelTo('global', 'Global');
    await travelTo(GRID_PLACES.london, 'Near London');
    // One travel room at a time: the London grid room is the current row, and only it.
    await expect(page.locator(`.chatroom-item.current-room[data-chatroom-id="${gridRoomIdAt(GRID_PLACES.london)}"]`)).toBeVisible();
    await travelTo(GRID_PLACES.tokyo, '°N');
    await travelTo('global', 'Global');

    await page.click('#return-home-btn');
    await afterSync();
    await expect(page.locator('#status-bar-text')).toContainText('San Diego', { timeout: 45000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
