/**
 * OPEN-40 chatroom navigation: one automatic Nearby audience plus immutable, ownerless map Places.
 * This replaces the retired Global/tile-tree, map-tap grid travel, and owner rename expectations.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';

test.describe('Nearby and Place navigation — back, list/map, create, return home', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let createdPlaceId = '';
  let createdPlaceName = '';

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await page.route('https://tiles.openfreemap.org/styles/liberty*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f7' } }],
        },
      });
    });
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  /** Return to the chatroom list from wherever the previous test left off. */
  async function toChatroomList(p: Page): Promise<void> {
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    const back = p.locator('#back-to-chatrooms');
    if (await back.isVisible().catch(() => false)) {
      await back.click();
      await afterNav();
    }
    await p.locator('[data-testid="chatroom-tree-view-btn"]').click();
  }

  const currentRoomId = (p: Page) => p.evaluate(() =>
    (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '');

  test('back icon swaps in for room detail and out for the flat list', async () => {
    await toChatroomList(page!);
    const p = page!;
    const back = p.locator('#app-bar-left #back-to-chatrooms');

    await expect(back).toBeHidden();
    const nearbyId = await openCurrentChatroom(p);
    expect(nearbyId).toMatch(/^nearby_v1_/);
    await expect(back).toBeVisible();
    await expect(back).toHaveText('‹');
    await expect(p.locator('#chatroom-detail-container')).toBeVisible();

    await back.click();
    await afterNav();
    await expect(back).toBeHidden();
    await expect(p.locator('#chatroom-list-container')).toBeVisible();

    await openCurrentChatroom(p);
    await expect(back).toBeVisible();
  });

  test('flat list contains the active Nearby room and no hierarchy or capacity shards', async () => {
    await toChatroomList(page!);
    const p = page!;
    const nearbyId = await currentRoomId(p);
    expect(nearbyId).toMatch(/^nearby_v1_/);

    const rows = p.locator('.chatroom-item');
    expect(await rows.count()).toBeGreaterThan(0);
    expect(await p.locator('.chatroom-item .chatroom-headcount').count()).toBe(await rows.count());
    await expect(p.locator(`.chatroom-item[data-chatroom-id="${nearbyId}"]`)).toHaveClass(/current-room/);
    await expect(p.locator('.chatroom-item[data-chatroom-id="global"]')).toHaveCount(0);
    await expect(p.locator('.chatroom-item[data-chatroom-id^="tile_"]')).toHaveCount(0);
    await expect(p.locator('.chatroom-item[data-chatroom-id*="_part_"]')).toHaveCount(0);
    await expect(p.locator('.chatroom-expand-icon')).toHaveCount(0);
  });

  test('list/map toggle shades Nearby and an open-map tap does not invent a grid room', async () => {
    await toChatroomList(page!);
    const p = page!;
    const listButton = p.locator('[data-testid="chatroom-tree-view-btn"]');
    const mapButton = p.locator('[data-testid="chatroom-map-view-btn"]');
    const list = p.locator('#chatroom-list');
    const map = p.locator('[data-testid="chatroom-map"]');

    await listButton.click();
    await expect(listButton).toHaveAttribute('aria-pressed', 'true');
    await expect(mapButton).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toBeVisible();
    await expect(map).toBeHidden();

    await mapButton.click();
    await expect(mapButton).toHaveAttribute('aria-pressed', 'true');
    await expect(listButton).toHaveAttribute('aria-pressed', 'false');
    await expect(list).toBeHidden();
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    await expect(map).toHaveAttribute('data-nearby-area-visible', 'true');
    await expect(map).toHaveAttribute('data-map-clustering', 'true');
    await expect(p.locator('#chatroom-map-status')).toContainText('shaded Nearby area');
    await expect(map.locator('a[href*="openstreetmap.org/copyright"]')).toBeVisible();

    await p.setViewportSize({ width: 360, height: 800 });
    const compactMapBox = await map.boundingBox();
    expect(compactMapBox?.width).toBeLessThanOrEqual(360);
    expect(compactMapBox?.height).toBeGreaterThanOrEqual(260);

    const before = await currentRoomId(p);
    const box = (await map.boundingBox())!;
    await p.mouse.click(box.x + 30, box.y + box.height / 2);
    await expect(map).not.toHaveAttribute('data-selected-tile', /.+/);
    await expect(map.locator('[data-testid="map-tile-card"]')).toHaveCount(0);
    expect(await currentRoomId(p)).toBe(before);

    await listButton.click();
    await expect(list).toBeVisible();
    await p.setViewportSize({ width: 1100, height: 1100 });
  });

  test('creates one immutable content-addressed Community Place with no owner controls', async () => {
    await toChatroomList(page!);
    const p = page!;
    createdPlaceName = `E2E Place ${Date.now()}`;

    await p.evaluate(() => {
      void (window as any).__iinpublic_app?.getApp?.()?.uiManager?.handleCreateCustomChatroomClick?.();
    });
    await afterNav();
    await p.locator('[data-testid="custom-room-name-input"]').fill(createdPlaceName);
    await p.locator('[data-testid="custom-room-submit-btn"]').click();
    await afterLoad();
    await expect(p.locator('#chatroom-members-list')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => currentRoomId(p), { timeout: 15_000 }).toMatch(/^place_b[a-z2-7]+$/);
    createdPlaceId = await currentRoomId(p);

    await expect(p.locator('[data-testid="chatroom-rename-btn"]')).toHaveCount(0);
    await expect(p.locator('#chatroom-owner-bar')).toBeHidden();
    const mutationStatus = await p.evaluate(async (roomId) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const apiBase = app?.getBackendApiBase?.() || '';
      const response = await fetch(`${apiBase}/api/chatrooms/${encodeURIComponent(roomId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'creator', name: 'Mutated name' }),
      });
      return response.status;
    }, createdPlaceId);
    expect(mutationStatus).toBe(410);

    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    const row = p.locator(`.chatroom-item[data-chatroom-id="${createdPlaceId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(createdPlaceName);
    await expect(row).toHaveAttribute('data-level', '0');
    await expect(row).toHaveAttribute('data-has-children', 'false');

    await p.locator('[data-testid="chatroom-map-view-btn"]').click();
    await expect(p.locator('#chatroom-map-status')).toContainText('Showing 1 Places');
    await expect(p.locator(`.chatroom-map-marker[data-chatroom-id="${createdPlaceId}"]`)).toBeVisible();
  });

  test('Return to Nearby leaves the Place and the chatroom back icon never leaks to Contacts', async () => {
    const p = page!;
    await toChatroomList(p);
    const home = p.locator('#return-home-btn');
    await expect(home).toBeEnabled();

    await p.locator(`.chatroom-item[data-chatroom-id="${createdPlaceId}"]`).click();
    await afterNav();
    await expect(home).toBeEnabled();
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(home).toBeEnabled();

    await home.click();
    await afterNav();
    await expect.poll(() => currentRoomId(p), { timeout: 15_000 }).toMatch(/^nearby_v1_/);
    await expect(home).toBeDisabled();

    await p.locator(`.chatroom-item[data-chatroom-id="${createdPlaceId}"]`).click();
    await afterNav();
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeVisible();
    await p.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await expect(p.locator('#app-bar-left #back-to-chatrooms')).toBeHidden();
  });
});
