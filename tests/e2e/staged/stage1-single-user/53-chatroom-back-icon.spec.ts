/**
 * Chatroom back icon + return-home state per context (redesign §3, T3):
 * room detail swaps the AppBar left zone to the ‹ icon; 🏠 enable state tracks
 * whether the current room differs from home, in both list and detail contexts.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Chatroom back icon', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('back icon swaps in for room detail and out for the list', async () => {
    const p = page!;
    const back = p.locator('#app-bar-left #back-to-chatrooms');

    await expect(back).toBeHidden();
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    await expect(back).toBeVisible();
    await expect(back).toHaveText('‹');
    await expect(p.locator('#chatroom-detail-container')).toBeVisible();

    await back.click();
    await afterNav();
    await expect(back).toBeHidden();
    await expect(p.locator('#chatroom-list-container')).toBeVisible();

    // Re-entering a room brings the icon straight back.
    await p.locator('.chatroom-item[data-chatroom-id="europe"]').click();
    await afterNav();
    await expect(back).toBeVisible();
  });

  test('return-home enable state per context', async () => {
    const p = page!;
    const home = p.locator('#return-home-btn');

    // Detail of a non-home room → enabled.
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    await expect(home).toBeEnabled();

    // Back to the list: current room is still asia → stays enabled.
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(home).toBeEnabled();

    // Return home → lands in the home room; button flips to disabled.
    await home.click();
    await afterNav();
    await expect(home).toBeDisabled({ timeout: 10_000 });

    // The back icon does not leak into other tabs.
    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeVisible();
    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeHidden();
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
  });
});
