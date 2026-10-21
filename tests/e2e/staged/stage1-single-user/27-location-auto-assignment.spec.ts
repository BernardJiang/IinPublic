/**
 * Location-based chatroom auto-assignment after an explicit location refresh.
 * The active room is the automatic Nearby group (Global and the tile tree are retired). Nearby is an
 * adaptive partition (src/shared/nearby-partition.ts): one world-wide root group that splits by
 * location only once it overflows capacity. A lone user therefore stays in that same root group
 * after a refresh to a far-away fix, and never falls back to a Global or tile room.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Location-based chatroom assignment', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await page.addInitScript(() => {
      (window as any).__test_location = { latitude: 37.7749, longitude: -122.4194, accuracy: 25 };
      (window as any).__e2e_location = { latitude: 40.7128, longitude: -74.006, accuracy: 25 };
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success: PositionCallback): void {
            const loc = (window as any).__e2e_location;
            success({
              coords: {
                latitude: loc.latitude,
                longitude: loc.longitude,
                accuracy: loc.accuracy,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          },
        },
      });
    });
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('explicit location refresh keeps a lone user in Nearby', async () => {
    const p = page!;
    const currentRoom = () => p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.getCurrentChatroomId?.() || '');
    await expect.poll(currentRoom).toMatch(/^nearby-v3$/);
    const before = await currentRoom();

    await p.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      await app?.updateLocationAndMaybeSwitch?.({
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 25,
        timestamp: new Date(),
      });
    });
    await afterSync();

    expect(await currentRoom()).toBe(before);
    expect(before).not.toMatch(/^(global|tile_)/);
  });
});
