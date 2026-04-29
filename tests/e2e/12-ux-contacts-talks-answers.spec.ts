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

async function createSimpleFlowTalk(page: Page, title: string, question: string): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(question);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets do it.');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('UX polish: contacts, talks navigation, and answers details', () => {
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

  test('contacts include mismatched peers, contacts/chatroom open the same peer detail, talks nav splits IN and OUT, and answers show question plus answer', async () => {
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

    await createSimpleFlowTalk(pageTom, 'Tom Out Talk', 'Do you want to join Tom?');
    await createSimpleFlowTalk(pageJerry, 'Jerry Out Talk', 'Do you want to join Jerry?');

    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await pageJerry.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageJerry, 'chatrooms');

    await openIncomingTalkModal(pageJerry, 'Tom Out Talk');
    await pageJerry
      .locator('input.choice-radio[data-answer-text="No thanks."][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const contactItem = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(contactItem).toBeVisible({ timeout: 15000 });
    await expect(contactItem).toContainText('2 talks');
    await contactItem.click();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('.contact-talk-item').filter({ hasText: 'Tom Out Talk' }).first()).toBeVisible({ timeout: 10000 });
    await pageTom.click('#back-to-contacts-list');
    await afterAction();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await pageTom.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();
    const jerryMember = pageTom.locator('.chatroom-member-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryMember).toBeVisible({ timeout: 15000 });
    await jerryMember.click();
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry');
    await pageTom.click('#back-from-peer-detail');

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(pageTom.locator('#talks-nav-in')).toBeVisible();
    await expect(pageTom.locator('#talks-nav-out')).toBeVisible();
    await expect(pageTom.locator('#talks-list')).toContainText('Tom Out Talk');
    await expect(pageTom.locator('#talks-list')).toContainText('Jerry Out Talk');

    await pageTom.click('#talks-nav-in');
    await afterSync();
    await expect(pageTom.locator('#talks-list')).toContainText('Jerry Out Talk');
    await expect(pageTom.locator('#talks-list')).not.toContainText('Tom Out Talk');

    await pageTom.click('#talks-nav-out');
    await afterSync();
    await expect(pageTom.locator('#talks-list')).toContainText('Tom Out Talk');
    await expect(pageTom.locator('#talks-list')).not.toContainText('Jerry Out Talk');

    await pageTom.click('#talks-nav-back');
    await afterSync();
    await expect(pageTom.locator('#talks-list')).toContainText('Tom Out Talk');
    await expect(pageTom.locator('#talks-list')).toContainText('Jerry Out Talk');

    await pageJerry.click('.nav-btn[data-view="answers"]');
    await afterSync();
    const answersContent = pageJerry.locator('#answers-content');
    await expect(answersContent.getByText('Tom Out Talk').first()).toBeVisible({ timeout: 15000 });
    await expect(answersContent.getByText('Do you want to join Tom?').first()).toBeVisible({ timeout: 10000 });
    await expect(answersContent.getByText('No thanks.').first()).toBeVisible({ timeout: 10000 });
    await expect(answersContent.getByText(/1 item/i).first()).toBeVisible({ timeout: 10000 });
    await expect(answersContent.getByText(/answered 1 time/i).first()).toBeVisible({ timeout: 10000 });
    await expect(answersContent.getByText(/Mismatch/i).first()).toBeVisible({ timeout: 10000 });
  });
});
