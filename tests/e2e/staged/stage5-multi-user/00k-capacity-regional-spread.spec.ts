/**
 * Capacity spread: with capacity=3, 25 users cascade from global into continents,
 * USA, and the smallest matching state/region room.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {maybeClearGunDatabases, injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { afterLoad, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';

const E2E_URL = '/?e2e_capacity=3&e2e_fifo=true';

const SF = { latitude: 37.7749, longitude: -122.4194 };
const TARGETS = [
  ...Array.from({ length: 3 }, () => ({ room: 'global', location: SF })),
  ...Array.from({ length: 3 }, () => ({ room: 'north-america', location: { latitude: 43.6532, longitude: -79.3832 } })),
  ...Array.from({ length: 3 }, () => ({ room: 'south-america', location: { latitude: -23.5505, longitude: -46.6333 } })),
  ...Array.from({ length: 3 }, () => ({ room: 'europe', location: { latitude: 51.5072, longitude: -0.1276 } })),
  ...Array.from({ length: 3 }, () => ({ room: 'asia', location: { latitude: 35.6762, longitude: 139.6503 } })),
  ...Array.from({ length: 3 }, () => ({ room: 'africa', location: { latitude: 6.5244, longitude: 3.3792 } })),
  ...Array.from({ length: 3 }, () => ({ room: 'oceania', location: { latitude: -33.8688, longitude: 151.2093 } })),
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

  test('fills global, all continental rooms, USA, and creates blurred regional rooms', async ({ browser }) => {
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
      await gotoWebApp(page, webBaseURL() + E2E_URL);
      await afterLoad();
      await page.evaluate((index) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (app?.uiManager) app.uiManager.currentUserStageName = `Capacity User ${index + 1}`;
      }, i);
    }

    await afterSync();
    await expect
      .poll(async () => {
        const counts = await pages[0].evaluate(async ({ regionalRoom, techSupportId }) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          const service = app?.chatroomService;
          const rooms = ['global', 'north-america', 'south-america', 'europe', 'asia', 'africa', 'oceania', 'usa', regionalRoom];
          const result: Record<string, number> = {};
          for (const room of rooms) {
            result[room] = ((await service.getActiveMembers(room)) as string[])
              .filter((id) => id && id !== techSupportId).length;
          }
          return result;
        }, { regionalRoom: REGIONAL_SF_ROOM, techSupportId: TECHSUPPORT_ROOT_USER_ID });
        return {
          global: counts.global >= 3,
          northAmerica: counts['north-america'] >= 3,
          southAmerica: counts['south-america'] >= 3,
          europe: counts.europe >= 3,
          asia: counts.asia >= 3,
          africa: counts.africa >= 3,
          oceania: counts.oceania >= 3,
          usa: counts.usa >= 3,
          regionalCreated: counts[REGIONAL_SF_ROOM] > 0,
        };
      }, { timeout: 180_000, intervals: [2000] })
      .toEqual({
        global: true,
        northAmerica: true,
        southAmerica: true,
        europe: true,
        asia: true,
        africa: true,
        oceania: true,
        usa: true,
        regionalCreated: true,
      });
  });
});
