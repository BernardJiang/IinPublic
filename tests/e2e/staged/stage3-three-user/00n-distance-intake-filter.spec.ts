import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import {
  bootstrapUser,
  finalCleanupPages,
  incomingClustersIncludeTitleForUser,
  resetTalksMatchingSession,
  syncIncomingFromServer,
  waitForIncomingTalkClusterOnServer,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';
const RECEIVER_LOCATION = { latitude: 32.7157, longitude: -117.1611 };

async function setSenderLocation(page: Page, latitude: number): Promise<void> {
  await page.evaluate(
    async ({ lat, lng }) => {
      const app = (window as any).__iinpublic_app.getApp();
      const location = {
        latitude: lat,
        longitude: lng,
        accuracy: 10,
        timestamp: new Date(),
      };
      app.currentLocation = location;
      app.uiManager.setCurrentLocation(location);
      if (app.currentUser?.id && app.userService?.updateUserLocation) {
        await app.userService.updateUserLocation(app.currentUser.id, location);
      }
    },
    { lat: latitude, lng: RECEIVER_LOCATION.longitude },
  );
}

async function createFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const question = page.locator('.question-item').first();
  await question.locator('.question-text').fill(`Would you meet for ${title}?`);
  await question.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await question.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await question.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await question.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await submitTalkEditorAndWaitForOut(page, title);
}

async function broadcastFromCurrentRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await clickBroadcastUntilBulkAck(page);
  await waitForTabActive(page, 'chatrooms');
}

test.describe('Incoming talk distance intake filtering', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await shutdownThreeBrowsers(browsers);
    await maybeClearGunDatabases();
  });

  test('allows an in-band sender while hiding senders below minimum and above maximum distance', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Distance Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Distance Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-min-distance').fill('1');
    await pageJerry.locator('#settings-min-distance').press('Tab');
    await pageJerry.locator('#settings-max-distance').fill('3');
    await pageJerry.locator('#settings-max-distance').press('Tab');
    await expect(pageJerry.locator('#settings-min-distance')).toHaveValue('1');
    await expect(pageJerry.locator('#settings-max-distance')).toHaveValue('3');
    await expect
      .poll(() =>
        pageJerry!.evaluate(() => {
          const filters = JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}');
          return [filters.minDistanceMiles, filters.maxDistanceMiles];
        }),
      )
      .toEqual([1, 3]);
    await pageJerry.evaluate(async () => {
      const app = (window as any).__iinpublic_app.getApp();
      const filters = JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}');
      await app.userService.updateTalkFilters(app.currentUser.id, filters);
    });
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await expect(pageJerry.locator('#settings-min-distance')).toHaveValue('1');
    await expect(pageJerry.locator('#settings-max-distance')).toHaveValue('3');
    await afterAction();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-min-distance').fill('0');
    await pageJerry.locator('#settings-min-distance').press('Tab');
    await pageJerry.locator('#settings-max-distance').fill('0');
    await pageJerry.locator('#settings-max-distance').press('Tab');
    await expect
      .poll(() =>
        pageJerry!.evaluate(() => {
          const filters = JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}');
          return [filters.minDistanceMiles, filters.maxDistanceMiles];
        }),
      )
      .toEqual([0, 0]);
    await pageJerry.evaluate(async () => {
      const app = (window as any).__iinpublic_app.getApp();
      const filters = JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}');
      await app.userService.updateTalkFilters(app.currentUser.id, filters);
    });
    await expect
      .poll(() =>
        pageJerry!.evaluate(async () => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          const userId = app?.currentUser?.id;
          const node = userId ? await app?.gunService?.get?.(`user-talk-filters/${userId}`) : null;
          if (!node?.filtersJson) return null;
          const filters = JSON.parse(node.filtersJson);
          return [filters.minDistanceMiles, filters.maxDistanceMiles];
        }),
        { timeout: 20_000, intervals: [200, 500, 1000] },
      )
      .toEqual([0, 0]);
  });
});
