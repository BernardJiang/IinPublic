/**
 * Two-way room routing over the tile tree (docs/design/room-tree-routing.md §3–§5), capacity 3:
 *
 *  1. GPS users: a full Global pushes its oldest member ONE layer down (to the L1 region tile at
 *     their position). When Global frees a seat, the lone evictee is NOT promoted back during the
 *     eviction cooldown (the evict → promote → evict loop guard), and IS promoted after it.
 *  2. A GPS-less desktop with a chosen home tile is routed down toward that tile (London's region
 *     tile), not into the non-geographic Global overflow.
 *
 * Fast timings come from URL params: promotion dwell 2 s, eviction cooldown 25 s.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';
import { tileIdAt } from '../../../../src/shared/room-tiles';

const COOLDOWN_MS = 25_000;
const E2E_URL = `/?e2e_capacity=3&e2e_fifo=true&e2e_promote_ms=2000&e2e_cooldown_ms=${COOLDOWN_MS}`;
const SAN_DIEGO = { latitude: 32.7157, longitude: -117.1611 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

test.describe('Two-way room routing', () => {
  const contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    for (const context of contexts) {
      for (const page of context.pages()) {
        await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
      }
      await context.close().catch(() => {});
    }
    contexts.length = 0;
    await clearGunForStage4Spec();
  });

  const currentRoom = (page: Page) =>
    page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentChatroomId || '');

  async function bootUser(
    browser: import('@playwright/test').Browser,
    label: string,
    location: { latitude: number; longitude: number } | 'none',
    homeTile?: string,
  ): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 640, height: 700 } });
    contexts.push(context);
    const page = await context.newPage();
    attachFilteredConsoleLog(page, label);
    await injectIdbClear(page);
    await page.addInitScript((loc) => {
      (window as any).__test_location = loc === 'none' ? 'none' : { ...loc, accuracy: 25 };
    }, location);
    await gotoWebApp(page, webBaseURL() + E2E_URL, 30_000);
    await afterLoad();
    await expect.poll(() => currentRoom(page), { timeout: 30_000 }).toBe('global');
    if (homeTile) {
      // Same event the Settings "Home room" picker emits.
      await page.evaluate((id) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit('setHomeChatroom', { chatroomId: id }), homeTile);
    }
    return page;
  }

  test('GPS evictee goes one layer down and is promoted back only after the cooldown', async ({ browser }) => {
    test.setTimeout(240_000);
    await clearGunForStage4Spec();
    const l1 = tileIdAt(1, SAN_DIEGO.latitude, SAN_DIEGO.longitude);

    const u1 = await bootUser(browser, 'U1', SAN_DIEGO);
    await bootUser(browser, 'U2', SAN_DIEGO);
    await bootUser(browser, 'U3', SAN_DIEGO);
    const u4 = await bootUser(browser, 'U4', SAN_DIEGO);

    // Global over capacity: the oldest (U1) moves one layer down — the L1 region tile, not a 1 km cell.
    await expect.poll(() => currentRoom(u1), { timeout: 60_000 }).toBe(l1);
    const evictedAt = Date.now();
    await expect(u1.locator('#status-bar-text')).toContainText('North America · West & Central', { timeout: 20_000 });

    // U4 leaves: Global has headroom again, but U1 was just pushed out of it → stays (loop guard).
    await u4.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.());
    await u4.context().close();
    await u1.waitForTimeout(10_000);
    expect(await currentRoom(u1)).toBe(l1);

    // After the cooldown, the lone member is promoted back up to Global.
    await expect.poll(() => currentRoom(u1), { timeout: 90_000, intervals: [1_000] }).toBe('global');
    expect(Date.now() - evictedAt).toBeGreaterThanOrEqual(COOLDOWN_MS - 3_000);
  });

  test('a GPS-less desktop with a chosen home tile is routed toward it, not to the Global overflow', async ({ browser }) => {
    test.setTimeout(180_000);
    await clearGunForStage4Spec();
    const home = tileIdAt(2, LONDON.latitude, LONDON.longitude);
    const homeRegion = tileIdAt(1, LONDON.latitude, LONDON.longitude);

    const desktop = await bootUser(browser, 'Desktop', 'none', home);
    await bootUser(browser, 'U2', SAN_DIEGO);
    await bootUser(browser, 'U3', SAN_DIEGO);
    await bootUser(browser, 'U4', SAN_DIEGO);

    await expect.poll(() => currentRoom(desktop), { timeout: 60_000 }).toBe(homeRegion);
    await expect(desktop.locator('#status-bar-text')).toContainText('Europe · North Atlantic', { timeout: 20_000 });
  });
});
