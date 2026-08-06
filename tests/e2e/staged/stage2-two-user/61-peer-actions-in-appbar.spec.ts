/**
 * Peer actions in the AppBar (redesign §5, T5): 📤 Send-My-Talks sits inline in the
 * User layout's AppBar; 🚫 Block lives under the ⋯ overflow (destructive); testids
 * are preserved; block/unblock from the bar works (cross-check with 15b's flow).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { webAppURLStableChatroom, gunBaseURL } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe.configure({ timeout: 120_000 });

test.describe('Peer actions in AppBar', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserJerry = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  async function bootstrap(browser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterSync();
    return { context, page };
  }

  test('📤 inline, 🚫 under ⋯; block from the bar takes effect and testids survive', async () => {
    ({ context: contextTom, page: pageTom } = await bootstrap(browserTom, 'TomBar'));
    ({ context: contextJerry, page: pageJerry } = await bootstrap(browserJerry, 'JerryBar'));
    const tom = pageTom!;
    const jerry = pageJerry!;
    const tomId = await tom.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const jerryId = await jerry.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);

    await tom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
    const jerryRow = tom.locator(`.chatroom-member-item[data-user-id="${jerryId}"]`);
    await expect(jerryRow).toBeVisible({ timeout: 15_000 });
    await jerryRow.click();
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await tom.click('#back-from-conversation');
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible();

    // 📤 renders inline in the AppBar's right zone with its testid.
    const sendBtn = tom.locator('#peer-detail-overlay .app-bar [data-testid="peer-send-talks-btn"]');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn.locator('.app-bar-btn-icon')).toHaveText('📤');

    // 🚫 is NOT inline — it lives under the ⋯ overflow panel (destructive action).
    const blockBtn = tom.locator('[data-testid="peer-block-user-btn"]');
    await expect(blockBtn).toBeHidden();
    await tom.click('#peer-overflow-btn');
    await expect(tom.locator('#peer-overflow-panel')).toBeVisible();
    await expect(blockBtn).toBeVisible();
    await expect(blockBtn).toContainText('Block User');

    // Blocking from the bar takes real effect (server block edge appears — 15b's signal).
    await blockBtn.click();
    await expect(tom.locator('#peer-detail-overlay')).toBeHidden({ timeout: 10_000 });
    await expect
      .poll(
        async () => {
          const res = await tom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomId)}/blocks`);
          if (!res.ok()) return [];
          return ((await res.json()) as { blockedUserIds: string[] }).blockedUserIds;
        },
        { timeout: 15_000 },
      )
      .toContain(jerryId);

    // Reopen: the same ⋯ item now unblocks.
    await jerryRow.click();
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await tom.click('#back-from-conversation');
    await tom.click('#peer-overflow-btn');
    await expect(tom.locator('[data-testid="peer-block-user-btn"]')).toContainText('Unblock User');
    await tom.locator('[data-testid="peer-block-user-btn"]').click();
    await expect
      .poll(
        async () => {
          const res = await tom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomId)}/blocks`);
          if (!res.ok()) return [jerryId];
          return ((await res.json()) as { blockedUserIds: string[] }).blockedUserIds;
        },
        { timeout: 15_000 },
      )
      .not.toContain(jerryId);
  });
});
