/**
 * Flattened / context-aware saved answers: Jerry completes a 3-Q talk (Sun), then opens a new
 * talk (Sat) with the same first two questions — the UI auto-advances Q1–Q2; Jerry only answers Q3.
 *
 * Uses `openIncomingTalkModalWithAutoAnswers` (app.openTalkResponseDialogWithAuto) for the second
 * talk so saved prefs apply; normal View keeps skipAutoAnswer to avoid breaking other E2E flows.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterAction } from '../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  openIncomingTalkModalWithAutoAnswers,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';

const TITLE_SUN = 'E2E Partial Auto Sun';
const TITLE_SAT = 'E2E Partial Auto Sat';

/**
 * Toast overlays (e.g. “🎉 New match…”, “Match! … noticed…”) sit over the header. Playwright will not
 * click through them. Prefer tapping each toast (app removes on click); fall back to stripping the
 * DOM if anything lingers (slow auto-dismiss races).
 */
async function dismissBlockingNotifications(page: Page): Promise<void> {
  const anyToast = page.locator('.notification');
  for (let i = 0; i < 24; i++) {
    const n = await anyToast.count();
    if (n === 0) break;
    await anyToast.last().click({ timeout: 3000 });
  }
  await page.evaluate(() => {
    document.querySelectorAll('.notification').forEach((el) => el.remove());
  });
}

/** Fill a 3-question linear matching talk; last question Yes → match, No → ignore. */
async function fillThreeQuestionTalk(
  page: Page,
  title: string,
  thirdQuestionText: string,
): Promise<void> {
  await dismissBlockingNotifications(page);
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
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
    await openIncomingTalkModalWithAutoAnswers(pageJerry!, TITLE_SAT);

    const modal2 = pageJerry!.locator('#talk-response-modal');
    const modal2Body = modal2.locator('.modal-content').first();
    // Scope to modal body so the IN list / other UI cannot add stray "Sunday" text; require third question copy.
    await expect(modal2Body).toContainText('Question 3 of 3', { timeout: 20000 });
    await expect(modal2Body.getByText(/Can you play on Saturday/i)).toBeVisible({ timeout: 10000 });
    await expect(modal2Body).not.toContainText('Can you play on Sunday');

    const matchManual = modal2.locator(
      'input.choice-radio[data-is-match="true"][data-mode="manual"]',
    );
    await expect(matchManual).toBeVisible({ timeout: 15000 });
    await matchManual.click();
    await waitForResponseModalClosed(pageJerry!);
    await waitForTabActive(pageJerry!, 'talks');
  });
});
