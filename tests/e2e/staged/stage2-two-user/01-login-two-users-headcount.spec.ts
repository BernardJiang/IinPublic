import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { wait, afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webBaseURL, e2eTestScreenshotsDir } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Login — two users headcount', () => {
  let browser: Browser;
  let browser2: Browser;
  let context: BrowserContext;
  let context2: BrowserContext;
  let page: Page;
  let page2: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
    browser2 = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=960,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    if (browser2) await browser2.close();
    await clearGunForStage2Spec();
  });

  test('Two users: headcount accounts for TechSupport baseline and one room navigation', async () => {
    const screenshotDir = e2eTestScreenshotsDir('01-login');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const supportOffset = 1;
    const globalHeadcount = (targetPage: Page) =>
      targetPage.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    const northAmericaHeadcount = (targetPage: Page) =>
      targetPage.locator('.chatroom-item[data-chatroom-id="north-america"] .chatroom-headcount');

    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[User1]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');
    await expect(globalHeadcount(page)).toContainText(String(1 + supportOffset), { timeout: 20000 });

    context2 = await browser2.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page2 = await context2.newPage();
    page2.on('console', (m) => console.log('[User2]:', m.text()));
    await injectIdbClear(page2);
    await page2.goto(webBaseURL());
    await page2.waitForLoadState('load');
    await ensureWindowFitsViewport(page2, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page2, 'User2');
    await expect(globalHeadcount(page)).toContainText(String(2 + supportOffset), { timeout: 20000 });
    await expect(globalHeadcount(page2)).toContainText(String(2 + supportOffset), { timeout: 20000 });

    await page2.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await wait(1000, 3000);
    await page2.close();
    await afterSync();

    await expect(globalHeadcount(page)).toContainText(String(1 + supportOffset), { timeout: 20000 });

    page2 = await context2.newPage();
    page2.on('console', (m) => console.log('[User2]:', m.text()));
    await page2.goto(webBaseURL());
    await page2.waitForLoadState('load');
    await afterNav();
    await afterLoad();
    attachE2eBrowserTabLabel(page2, 'User2 re-login');
    await expect(globalHeadcount(page)).toContainText(String(2 + supportOffset), { timeout: 20000 });
    await expect(globalHeadcount(page2)).toContainText(String(2 + supportOffset), { timeout: 20000 });

    await page2.click('.chatroom-item[data-chatroom-id="north-america"]');
    await afterSync();
    await expect(globalHeadcount(page)).toContainText(String(1 + supportOffset), { timeout: 20000 });
    await expect(northAmericaHeadcount(page)).toContainText('1', { timeout: 20000 });
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
