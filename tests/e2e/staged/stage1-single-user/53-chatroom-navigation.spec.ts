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
import { AREA_PLACES, openAreaRoomAt } from '../../helpers/chatroom-nav';

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
    await openAreaRoomAt(p, AREA_PLACES.tokyo);
    await expect(back).toBeVisible();
    await expect(back).toHaveText('‹');
    await expect(p.locator('#chatroom-detail-container')).toBeVisible();

    await back.click();
    await afterNav();
    await expect(back).toBeHidden();
    await expect(p.locator('#chatroom-list-container')).toBeVisible();

    // Re-entering a room brings the icon straight back.
    await openAreaRoomAt(p, AREA_PLACES.london);
    await expect(back).toBeVisible();
  });

  test('return-home enable state per context', async () => {
    await toChatroomList(page!);
    const p = page!;
    const home = p.locator('#return-home-btn');

    // Detail of a non-home room → enabled.
    await openAreaRoomAt(p, AREA_PLACES.tokyo);
    await expect(home).toBeEnabled();

    // Back to the list: current room is still the Tokyo grid room → stays enabled.
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(home).toBeEnabled();

    // Return home → lands in the home room; button flips to disabled.
    await home.click();
    await afterNav();
    await expect(home).toBeDisabled({ timeout: 10_000 });

    // The back icon does not leak into other tabs.
    await openAreaRoomAt(p, AREA_PLACES.tokyo);
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeVisible();
    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeHidden();
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
  });

  test('region-tile tree without country rooms, headcounts present, enter a room', async () => {
    await toChatroomList(page!);
    const p = page!;
    await expect(p.locator('#chatroom-list')).toBeVisible();

    // Every rendered row shows a headcount badge.
    const rows = p.locator('.chatroom-item');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(await p.locator('.chatroom-item .chatroom-headcount').count()).toBe(count);

    // Global → continents → GPS grid rooms: continents are listed, countries/states/cities never.
    for (const [tile, label] of [['tile_1_2_1', 'North America'], ['tile_1_3_3', 'Europe'], ['tile_1_2_6', 'Asia']]) {
      await expect(p.locator(`.chatroom-item[data-chatroom-id="${tile}"]`)).toContainText(label);
    }
    for (const named of ['usa', 'california', 'san-diego', 'japan']) {
      await expect(p.locator(`.chatroom-item[data-chatroom-id="${named}"]`)).toHaveCount(0);
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

  test('toggles between tree and OpenStreetMap views, opens a room marker, and a map tap opens a grid room', async () => {
    const p = page!;
    // Be in a grid room so the map has a located marker (Global itself has no map position).
    await openAreaRoomAt(p, AREA_PLACES.tokyo);
    await toChatroomList(p);
    await p.route('https://tiles.openfreemap.org/styles/liberty*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f7' } }],
        },
      });
    });
    const treeButton = p.locator('[data-testid="chatroom-tree-view-btn"]');
    const mapButton = p.locator('[data-testid="chatroom-map-view-btn"]');
    const tree = p.locator('#chatroom-list');
    const map = p.locator('[data-testid="chatroom-map"]');

    await expect(treeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(mapButton).toHaveAttribute('aria-pressed', 'false');
    await expect(p.locator('#app-bar-actions [data-testid="chatroom-tree-view-btn"]')).toBeVisible();
    await expect(p.locator('#app-bar-actions [data-testid="chatroom-map-view-btn"]')).toBeVisible();
    await expect(p.locator('.chatroom-view-toolbar')).toHaveCount(0);
    await expect(tree).toBeVisible();
    await expect(map).toBeHidden();

    await mapButton.click();
    await expect(mapButton).toHaveAttribute('aria-pressed', 'true');
    await expect(treeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(tree).toBeHidden();
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 15_000 });
    await expect(map).toHaveAttribute('data-map-geojson-feature-count', /[1-9]\d*/);
    await expect(map).toHaveAttribute('data-map-clustering', 'true');
    // The current room is drawn as its own (never clustered) marker, so at area zoom the clustered
    // layer may legitimately render nothing nearby; the marker assertion below covers rendering.
    await expect(map.locator('.chatroom-map-marker')).not.toHaveCount(0);
    await expect(map.locator('a[href*="openstreetmap.org/copyright"]')).toBeVisible();
    await expect(p.locator('#chatroom-map-status')).toContainText('geographic rooms');

    await p.setViewportSize({ width: 360, height: 800 });
    await expect(treeButton).toBeVisible();
    await expect(mapButton).toBeVisible();
    const compactMapBox = await map.boundingBox();
    expect(compactMapBox?.width).toBeLessThanOrEqual(360);
    expect(compactMapBox?.height).toBeGreaterThanOrEqual(260);

    // The current grid room gets a distinct marker at its cell.
    await map.locator('.chatroom-map-marker.current-room').click();
    await afterNav();
    await expect(p.locator('#chatroom-detail-container')).toBeVisible();

    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(map).toBeVisible();
    // Tapping open map (not a marker) opens the area room (bottom-layer tile) covering that point.
    const box = (await map.boundingBox())!;
    await p.mouse.click(box.x + 30, box.y + box.height / 2);
    await afterNav();
    await expect(p.locator('#chatroom-detail-container')).toBeVisible();
    await expect
      .poll(() => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || ''))
      .toMatch(/^tile_4_/);
    await expect(p.locator('#current-chatroom-title')).toContainText('📍');
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
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

    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    const customRow = p.locator('.chatroom-item').filter({ hasText: roomName }).first();
    const customId = await customRow.getAttribute('data-chatroom-id');
    expect(customId).toBeTruthy();
    // Custom rooms sit right under Global, not below the ~25 region tiles (they looked lost there).
    const order = await p.locator('#chatroom-list .chatroom-item').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-chatroom-id')));
    expect(order.indexOf(customId)).toBeGreaterThan(order.indexOf('global'));
    expect(order.indexOf(customId)).toBeLessThan(order.findIndex((id) => id?.startsWith('tile_1_')));
    await p.locator('[data-testid="chatroom-map-view-btn"]').click();
    await expect(p.locator('#chatroom-map-status')).toContainText('custom rooms without a public location');
    await expect(p.locator(`.chatroom-map-marker[data-chatroom-id="${customId}"]`)).toHaveCount(0);
  });
});
