import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import * as fs from 'fs';
import * as path from 'path';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL, e2eTestScreenshotsDir, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

async function readFirstUserSupportState(page: Page): Promise<{
  currentUserId: string;
  currentStageName: string;
  supportConversationCount: number;
  supportMessages: string[];
}> {
  return page.evaluate((techSupportId) => {
    const currentUser = (window as any).__iinpublic_app?.getApp?.()?.currentUser || {};
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    const supportConversations = Object.values(conversations).filter(
      (conversation: any) =>
        conversation?.supportChannel === true &&
        conversation?.otherUserId === techSupportId,
    ) as any[];
    return {
      currentUserId: String(currentUser.id || ''),
      currentStageName: String(currentUser.stageName || ''),
      supportConversationCount: supportConversations.length,
      supportMessages: supportConversations.map((conversation) => String(conversation?.lastMessage || '')),
    };
  }, TECHSUPPORT_ROOT_USER_ID);
}

async function countSupportWelcomeMessages(userId: string): Promise<number> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBeTruthy();
  const snapshot = await res.json() as { gunGraph?: Record<string, unknown> };
  const suffix = `/messages/support_welcome_${userId}`;
  return Object.keys(snapshot.gunGraph || {}).filter((soul) => soul.endsWith(suffix)).length;
}

test.describe('Login — single user headcount', () => {
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

  test('Single user: login, headcount persists with TechSupport baseline', async () => {
    const screenshotDir = e2eTestScreenshotsDir('01-login');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);

    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');

    await expect.poll(
      async () => (await readFirstUserSupportState(page)).supportConversationCount,
      { timeout: 15_000 },
    ).toBe(1);
    const firstLoginState = await readFirstUserSupportState(page);
    expect(firstLoginState.currentUserId).toBeTruthy();
    expect(firstLoginState.currentUserId).not.toBe(TECHSUPPORT_ROOT_USER_ID);
    expect(firstLoginState.currentStageName).not.toBe(TECHSUPPORT_STAGE_NAME);
    expect(firstLoginState.supportConversationCount).toBe(1);
    expect(firstLoginState.supportMessages[0]).toContain('Welcome to IinPublic');
    expect(firstLoginState.supportMessages[0]).toContain(firstLoginState.currentStageName);
    await expect.poll(
      () => countSupportWelcomeMessages(firstLoginState.currentUserId),
      { timeout: 15_000 },
    ).toBe(1);

    const expectedHeadcount = '2';
    const headcount = page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    await headcount.waitFor({ state: 'visible', timeout: 15000 });
    await expect(headcount).toContainText(expectedHeadcount, { timeout: 20000 });
    await page.screenshot({ path: path.join(screenshotDir, '01-first-login.png'), fullPage: true });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await afterSync();

    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await gotoWebApp(page, webBaseURL());
    await afterNav();
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1 re-login');
    await expect.poll(
      async () => (await readFirstUserSupportState(page)).supportConversationCount,
      { timeout: 15_000 },
    ).toBe(1);
    const reloginState = await readFirstUserSupportState(page);
    expect(reloginState.currentUserId).toBe(firstLoginState.currentUserId);
    expect(reloginState.supportConversationCount).toBe(1);
    await expect.poll(
      () => countSupportWelcomeMessages(firstLoginState.currentUserId),
      { timeout: 15_000 },
    ).toBe(1);
    await expect(page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount')).toContainText(
      expectedHeadcount,
      { timeout: 20000 },
    );
    await page.screenshot({ path: path.join(screenshotDir, '02-re-login.png'), fullPage: true });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
