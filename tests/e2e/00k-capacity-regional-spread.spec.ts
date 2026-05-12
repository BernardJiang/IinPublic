/**
 * Capacity spread: with capacity=3, 25 users cascade from global into continents,
 * USA, and blurred regional rooms.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { afterLoad, afterSync } from './helpers/timing';
import { webBaseURL } from './helpers/ports';

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
const REGIONAL_SF_ROOM = 'region_37.77_-122.42_room_0';

test.describe('Capacity regional spread', () => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.afterEach(async () => {
    await Promise.all(pages.map((page) => page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    pages.length = 0;
    contexts.length = 0;
    await clearGunDatabases();
  });

  test('fills global, all continental rooms, USA, and creates blurred regional rooms', async ({ browser }) => {
    await clearGunDatabases();

    for (let i = 0; i < TARGETS.length; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await page.addInitScript((location) => {
        (window as any).__test_location = { ...location, accuracy: 25 };
      }, TARGETS[i].location);
      await injectIdbClear(page);
      await page.goto(webBaseURL() + E2E_URL);
      await page.waitForLoadState('load');
      await afterLoad();
      await page.evaluate((index) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        if (app?.uiManager) app.uiManager.currentUserStageName = `Capacity User ${index + 1}`;
      }, i);
    }

    for (let i = 0; i < pages.length; i++) {
      await pages[i].evaluate(async ({ room, index }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const user = app?.currentUser;
        if (!app || !user) throw new Error('App user unavailable');
        await app.chatroomService.switchChatroom(user.id, room, `Capacity User ${index + 1}`);
        app.currentChatroomId = room;
        app.uiManager.setCurrentChatroomId(room);
      }, { room: TARGETS[i].room, index: i });
    }

    await afterSync();
    await expect
      .poll(async () => {
        const counts = await pages[0].evaluate(async (regionalRoom) => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          const service = app?.chatroomService;
          const rooms = ['global', 'north-america', 'south-america', 'europe', 'asia', 'africa', 'oceania', 'usa', regionalRoom];
          const result: Record<string, number> = {};
          for (const room of rooms) {
            result[room] = (await service.getActiveMembers(room)).length;
          }
          return result;
        }, REGIONAL_SF_ROOM);
        return {
          global: counts.global,
          northAmerica: counts['north-america'],
          southAmerica: counts['south-america'],
          europe: counts.europe,
          asia: counts.asia,
          africa: counts.africa,
          oceania: counts.oceania,
          usa: counts.usa,
          regionalCreated: counts[REGIONAL_SF_ROOM] > 0,
        };
      }, { timeout: 180_000, intervals: [2000] })
      .toEqual({
        global: 3,
        northAmerica: 3,
        southAmerica: 3,
        europe: 3,
        asia: 3,
        africa: 3,
        oceania: 3,
        usa: 3,
        regionalCreated: true,
      });
  });
});
