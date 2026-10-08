/**
 * Chatroom hierarchy in both views (FR-CR-4a): Global → L1 region tiles (45° squares labeled by
 * continent) → GPS grid rooms. Countries,
 * states and cities are never rooms in the UI; a grid room is titled by its nearest city.
 *
 * One user located in San Diego:
 *   1. Tree: Global ▼ → land region tiles; "North America · West & Central" ▼ → "📍 Near San Diego".
 *   2. Collapse/expand North America hides/shows the grid room.
 *   3. Map: region-tile pins + the current grid room's pin; tapping it opens the room.
 *   4. Travel to London's grid room: tree shows "Europe · North Atlantic" ▼ → "📍 Near London".
 * Screenshots of each step are attached to the report (and written to test-results).
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { GRID_PLACES, gridRoomIdAt, openGridRoomAt } from '../../helpers/chatroom-nav';

const SD_TILE = 'tile_1_2_1'; // North America · West & Central
const LONDON_TILE = 'tile_1_3_3'; // Europe · North Atlantic
const REGION_TILES: Array<[string, string]> = [
  [SD_TILE, 'North America · West & Central'],
  [LONDON_TILE, 'Europe · North Atlantic'],
  ['tile_1_2_6', 'Asia · East & Southeast'],
  ['tile_1_1_2', 'South America'],
  ['tile_1_1_4', 'Africa · Central & South'],
  ['tile_1_1_7', 'Oceania · East'],
];
const RETIRED_CONTINENT_ROOMS = ['north-america', 'south-america', 'europe', 'asia', 'africa', 'oceania'];
const NEVER_LISTED = [...RETIRED_CONTINENT_ROOMS, 'usa', 'california', 'san-diego', 'canada', 'uk', 'london', 'japan', 'germany'];

test.describe('Chatroom tree and map views', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
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

  const snap = async (name: string): Promise<void> => {
    const body = await page!.screenshot({ path: test.info().outputPath(`${name}.png`) });
    await test.info().attach(name, { body, contentType: 'image/png' });
  };

  const row = (id: string) => page!.locator(`#chatroom-list .chatroom-item[data-chatroom-id="${id}"]`);

  const showTree = async (): Promise<void> => {
    const p = page!;
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    if (await p.locator('#back-to-chatrooms').isVisible().catch(() => false)) {
      await p.locator('#back-to-chatrooms').click();
      await afterNav();
    }
    await p.locator('[data-testid="chatroom-tree-view-btn"]').click();
    await expect(p.locator('#chatroom-list')).toBeVisible();
  };

  const showMap = async (): Promise<void> => {
    const p = page!;
    await p.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = p.locator('[data-testid="chatroom-map"]');
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    await expect(map.locator('.chatroom-map-marker, .chatroom-map-cluster').first()).toBeVisible({ timeout: 20_000 });
    await p.waitForTimeout(1_500); // let tiles paint for the screenshot
  };

  test('tree: Global → region tiles → my grid room; no country/state/city rooms', async () => {
    const p = page!;
    // Enter my own grid room (the room a Global overflow would move me to).
    const home = await p.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.currentLocation ? app.currentLocation : null;
    });
    expect(home).not.toBeNull();
    const homeGrid = await openGridRoomAt(p, { latitude: home.latitude, longitude: home.longitude });
    await showTree();

    await expect(row('global')).toHaveAttribute('data-level', '0');
    for (const [tile, label] of REGION_TILES) {
      await expect(row(tile)).toHaveAttribute('data-level', '1');
      await expect(row(tile).locator('.chatroom-name')).toContainText(label);
    }
    // Ocean / Antarctica tiles are not listed unless someone is in them.
    await expect(p.locator('#chatroom-list .chatroom-item', { hasText: 'Antarctica' })).toHaveCount(0);
    for (const named of NEVER_LISTED) await expect(row(named)).toHaveCount(0);

    const homeRow = row(homeGrid);
    await expect(homeRow).toHaveAttribute('data-level', '2');
    await expect(homeRow).toHaveClass(/current-room/);
    await expect(homeRow.locator('.chatroom-name')).toContainText('Near San Diego');
    // It sits directly under its region tile in the rendered order.
    const ids = await p.locator('#chatroom-list .chatroom-item').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-chatroom-id')));
    expect(ids.indexOf(homeGrid)).toBe(ids.indexOf(SD_TILE) + 1);
    await snap('1-tree-region-expanded');

    // Collapse and re-expand the region tile.
    await row(SD_TILE).locator('.chatroom-expand-icon').click();
    await afterSync();
    await expect(row(homeGrid)).toHaveCount(0);
    await snap('2-tree-region-collapsed');
    await row(SD_TILE).locator('.chatroom-expand-icon').click();
    await afterSync();
    await expect(row(homeGrid)).toBeVisible();
  });

  test('map: region-tile pins plus my grid room pin; tapping my pin opens it', async () => {
    const p = page!;
    await showTree();
    await showMap();
    const map = p.locator('[data-testid="chatroom-map"]');
    await expect(map.locator('.chatroom-map-marker.current-room')).toBeVisible();
    await snap('3-map-current-grid-room');

    await map.locator('.chatroom-map-marker.current-room').click();
    await afterNav();
    await expect(p.locator('#current-chatroom-title')).toContainText('Near San Diego');

    // Zoom out to the world: region tiles appear as pins/clusters.
    await p.locator('#back-to-chatrooms').click();
    await afterNav();
    await expect(map).toBeVisible();
    for (let step = 0; step < 6; step++) {
      await map.locator('.maplibregl-ctrl-zoom-out').click();
      await p.waitForTimeout(300);
    }
    await expect(map.locator('.chatroom-map-marker, .chatroom-map-cluster')).not.toHaveCount(0);
    await p.waitForTimeout(1_500);
    await snap('4-map-world-regions');
  });

  test('travel to London grid: tree shows Europe · North Atlantic → Near London; map follows', async () => {
    const p = page!;
    const london = await openGridRoomAt(p, GRID_PLACES.london);
    expect(london).toBe(gridRoomIdAt(GRID_PLACES.london));
    await expect(p.locator('#current-chatroom-title')).toContainText('Near London');

    await showTree();
    await expect(row(london)).toHaveAttribute('data-level', '2');
    await expect(row(london)).toHaveClass(/current-room/);
    const ids = await p.locator('#chatroom-list .chatroom-item').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-chatroom-id')));
    expect(ids.indexOf(london)).toBe(ids.indexOf(LONDON_TILE) + 1);
    for (const named of NEVER_LISTED) await expect(row(named)).toHaveCount(0);
    await snap('5-tree-london');

    await showMap();
    await expect(p.locator('[data-testid="chatroom-map"] .chatroom-map-marker.current-room')).toBeVisible();
    await snap('6-map-london-grid-room');
    await p.locator('[data-testid="chatroom-tree-view-btn"]').click();
  });
});
