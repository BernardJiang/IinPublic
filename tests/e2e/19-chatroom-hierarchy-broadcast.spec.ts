import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterSync, delay, headless } from './helpers/timing';
import { bootstrapUser, waitForTabActive } from './helpers/talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';

const BROADCAST_TOAST_ONE_USER =
  /Sent 1 talk to 1 user (?:(\(the room\)\.)|in the room\.|\(\d+ rooms\)\.)/;

/**
 * Chatroom list → expand parent row → open a hierarchy leaf (e.g. United States under North America).
 */
async function openHierarchyLeafRoom(page: Page, parentId: string, roomId: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  await afterSync();
  await page.locator(`.chatroom-item[data-chatroom-id="${parentId}"] .chatroom-expand-icon`).click();
  await afterSync();
  await page.locator(`.chatroom-item[data-chatroom-id="${roomId}"]`).click();
  await afterSync();
}

/** Open detail for an internal node (continent) from the list. */
async function openHierarchyNodeRoom(page: Page, roomId: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  await afterSync();
  await page.locator(`.chatroom-item[data-chatroom-id="${roomId}"]`).click();
  await afterSync();
}

async function createSimpleFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Hierarchy broadcast smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Chatroom hierarchy navigation and regional broadcast', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunDatabases();
  });

  test('Global → North America → United States; broadcast in country room reaches peer', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await openHierarchyLeafRoom(pageTom, 'north-america', 'usa');
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('United States', {
        timeout: 20_000,
      });

      await openHierarchyLeafRoom(pageJerry, 'north-america', 'usa');
      await expect(pageJerry.locator('#current-chatroom-title')).toContainText('United States', {
        timeout: 20_000,
      });

      await createSimpleFlowTalk(pageTom, 'USA room hierarchy broadcast');

      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(pageTom, 'chatrooms');
      await afterSync();
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom);
      await waitForTabActive(pageTom, 'chatrooms');

      await expect(pageTom.getByText(BROADCAST_TOAST_ONE_USER)).toBeVisible({ timeout: 120_000 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      await expect(
        pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({
          hasText: 'USA room hierarchy broadcast',
        }),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('Broadcaster on North America + subtree audience still registers peer in United States child room', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom2', 'Tom');
    const jerry = await bootstrapUser(browserJerry, 'Jerry2', 'Jerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await openHierarchyNodeRoom(pageTom, 'north-america');
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('North America', {
        timeout: 20_000,
      });

      await openHierarchyLeafRoom(pageJerry, 'north-america', 'usa');
      await expect(pageJerry.locator('#current-chatroom-title')).toContainText('United States', {
        timeout: 20_000,
      });

      await createSimpleFlowTalk(pageTom, 'Continent subtree broadcast');

      await pageTom.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(pageTom, 'chatrooms');
      await afterSync();
      await pageTom.click('#broadcast-talk-btn');
      await confirmBroadcastTagPreambleIfVisible(pageTom, { audienceScope: 'subtree' });
      await waitForTabActive(pageTom, 'chatrooms');

      await expect(pageTom.getByText(BROADCAST_TOAST_ONE_USER)).toBeVisible({ timeout: 180_000 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      await expect(
        pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({
          hasText: 'Continent subtree broadcast',
        }),
      ).toBeVisible({ timeout: 90_000 });
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('Navigate Europe region and open Germany (hierarchy smoke)', async () => {
    const tom = await bootstrapUser(browserTom, 'TomEU', 'Tom');
    const pageTom = tom.page;
    try {
      await openHierarchyLeafRoom(pageTom, 'europe', 'germany');
      await expect(pageTom.locator('#current-chatroom-title')).toContainText('Germany', { timeout: 20_000 });
      await expect(pageTom.locator('#current-chatroom-status')).toBeVisible();
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
    }
  });
});
