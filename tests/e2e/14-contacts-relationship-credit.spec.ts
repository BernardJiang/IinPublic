import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterSync, afterAction } from './helpers/timing';
import {
  bootstrapUser,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
  waitForResponseModalClosed,
  waitForTabActive,
} from './helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from './helpers/talks-matching-browsers';

async function createMatchTalk(page: Page, title: string): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Want coffee?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Contacts relationship dialog', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    pageTom = pageJerry = pageBob = undefined;
    contextTom = contextJerry = contextBob = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunDatabases();
  });

  test('Contact relationship settings persist nickname, label, rating, and notes', async () => {
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

    await createMatchTalk(pageTom, 'Relationship Match Talk');
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await openIncomingTalkModal(pageJerry, 'Relationship Match Talk');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const jerryContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryContact).toBeVisible({ timeout: 15000 });
    await jerryContact.click();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.selectOption('#contact-relationship-label', 'friend');
    await pageTom.fill('#contact-relationship-nickname', 'J');
    await pageTom.selectOption('#contact-relationship-rating', '4');
    await pageTom.fill('#contact-relationship-notes', 'coffee buddy');
    await pageTom.click('#contact-relationship-save-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });

    await pageTom.click('#back-to-contacts-list');
    await afterAction();
    const updatedContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'J (Jerry)' }).first();
    await expect(updatedContact).toBeVisible({ timeout: 10000 });
    await expect(updatedContact).toContainText('Friend');

    await updatedContact.click();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-nickname')).toHaveValue('J');
    await expect(pageTom.locator('#contact-relationship-rating')).toHaveValue('4');
    await expect(pageTom.locator('#contact-relationship-notes')).toHaveValue('coffee buddy');
  });
});
