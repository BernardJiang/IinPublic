import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases } from './helpers/clear-database';
import { afterSync } from './helpers/timing';
import {
  bootstrapUser,
  resetTalksMatchingSession,
  finalCleanupPages,
  waitForTabActive,
} from './helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from './helpers/talks-matching-browsers';
import { answerSurveyByAnswerIds, emitCreateTalkFromCompanyPage, waitForOutgoingTalkRow } from './helpers/talk-demo-ui';
import { makeRestaurantSurvey } from './talks-matching/lib/survey-restaurants';

test.describe('Survey analytics dashboard', () => {
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

  test('creator sees dashboard sections, can export CSVs, and can create a follow-up survey', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(pageJerry, 'chatrooms');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await waitForTabActive(pageBob, 'chatrooms');
    await afterSync();

    const runId = Date.now();
    const { id: _ignoredId, ...survey } = makeRestaurantSurvey();
    const title = `E2E Survey Dashboard ${runId}`;
    await emitCreateTalkFromCompanyPage(pageTom, { ...survey, title });
    const talkId = await waitForOutgoingTalkRow(pageTom, title);

    await answerSurveyByAnswerIds(pageJerry, title, ['bg_mc', 'fr_md', 'pz_ph'], talkId);
    await afterSync();
    await answerSurveyByAnswerIds(pageBob, title, ['bg_kfc', 'fr_kfc', 'pz_dom'], talkId);
    await afterSync();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageTom, 'talks');
    const talkRow = pageTom.locator('.talk-list-item[data-role="created"]').filter({ hasText: title }).first();
    await expect(talkRow).toBeVisible({ timeout: 20_000 });
    await talkRow.locator('[data-testid="survey-stats-button"]').click();

    await expect(pageTom.locator('.modal-title', { hasText: 'Survey analytics dashboard' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(pageTom.locator('#survey-stats-body')).toContainText('Responses');
    await expect(pageTom.locator('#survey-stats-body')).toContainText('Responses by day');
    await expect(pageTom.locator('#survey-stats-body')).toContainText('Responses by region');
    await expect(pageTom.locator('#survey-anon-toggle')).toBeChecked();
    await expect(pageTom.locator('#survey-stats-body')).toContainText('Hidden to preserve anonymity');

    await pageTom.locator('#survey-anon-toggle').uncheck();
    await expect(pageTom.locator('#survey-stats-body')).toContainText('McDonald');

    const summaryDownload = pageTom.waitForEvent('download');
    await pageTom.click('#survey-export-summary-btn');
    await expect(await summaryDownload).toBeTruthy();
    const dayDownload = pageTom.waitForEvent('download');
    await pageTom.click('#survey-export-day-btn');
    await expect(await dayDownload).toBeTruthy();
    const regionDownload = pageTom.waitForEvent('download');
    await pageTom.click('#survey-export-region-btn');
    await expect(await regionDownload).toBeTruthy();

    await pageTom.click('#survey-stats-followup-btn');
    await expect(pageTom.locator('#talk-editor-form')).toBeVisible({ timeout: 15_000 });
    await expect(pageTom.locator('#talk-title')).toHaveValue(new RegExp(`^Follow-up: ${title}`));
    await expect(pageTom.locator('#talk-type')).toHaveValue('survey');
  });
});
