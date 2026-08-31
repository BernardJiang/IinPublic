/**
 * AppBar responsive overflow (redesign §1/§6, T2): width matrix 320/390/768/1024.
 * Priority order (stays inline longest → first into ⋯): 🌳 → 🗺️ → ➕ → 📣 → 🏠 → 🆕.
 * Overflow menu items stay the same live elements (ids/testids/handlers) and are invocable.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('AppBar overflow responsive', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
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

  test('width matrix: inline at wide widths, ⋯ menu at 320 with priority order', async () => {
    const p = page!;
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();

    // 1024 and 768: all six chatroom actions inline, no ⋯.
    for (const width of [1024, 768]) {
      await p.setViewportSize({ width, height: 800 });
      await afterAction();
      for (const id of ['chatroom-tree-view-btn', 'chatroom-map-view-btn', 'create-talk-btn', 'broadcast-talk-btn', 'return-home-btn', 'create-custom-chatroom-btn']) {
        await expect(p.locator(`#app-bar-actions #${id}`)).toBeVisible();
      }
      await expect(p.locator('#app-bar-overflow-menu')).toBeHidden();
    }

    // 390: the view controls and create-talk action remain inline; secondary actions overflow.
    await p.setViewportSize({ width: 390, height: 844 });
    await afterAction();
    for (const id of ['chatroom-tree-view-btn', 'chatroom-map-view-btn', 'create-talk-btn']) {
      await expect(p.locator(`#app-bar-actions #${id}`)).toBeVisible();
    }
    await expect(p.locator('#app-bar-overflow-menu')).toBeVisible();

    // 320: Tree stays inline; Map and the remaining actions collapse into ⋯ in priority order.
    await p.setViewportSize({ width: 320, height: 700 });
    await afterAction();
    await expect(p.locator('#app-bar-actions #chatroom-tree-view-btn')).toBeVisible();
    await expect(p.locator('#app-bar-overflow-menu')).toBeVisible();
    const panelOrder = await p.locator('#app-bar-overflow-panel .app-bar-action-btn').evaluateAll((els) => els.map((el) => el.id));
    expect(panelOrder).toEqual(['chatroom-map-view-btn', 'create-talk-btn', 'broadcast-talk-btn', 'return-home-btn', 'create-custom-chatroom-btn']);

    // Menu items show icon + label and are the same elements (testids preserved).
    await p.locator('#app-bar-overflow-btn').click();
    await expect(p.locator('#app-bar-overflow-panel')).toBeVisible();
    await expect(p.locator('#app-bar-overflow-panel [data-testid="create-custom-chatroom-btn"] .app-bar-btn-label')).toHaveText('New Room');

    // Invoking a menu item fires the original handler and closes the panel.
    await p.locator('#app-bar-overflow-panel #create-custom-chatroom-btn').click();
    await afterNav();
    await expect(p.locator('[data-testid="custom-room-name-input"]')).toBeVisible();
    await expect(p.locator('#app-bar-overflow-panel')).toBeHidden();
    await p.locator('#cancel-custom-room-btn').click();

    // Growing the window returns the buttons inline and hides ⋯.
    await p.setViewportSize({ width: 1024, height: 800 });
    await afterAction();
    await expect(p.locator('#app-bar-actions #create-custom-chatroom-btn')).toBeVisible();
    await expect(p.locator('#app-bar-overflow-menu')).toBeHidden();
  });

  test('tabs with a single action never overflow', async () => {
    const p = page!;
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await p.setViewportSize({ width: 320, height: 700 });
    await afterAction();
    await expect(p.locator('#app-bar-actions #create-talk-btn')).toBeVisible();
    await expect(p.locator('#app-bar-overflow-menu')).toBeHidden();
  });
});
