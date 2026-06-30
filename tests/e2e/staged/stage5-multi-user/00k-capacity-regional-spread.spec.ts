/**
 * Capacity spread: with capacity=3, users cascade down the full room hierarchy
 * global → continent → country → region. Exercises one full-depth branch (SF:
 * global → north-america → usa → california) rather than all six continents — the
 * per-continent variants are the same hierarchy logic with different coordinates
 * (covered by location unit tests), and keeping the spec at <=12 browser contexts
 * avoids oversubscribing a single machine (the 25-context version flaked there).
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {maybeClearGunDatabases, injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { afterLoad, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';

const E2E_URL = '/?e2e_capacity=3&e2e_fifo=true';

const SF = { latitude: 37.7749, longitude: -122.4194 };
// One full-depth cascade branch, <=12 contexts: fill global (3) and north-america (3) to
// capacity, then over-fill usa (4) so the 4th user is evicted DOWN into the smallest matching
// region (california), proving capacity enforcement + regional-room creation at every level.
const TARGETS = [
  ...Array.from({ length: 3 }, () => ({ room: 'global', location: SF })),
  ...Array.from({ length: 3 }, () => ({ room: 'north-america', location: { latitude: 43.6532, longitude: -79.3832 } })),
  ...Array.from({ length: 4 }, () => ({ room: 'usa', location: SF })),
];
const REGIONAL_SF_ROOM = 'california';

test.describe('Capacity regional spread', () => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.afterEach(async () => {
    await Promise.all(pages.map((page) => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    pages.length = 0;
    contexts.length = 0;
    await maybeClearGunDatabases();
  });

  test('fills global, north-america, USA, and cascades into a blurred regional room', async ({ browser, request }) => {
    // 10 contexts at up to 30s app-ready budget each (worst case 300s) plus the 180s
    // member-count poll below can exceed the global default test timeout (300s at
    // STAGE5_WORKERS<4) under heavy concurrent-wave load. Give this spec its own headroom.
    test.setTimeout(600_000);
    await maybeClearGunDatabases();

    for (let i = 0; i < TARGETS.length; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await injectIdbClear(page);
      await page.addInitScript(({ location, room }) => {
        (window as any).__test_location = { ...location, accuracy: 25 };
        localStorage.setItem('iinpublic_last_chatroom', room);
      }, TARGETS[i]);
      // 25 browser contexts boot in one worker; later cold bootstraps contend with the
      // already-running idle peers, so give app-ready a larger budget than the 10s default.
      await gotoWebApp(page, webBaseURL() + E2E_URL, 30_000);
      await afterLoad();
      await page.evaluate((index) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (app?.uiManager) app.uiManager.currentUserStageName = `Capacity User ${index + 1}`;
      }, i);
    }

    await afterSync();
    await expect
      .poll(async () => {
        const rooms = ['global', 'north-america', 'usa', REGIONAL_SF_ROOM];
        const counts: Record<string, number> = {};
        for (const room of rooms) {
          // A single slow/failed read must NOT throw out of the poll (that aborts all remaining
          // budget); treat it as "not ready yet" so the poll retries. Give the request headroom.
          try {
            const res = await request.get(`${gunBaseURL()}/api/chatrooms/${encodeURIComponent(room)}/members`, {
              headers: { 'Cache-Control': 'no-cache' },
              timeout: 30_000,
            });
            const rows = res.ok() ? ((await res.json()) as Array<{ userId?: string }>) : [];
            counts[room] = rows.filter((row) => row.userId && row.userId !== TECHSUPPORT_ROOT_USER_ID).length;
          } catch {
            counts[room] = 0; // transient timeout/overload — let the next poll tick retry
          }
        }
        return {
          global: counts.global >= 3,
          northAmerica: counts['north-america'] >= 3,
          usa: counts.usa >= 3,
          regionalCreated: counts[REGIONAL_SF_ROOM] > 0,
        };
      }, { timeout: 280_000, intervals: [2000] })
      .toEqual({
        global: true,
        northAmerica: true,
        usa: true,
        regionalCreated: true,
      });
  });
});
