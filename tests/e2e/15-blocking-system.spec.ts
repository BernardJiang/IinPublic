import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterAction, afterSync, headless } from './helpers/timing';
import { gunBaseURL } from './helpers/ports';
import {
  bootstrapUser,
  openIncomingTalkModal,
  waitForResponseModalClosed,
  waitForTabActive,
  resetTalksMatchingSession,
} from './helpers/talks-matching-flow';

async function enterGlobalChatroom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('.chatroom-item:has-text("Global")');
  await page.waitForSelector('.chatroom-member-item', { timeout: 15000 });
  await afterSync();
}

async function createMatchTalk(page: Page, title: string): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Blocking test: want coffee?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Blocking system', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
    browserJerry = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'] });
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = undefined;
    pageJerry = undefined;
    contextTom = undefined;
    contextJerry = undefined;
  });

  test.afterAll(async () => {
    await pageTom?.close().catch(() => {});
    await pageJerry?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunDatabases();
  });

  test('block stops delivery and hides peer detail from the blocked user', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await createMatchTalk(pageTom, 'Blocking Warmup Talk');
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await openIncomingTalkModal(pageJerry, 'Blocking Warmup Talk');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    const tomUserId = await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
    const jerryUserId = await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const jerryContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.click('#contact-block-toggle-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });

    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(tomUserId)}/blocks`);
          if (!res.ok()) return [];
          return (await res.json() as { blockedUserIds: string[] }).blockedUserIds;
        },
        { timeout: 15000 },
      )
      .toContain(jerryUserId);

    await pageTom.click('#back-to-contacts-list');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Blocked' }).first()).toBeVisible({ timeout: 10000 });

    await enterGlobalChatroom(pageTom);
    const jerryMember = pageTom.locator('.chatroom-member-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryMember).toBeVisible({ timeout: 15000 });
    await jerryMember.click();
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#peer-send-talks-btn')).toBeDisabled({ timeout: 10000 });
    await expect(pageTom.locator('#peer-block-user-btn')).toContainText('Unblock User');
    await pageTom.click('#back-from-peer-detail');

    await createMatchTalk(pageTom, 'Blocked Delivery Talk');
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(`${gunBaseURL()}/api/users/${encodeURIComponent(jerryUserId)}/incoming-talks`);
          if (!res.ok()) return false;
          const clusters = await res.json() as Array<{ title?: string }>;
          return clusters.some((cluster) => String(cluster.title || '').includes('Blocked Delivery Talk'));
        },
        { timeout: 12000 },
      )
      .toBe(false);

    await enterGlobalChatroom(pageJerry);
    const tomMember = pageJerry.locator('.chatroom-member-item').filter({ hasText: 'Tom' }).first();
    await expect(tomMember).toBeVisible({ timeout: 15000 });
    await tomMember.click();
    await expect(pageJerry.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageJerry.locator('#peer-stats-section')).toContainText('Profile unavailable', { timeout: 10000 });
    await expect(pageJerry.locator('#peer-detail-subtitle')).toContainText('blocked', { timeout: 10000 });
  });
});
