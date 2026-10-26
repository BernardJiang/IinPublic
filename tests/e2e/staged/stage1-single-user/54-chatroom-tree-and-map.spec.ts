/**
 * OPEN-40 Nearby + Places navigation. The geographic hierarchy is deliberately absent: the list
 * contains only Community-created Places; Nearby people are shown directly and the map shades no
 * locally derived Nearby cell.
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
    await page!.locator('[data-testid="chatroom-list-view-btn"]').click();
  };

  test('list exposes no synthetic Nearby room or Global/tree/capacity shards', async () => {
    await openList();
    const currentRoomId = await page!.evaluate(() =>
      (window as any).__iinpublic_app?.getApp?.()?.getCurrentChatroomId?.() || '');
    expect(currentRoomId).toMatch(/^nearby-v3$/);

    await expect(page!.locator(`.chatroom-item[data-chatroom-id="${currentRoomId}"]`)).toHaveCount(0);
    await expect(page!.locator('[data-testid="nearby-people-section"]')).toBeVisible();
    await expect(page!.locator('.chatroom-item[data-chatroom-id="global"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-item[data-chatroom-id^="tile_"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-item[data-chatroom-id*="_part_"]')).toHaveCount(0);
    await expect(page!.locator('.chatroom-expand-icon')).toHaveCount(0);
  });

  test('map focuses on me without a shaded Nearby area or retired tile travel', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toBeVisible();
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    // Nearby is my own list, not an area: nothing is shaded (§3.7 "Map, list and headcounts").
    await expect(map).not.toHaveAttribute('data-nearby-area-visible', 'true');
    await expect(page!.locator('#chatroom-map-status')).not.toContainText('shaded Nearby area');
    await expect(page!.locator('#return-home-btn')).toBeHidden();

    const box = (await map.boundingBox())!;
    await page!.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(map).not.toHaveAttribute('data-selected-tile', /.+/);
    await expect(map.locator('[data-testid="map-tile-card"]')).toHaveCount(0);
  });

  test('broadcast event handlers animate the map and core exchange updates change match badges', async () => {
    await openList();
    await page!.locator('[data-testid="chatroom-map-view-btn"]').click();
    const map = page!.locator('[data-testid="chatroom-map"]');
    await expect(map).toHaveClass(/maplibregl-map/, { timeout: 20_000 });
    // Deterministic public points; exercise the real app/UI handlers without a second device.
    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const point = { latitude: 32.715, longitude: -117.16, precisionMeters: 400 };
      app.uiManager.setMapUserDotSource({
        selfPoint: point, selfTraveler: true,
        isCandidate: () => true,
        load: async () => ({ dots: [{ ...point, userId: 'map-eve', traveler: false }], density: [] }),
      });
    });
    await expect(map.locator('[data-testid="map-user-dot-self"]')).toHaveCount(1);
    await expect(map.locator('[data-testid="map-user-dot-room"]')).toHaveCount(1);

    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.startNearbyBroadcastProgress(app.getCurrentChatroomId(), ['map-qa-talk'], 1, ['map-eve']);
    });
    await expect(map.locator('[data-direction="outgoing"]')).toHaveCount(1);
    await page!.evaluate(() => {
      (window as any).__iinpublic_app.getApp().uiManager.displayIncomingTalk({
        id: 'map-incoming', title: 'Map test', authorName: 'Eve', type: 'tag',
        questionCount: 0, timestamp: new Date().toISOString(), isOwnTalk: false,
        fullTalk: { authorId: 'map-eve' },
      });
    });
    await expect(map.locator('[data-direction="incoming"]')).toHaveCount(1);
    await expect(map.locator('[data-event-id]')).toHaveCount(0, { timeout: 5_000 });

    await page!.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      app.recordLocalTalkExchange('map-eve', 'Eve', 'map-qa-talk', { title: 'Map test', type: 'tag' }, 'match');
    });
    await expect(map.locator('[data-user-id="map-eve"][data-match-count="1"]')).toHaveCount(1);
    await expect.poll(() => page!.evaluate(async () => {
      const records = await (window as any).__iinpublic_app.getApp().gunService.getBridge().core({ name: 'exchanges.snapshot' });
      return records.some((record: any) => record.peerId === 'map-eve' && record.outcome === 'match');
    })).toBe(true);
    // Loading/recording matches is data hydration, not another incoming broadcast animation.
    await expect(map.locator('[data-event-id]')).toHaveCount(0);
    await page!.evaluate(() => {
      (window as any).__iinpublic_app.getApp().recordLocalTalkExchange(
        'map-eve', 'Eve', 'map-qa-talk', { title: 'Map test', type: 'tag' }, 'mismatch',
      );
    });
    await expect(map.locator('[data-match-count]')).toHaveCount(0);
  });
});
