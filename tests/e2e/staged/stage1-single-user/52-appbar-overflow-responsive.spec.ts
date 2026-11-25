/**
 * AppBar responsive overflow (redesign §1/§6, T2): width matrix 320/390/768/1024.
 * Chatrooms root keeps only its view controls and New Room; unrelated actions stay hidden.
 * Overflow menu items stay the same live elements (ids/testids/handlers) and are invocable.
 * Owner, 2026-11-24 (OPEN-118): on a phone the full headcount wins over buttons, but the most
 * important action stays inline; ℹ️ "What the icons mean" always sits under ⋯.
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

    const panelOrder = () => p.locator('#app-bar-overflow-panel .app-bar-action-btn').evaluateAll((els) => els.map((el) => el.id));
    // The headcount is drawn whole, not cut with an ellipsis (OPEN-118).
    const headcountWhole = () => p.locator('#status-bar-text .status-bar-meta').first()
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

    // 1024 and 768: all three root actions inline; only ℹ️ under ⋯ (no Broadcast button since OPEN-112).
    for (const width of [1024, 768]) {
      await p.setViewportSize({ width, height: 800 });
      await afterAction();
      for (const id of ['chatroom-map-view-btn', 'chatroom-list-view-btn', 'create-custom-chatroom-btn']) {
        await expect(p.locator(`#app-bar-actions #${id}`)).toBeVisible();
      }
      await expect(p.locator('#app-bar-overflow-menu')).toBeVisible();
      expect(await panelOrder()).toEqual(['icon-legend-btn']);
    }

    // 390 and 320: Map stays inline and the headcount is whole; what does not fit folds into ⋯ in
    // priority order, ℹ️ last.
    for (const width of [390, 320]) {
      await p.setViewportSize({ width, height: 800 });
      await afterAction();
      await expect(p.locator('#app-bar-actions #chatroom-map-view-btn')).toBeVisible();
      await expect(p.locator('#app-bar-overflow-menu')).toBeVisible();
      expect(await headcountWhole()).toBe(true);
    }
    expect(await panelOrder()).toEqual(['chatroom-list-view-btn', 'create-custom-chatroom-btn', 'icon-legend-btn']);

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

    // Growing the window returns the buttons inline; ⋯ keeps only ℹ️.
    await p.setViewportSize({ width: 1024, height: 800 });
    await afterAction();
    await expect(p.locator('#app-bar-actions #create-custom-chatroom-btn')).toBeVisible();
    expect(await panelOrder()).toEqual(['icon-legend-btn']);
  });

  test('Talks keeps ➕ inline at 320; the row actions fold into ⋯', async () => {
    const p = page!;
    await p.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await p.setViewportSize({ width: 320, height: 700 });
    await afterAction();
    await expect(p.locator('#app-bar-actions #create-talk-btn')).toBeVisible();
    await expect(p.locator('#app-bar-overflow-menu')).toBeVisible();
    const panelOrder = await p.locator('#app-bar-overflow-panel .app-bar-action-btn').evaluateAll((els) => els.map((el) => el.id));
    expect(panelOrder).toEqual(['talks-tap-pass-btn', 'talks-tap-like-btn', 'talks-tap-pin-btn', 'icon-legend-btn']);
  });
});
