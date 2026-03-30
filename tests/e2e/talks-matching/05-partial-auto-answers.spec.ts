/**
 * Flattened / context-aware saved answers: Jerry completes a 3-Q talk (Sun), then opens a new
 * talk (Sat) with the same first two questions — the UI auto-advances Q1–Q2; Jerry only answers Q3.
 *
 * Depends on incoming talks opening with auto-answer enabled (`showTalkDetail` → `demandFullTalk*`
 * callbacks use `skipAutoAnswer: false`) so saved flat prefs apply when using View on an IN row.
 */
import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterAction } from '../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';

const TITLE_SUN = 'E2E Partial Auto Sun';
const TITLE_SAT = 'E2E Partial Auto Sat';

/** Fill a 3-question linear matching talk; last question Yes → match, No → ignore. */
async function fillThreeQuestionTalk(
  page: Page,
  title: string,
  thirdQuestionText: string,
): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'matching');
  await page.click('#add-question-btn');
  await afterAction();
  await page.click('#add-question-btn');
  await afterAction();

  const q0 = page.locator('.question-item').nth(0);
  await q0.locator('.question-text').fill('Do you play tennis?');
  await q0.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_1');
  await q0.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

  const q1 = page.locator('.question-item').nth(1);
  await q1.locator('.question-text').fill('Can you play at Balboa Activity Center?');
  await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_2');
  await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

  const q2 = page.locator('.question-item').nth(2);
  await q2.locator('.question-text').fill(thirdQuestionText);
  await q2.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q2.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Talks matching — partial auto-answers (flattened context)', () => {
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

  test.beforeAll(async () => {
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

  test('Jerry finishes talk with Sunday; new talk Sat skips Q1–Q2 then Jerry answers Q3', async () => {
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

    // --- Talk 1 (Sunday): Jerry answers all three with auto mode; match on last ---
    await fillThreeQuestionTalk(pageTom!, TITLE_SUN, 'Can you play on Sunday?');
    await pageTom!.click('#broadcast-talk-btn');
    await waitForTabActive(pageTom!, 'chatrooms');

    await afterSync();
    await pageJerry!.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry!, TITLE_SUN);

    const modal1 = pageJerry!.locator('#talk-response-modal');
    await modal1.locator('input.choice-radio[data-answer-text="Yes"][data-mode="auto"]').first().click();
    await afterAction();
    await modal1.locator('input.choice-radio[data-answer-text="Yes"][data-mode="auto"]').first().click();
    await afterAction();
    await modal1.locator('input.choice-radio[data-is-match="true"][data-mode="auto"]').click();
    await waitForResponseModalClosed(pageJerry!);
    await waitForTabActive(pageJerry!, 'talks');

    // --- Talk 2 (Saturday): same Q1–Q2, different Q3 → flattened prefs auto-fill until Q3 ---
    await fillThreeQuestionTalk(pageTom!, TITLE_SAT, 'Can you play on Saturday?');
    await pageTom!.click('#broadcast-talk-btn');
    await waitForTabActive(pageTom!, 'chatrooms');

    await afterSync();
    await openIncomingTalkModal(pageJerry!, TITLE_SAT);

    const modal2 = pageJerry!.locator('#talk-response-modal');
    await expect(modal2).toContainText('Question 3 of 3');
    await expect(modal2).toContainText('Saturday');
    await expect(modal2).not.toContainText('Sunday');

    await modal2.locator('input.choice-radio[data-is-match="true"][data-mode="manual"]').click();
    await waitForResponseModalClosed(pageJerry!);
    await waitForTabActive(pageJerry!, 'talks');
  });
});
