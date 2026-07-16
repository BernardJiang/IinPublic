/**
 * AppBar layout (redesign §1–§3, T1): one single top bar on every tab, the old
 * top-header + tab-action-bar double row is gone, and sub-views swap the left
 * zone to a back icon.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('AppBar layout', () => {
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

  test('single AppBar on every tab, no second action row', async () => {
    const p = page!;

    for (const view of ['chatrooms', 'contacts', 'talks', 'me', 'settings']) {
      await p.locator(`.nav-btn[data-view="${view}"]`).click();
      await afterNav();
      // Exactly one AppBar visible, always the same element. (Hidden overlays —
      // the shared ⟨User⟩ layout header — keep an .app-bar node in the DOM.)
      await expect(p.locator('.app-bar:visible')).toHaveCount(1);
      await expect(p.locator('#top-header.app-bar')).toBeVisible();
      // The old double-row is gone everywhere.
      await expect(p.locator('.tab-action-bar')).toHaveCount(0);
      await expect(p.locator('#chatroom-action-bar')).toHaveCount(0);
      // Status line lives in the AppBar center zone.
      await expect(p.locator('#top-header .app-bar-center #header-status')).toBeVisible();
    }
  });

  test('per-tab action icons are scoped to their tab', async () => {
    const p = page!;

    // Chatrooms root: ➕ 📣 🏠 🆕 all inline at desktop width.
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    for (const id of ['create-talk-btn', 'broadcast-talk-btn', 'return-home-btn', 'create-custom-chatroom-btn']) {
      await expect(p.locator(`#app-bar-actions #${id}`)).toBeVisible();
    }
    await expect(p.locator('#settings-refresh-location-btn')).toBeHidden();

    // Talks: only ➕.
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await expect(p.locator('#app-bar-actions #create-talk-btn')).toBeVisible();
    await expect(p.locator('#broadcast-talk-btn')).toBeHidden();
    await expect(p.locator('#create-custom-chatroom-btn')).toBeHidden();

    // Contacts / Me: no action icons.
    for (const view of ['contacts', 'me']) {
      await p.locator(`.nav-btn[data-view="${view}"]`).click();
      await afterNav();
      await expect(p.locator('#create-talk-btn')).toBeHidden();
      await expect(p.locator('#broadcast-talk-btn')).toBeHidden();
    }

    // Settings: 📍 refresh location.
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#app-bar-actions #settings-refresh-location-btn')).toBeVisible();
    await expect(p.locator('#create-talk-btn')).toBeHidden();
  });

  test('sub-view shows the back icon in the AppBar left zone', async () => {
    const p = page!;

    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    // At the list root there is no visible back icon.
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeHidden();

    await p.locator('.chatroom-item[data-chatroom-id="asia"]').click();
    await afterNav();
    // Room detail: the back control is the single left-corner icon (‹), not a text button.
    const back = p.locator('#app-bar-left #back-to-chatrooms');
    await expect(back).toBeVisible();
    await expect(back).toHaveText('‹');
    await expect(back).toHaveClass(/app-bar-back-btn/);

    await back.click();
    await afterNav();
    await expect(p.locator('#chatroom-list-container')).toBeVisible();
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeHidden();
  });
});
