/**
 * Capacity spread over the tile tree (docs/design/room-tree-routing.md §3): every new identity
 * enters Global; when Global is full its oldest member moves ONE layer down to the L1 region tile
 * at their position, a full L1 tile pushes its oldest one layer further (L2), and so on — never
 * through continent/country/state rooms and never straight to a 1 km cell. Capacity 3, FIFO,
 * 9 contexts (6 in San Francisco, then 3 in Toronto).
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage5Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { getAutomaticLocationChatroomId } from '../../../../src/shared/location-to-chatroom';
import { tileIdAt } from '../../../../src/shared/room-tiles';

const E2E_URL = '/?e2e_capacity=3&e2e_fifo=true';

const SF = { latitude: 37.7749, longitude: -122.4194 };
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
// The six oldest are in San Francisco; the three newest (Toronto) are the ones Global keeps.
const LOCATIONS = [...Array.from({ length: 6 }, () => SF), ...Array.from({ length: 3 }, () => TORONTO)];
const SF_CELL = getAutomaticLocationChatroomId({ ...SF, accuracy: 25, timestamp: new Date() });
const SF_TILE = (layer: number) => tileIdAt(layer, SF.latitude, SF.longitude);
const RETIRED_HIERARCHY_ROOMS = ['north-america', 'usa', 'california', 'canada'];

test.describe('Capacity regional spread', () => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.afterEach(async () => {
    await Promise.all(pages.map((page) => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    pages.length = 0;
    contexts.length = 0;
    await clearGunForStage5Spec();
  });

  test('Global keeps the newest; evictees cascade one tile layer at a time (L1, then L2)', async ({ browser, request }) => {
    test.setTimeout(600_000);
    await clearGunForStage5Spec();

    for (let i = 0; i < LOCATIONS.length; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await injectIdbClear(page);
      await page.addInitScript((location) => {
        (window as any).__test_location = { ...location, accuracy: 25 };
      }, LOCATIONS[i]);
      await gotoWebApp(page, webBaseURL() + E2E_URL, 30_000);
      await afterLoad();
    }

    const countMembers = async (room: string): Promise<number> => {
      try {
        const res = await request.get(`${gunBaseURL()}/api/chatrooms/${encodeURIComponent(room)}/members`, {
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 30_000,
        });
        const rows = res.ok() ? ((await res.json()) as Array<{ userId?: string }>) : [];
        return rows.filter((row) => row.userId && row.userId !== TECHSUPPORT_ROOT_USER_ID).length;
      } catch {
        return -1; // transient overload — not ready yet
      }
    };

    await afterSync();
    await expect
      .poll(async () => {
        const global = await countMembers('global');
        const l1 = await countMembers(SF_TILE(1));
        const l2 = await countMembers(SF_TILE(2));
        const cell = await countMembers(SF_CELL);
        const hierarchy = await Promise.all(RETIRED_HIERARCHY_ROOMS.map(countMembers));
        return {
          globalAtCapacity: global === 3,
          l1RegionFull: l1 === 3,
          l2HoldsTheOldest: l2 === 3,
          noJumpToOneKmCell: cell === 0,
          noHierarchyRouting: hierarchy.every((n) => n === 0),
        };
      }, { timeout: 280_000, intervals: [2000] })
      .toEqual({
        globalAtCapacity: true,
        l1RegionFull: true,
        l2HoldsTheOldest: true,
        noJumpToOneKmCell: true,
        noHierarchyRouting: true,
      });
  });
});
