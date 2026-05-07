/**
 * Multi-question talk: Jerry answers No (mismatch), reopens, changes to Yes → match.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterAction } from '../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../helpers/talks-matching-browsers';
import { confirmBroadcastTagPreambleIfVisible } from '../helpers/broadcast-preamble';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';

test.describe('Talks matching — ignore then change to match', () => {
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

  test('Jerry answers No then reopens and picks Yes → match', async () => {
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

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', 'E2E Ignore Then Match Tennis');
    await pageTom.selectOption('#talk-type', 'flow');
    await pageTom.click('#add-question-btn');
    await afterAction();
    await pageTom.click('#add-question-btn');
    await afterAction();
    const q0 = pageTom.locator('.question-item').nth(0);
    await q0.locator('.question-text').fill('Do you play tennis?');
    await q0.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_1');
    await q0.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    const q1 = pageTom.locator('.question-item').nth(1);
    await q1.locator('.question-text').fill("What's your skill level?");
    // Flow-talk rule: only the first answer may be a match or link to the
    // next question; all later answers are treated as ignore. So "amateur"
    // (the one that leads to Q3) must be the first answer.
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('amateur');
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_2');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('beginner');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await q1.locator('.btn-add-answer').click();
    await afterAction();
    await q1.locator('.answer-item').nth(2).locator('.answer-text').fill('professional');
    await q1.locator('.answer-item').nth(2).locator('.answer-next').selectOption('ignore');
    const q2 = pageTom.locator('.question-item').nth(2);
    await q2.locator('.question-text').fill('Available Sundays?');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await confirmBroadcastTagPreambleIfVisible(pageTom);
    await waitForTabActive(pageTom, 'chatrooms');

    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry, 'E2E Ignore Then Match Tennis');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await pageJerry.locator('input.choice-radio[data-answer-text="amateur"][data-mode="manual"]').first().click();
    await pageJerry.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });

    await afterSync();
    await openIncomingTalkModal(pageJerry, 'E2E Ignore Then Match Tennis');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="auto"]').first().click();
    await afterAction();
    await pageJerry.locator('input.choice-radio[data-answer-text="amateur"][data-mode="auto"]').first().click();
    await afterAction();
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await waitForTabActive(pageTom, 'chatrooms');
  });
});
