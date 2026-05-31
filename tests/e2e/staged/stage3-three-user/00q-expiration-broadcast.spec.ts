import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterSync } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { gunBaseURL } from '../../helpers/ports';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForIncomingTalkClusterOnServer,
  waitForTabActive,
  incomingClustersIncludeTitleForUser,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function createExpiringFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  await page.selectOption('#talk-expires', '1d');
  const question = page.locator('.question-item').first();
  await question.locator('.question-text').fill(`Would you like to discuss ${title}?`);
  await question.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await question.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await question.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await question.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

async function broadcastFromCurrentRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await clickBroadcastUntilBulkAck(page);
  await waitForTabActive(page, 'chatrooms');
}

async function receiverHasIncomingTitle(page: Page, title: string): Promise<boolean> {
  const receiverId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
  return incomingClustersIncludeTitleForUser(page, receiverId, title);
}

test.describe('Talk expiration broadcast behavior', () => {
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

  test('delivers an active one-day talk and excludes the same setting after it expires', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Expiration Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Expiration Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const liveTitle = 'Expiration Active Delivery';
    await createExpiringFlowTalk(pageTom, liveTitle);
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(pageTom.locator('#talks-list').filter({ hasText: liveTitle })).toContainText('Expires in');
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, liveTitle);

    const expiredTitle = 'Expiration Blocked Delivery';
    await createExpiringFlowTalk(pageTom, expiredTitle);
    await pageTom.evaluate(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 2 * 24 * 60 * 60 * 1000;
    });
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(pageTom.locator('#talks-list').filter({ hasText: expiredTitle })).toContainText('Expired');

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await expect(pageTom.locator('.notification').filter({ hasText: 'You have no talks to broadcast' })).toBeVisible({
      timeout: 15_000,
    });
    await afterSync();
    expect(await receiverHasIncomingTitle(pageJerry, expiredTitle)).toBe(false);
  });
});
