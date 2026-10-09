/**
 * OPEN-40 Nearby + Places navigation. The geographic hierarchy is deliberately absent: the list
 * contains one active Nearby audience plus Community-created Places, while the map shades the
 * locally derived Nearby cell without publishing its bounds.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Nearby and Places list/map views', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
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

  const openList = async (): Promise<void> => {
    await page!.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    if (await page!.locator('#back-to-chatrooms').isVisible().catch(() => false)) {
      await page!.locator('#back-to-chatrooms').click();
      await afterNav();
    }
    await page!.locator('[data-testid="chatroom-tree-view-btn"]').click();
  };

  test('list exposes one Nearby audience and no Global/tree/capacity shards', async () => {
    await openList();
    const currentRoomId = await page!.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.getCurrentChatroomId?.() || '');
    expect(currentRoomId).toMatch(/^nearby_v1_/);

    const current = page!.locator(`.chatroom-item[data-chatroom-id="${currentRoomId}"]`);
    await expect(current).toBeVisible();
    await expect(current).toHaveClass(/current-room/);
    await expect(current).toContainText('Nearby');
    await expect(page!.locator('.chatroom-item[data-chatroom-id="global"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-item[data-chatroom-id^="tile_"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-item[data-chatroom-id*="_part_"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-expand-icon')).toHaveCount(0);
  });

  test('map shades and focuses the local Nearby area without enabling retired tile travel', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    await expect(map).toHaveAttribute('data-nearby-area-visible', 'true');
    await expect(page!.locator('#chatroom-map-status')).toContainText('shaded Nearby area');
    await expect(page!.locator('#chatroom-map-status')).toContainText(/\d+(?:\.\d+)? (?:m|km)/);
    await expect(page!.locator('#return-home-btn')).toBeDisabled();

    const box = (await map.boundingBox())!;
    await page!.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(map).not.toHaveAttribute('data-selected-tile', /.+/);
    await expect(map.locator('[data-testid="map-tile-card"]')).toHaveCount(0);
  });
});
