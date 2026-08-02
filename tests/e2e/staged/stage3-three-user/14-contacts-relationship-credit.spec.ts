import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import {
  bootstrapUser,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';

import { openCollapsedFilters } from '../../helpers/filter-bar';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

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
  await submitTalkEditorAndWaitForOut(page, title);
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
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
      clearGunForStage3Spec,
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
    await clearGunForStage3Spec();
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
    await broadcastFromGlobalChatroom(pageTom);
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
    // Rule N2a: dismiss the auto-opened DM conversation to use the User layout.
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await pageTom.click('#back-from-conversation');
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('.contact-profile-languages')).toContainText('English (shared)');

    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await pageTom.selectOption('#contact-relationship-label', 'custom');
    await pageTom.fill('#contact-relationship-custom-label', 'Coffee Circle');
    await pageTom.fill('#contact-relationship-nickname', 'J');
    await pageTom.selectOption('#contact-relationship-rating', '4');
    await pageTom.fill('#contact-relationship-notes', 'coffee buddy');
    await pageTom.click('#contact-relationship-save-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toHaveCount(0, { timeout: 10000 });

    await pageTom.click('#back-from-peer-detail');
    await afterAction();
    const updatedContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'J (Jerry)' }).first();
    await expect(updatedContact).toBeVisible({ timeout: 10000 });
    await expect(updatedContact).toContainText('Coffee Circle');
    await expect(pageTom.locator('#contacts-sort-order option[value="relationship"]')).toHaveText('Relationship');
    await openCollapsedFilters(pageTom, 'contacts-filter-toggle');
    await pageTom.selectOption('#contacts-sort-order', 'relationship');
    await pageTom.fill('#contacts-filter-name', 'Coffee Circle');
    await expect(pageTom.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(1);
    await pageTom.selectOption('#contacts-filter-relation', 'custom');
    await afterSync();

    // Wait for filter-triggered list refreshes before clicking the newly bound row.
    const finalContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'J (Jerry)' }).first();
    await expect(finalContact).toBeVisible({ timeout: 10000 });
    await finalContact.evaluate((row) => (row as HTMLElement).click());
    await afterSync();
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await pageTom.click('#back-from-conversation');
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry');
    await expect(pageTom.locator('.contact-context-relationship')).toContainText('Coffee Circle');
    await expect(pageTom.locator('.contact-context-notes')).toContainText('coffee buddy');
    await expect(pageTom.locator('.contact-context-credit')).toContainText('Public credit');
    await expect(pageTom.locator('.contact-context-block-status')).toContainText('No block is active');
    await expect(pageTom.locator('#contact-edit-relationship-btn')).toBeVisible({ timeout: 15000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-label')).toHaveValue('custom');
    await expect(pageTom.locator('#contact-relationship-custom-label')).toHaveValue('Coffee Circle');
    await expect(pageTom.locator('#contact-relationship-nickname')).toHaveValue('J');
    await expect(pageTom.locator('#contact-relationship-rating')).toHaveValue('4');
    await expect(pageTom.locator('#contact-relationship-notes')).toHaveValue('coffee buddy');
  });
});
