/**
 * Chatroom navigation (merged: 53-chatroom-back-icon, 60-chatroom-hierarchy-walk,
 * 55-create-and-rename-room). One boot instead of three; each test starts from the
 * chatroom LIST via toChatroomList(). 55 runs last because it adds (and renames) a
 * community room, mutating the room list the other tests walk.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Chatroom navigation — back icon, hierarchy walk, create/rename (merged)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  /** Return to the chatroom LIST from wherever the previous test left off. */
  async function toChatroomList(p: Page): Promise<void> {
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    const back = p.locator('#back-to-chatrooms');
    if (await back.isVisible().catch(() => false)) {
      await back.click();
      await afterNav();
    }
  }

  test('back icon swaps in for room detail and out for the list', async () => {
    await toChatroomList(page!);
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
    await toChatroomList(page!);
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

  test('expand/collapse nodes, headcounts present, enter a room', async () => {
    await toChatroomList(page!);
    const p = page!;
    await expect(p.locator('#chatroom-list')).toBeVisible();

    // Every rendered row shows a headcount badge.
    const rows = p.locator('.chatroom-item');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(await p.locator('.chatroom-item .chatroom-headcount').count()).toBe(count);

    // Toggle the first expandable node both ways. The node may start expanded
    // (Global does), so the first click can collapse: assert the toggle moves
    // the row count and that toggling back restores it.
    const firstCaret = p.locator('.chatroom-expand-icon').first();
    if (await firstCaret.count()) {
      const before = await rows.count();
      await firstCaret.click();
      await afterSync();
      const toggled = await rows.count();
      expect(toggled).not.toBe(before);
      // Toggle the same node back; the original row count returns.
      await p.locator('.chatroom-expand-icon').first().click();
      await afterSync();
      expect(await rows.count()).toBe(before);
    }

    // Enter a room and see the room detail (members list), then go back.
    await p.locator('.chatroom-item').first().click();
    await afterNav();
    await expect(p.locator('#chatroom-members-list')).toBeVisible({ timeout: 10000 });
    const back = p.locator('[data-testid="back-to-chatrooms"], #back-to-chatrooms');
    if (await back.count()) {
      await back.first().click();
      await afterNav();
      await expect(p.locator('#chatroom-list')).toBeVisible();
    }
  });

  test('toggles between tree and OpenStreetMap views and opens a room marker', async () => {
    await toChatroomList(page!);
    const p = page!;
    const treeButton = p.locator('[data-testid="chatroom-tree-view-btn"]');
    const mapButton = p.locator('[data-testid="chatroom-map-view-btn"]');
    const tree = p.locator('#chatroom-list');
    const map = p.locator('[data-testid="chatroom-map"]');

    await expect(treeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(mapButton).toHaveAttribute('aria-pressed', 'false');
    await expect(tree).toBeVisible();
    await expect(map).toBeHidden();

    await mapButton.click();
    await expect(mapButton).toHaveAttribute('aria-pressed', 'true');
    await expect(treeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(tree).toBeHidden();
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/leaflet-container/, { timeout: 15_000 });
    await expect(map.locator('.chatroom-map-marker')).not.toHaveCount(0);
    await expect(map.locator('a[href*="openstreetmap.org/copyright"]')).toBeVisible();
    await expect(p.locator('#chatroom-map-status')).toContainText('geographic rooms');

    await p.setViewportSize({ width: 360, height: 800 });
    await expect(treeButton).toBeVisible();
    await expect(mapButton).toBeVisible();
    const compactMapBox = await map.boundingBox();
    expect(compactMapBox?.width).toBeLessThanOrEqual(360);
    expect(compactMapBox?.height).toBeGreaterThanOrEqual(260);

    // The current hierarchy room gets a distinct marker even when it represents a parent area.
    await map.locator('.chatroom-map-marker.current-room').click();
    await afterNav();
    await expect(p.locator('#chatroom-detail-container')).toBeVisible();

    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(map).toBeVisible();
    await treeButton.click();
    await expect(tree).toBeVisible();
    await expect(map).toBeHidden();
    await p.setViewportSize({ width: 1100, height: 1100 });
  });

  test('create a community room then rename it', async () => {
    await toChatroomList(page!);
    const p = page!;
    const roomName = `E2E Room ${Date.now()}`;

    // Open the Create Room dialog via its trigger (inline at desktop width).
    // Fire-and-forget: the handler's promise only resolves when the dialog is
    // submitted/cancelled, so it must NOT be awaited from evaluate.
    await p.evaluate(() => {
      void (window as any).__iinpublic_app?.getApp?.()?.uiManager?.handleCreateCustomChatroomClick?.();
    });
    await afterNav();
    await p.waitForSelector('[data-testid="custom-room-name-input"]');
    await p.fill('[data-testid="custom-room-name-input"]', roomName);
    await p.locator('[data-testid="custom-room-submit-btn"]').click();
    await afterLoad();

    // Land on the new room's detail (members list) and see its name somewhere.
    await expect(p.locator('#chatroom-members-list')).toBeVisible({ timeout: 15000 });

    // Rename (owner control).
    const renameBtn = p.locator('[data-testid="chatroom-rename-btn"]');
    if (await renameBtn.count()) {
      await renameBtn.first().click();
      await afterNav();
      // The rename input's id is `rename-custom-room-name`; the stable hook is the testid.
      const input = p.locator('[data-testid="rename-custom-room-input"]');
      await input.waitFor({ timeout: 8000 });
      const newName = `${roomName} Renamed`;
      await input.fill(newName);
      // Submit the rename form (Enter or the submit button in the dialog).
      await input.press('Enter');
      await afterLoad();
      await expect(p.locator('body')).toContainText('Renamed', { timeout: 10000 });
    }
  });
});
