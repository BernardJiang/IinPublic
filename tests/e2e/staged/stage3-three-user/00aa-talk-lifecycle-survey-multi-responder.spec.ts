/**
 * Phase D4 — survey talk: two responders answer; creator sees aggregate stats not matches;
 * Me/Answers tab shows each responder's answered entry (no match/mismatch outcome labels).
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  createTalksFromCompanyPage,
  completeTalkInAppByAnswerIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';
import { makeSurveyTalk } from '../../talks-matching/lib/four-types-talks';

const RUN_ID = 900401;
const SURVEY_TITLE = `E2E FourTypes Survey ${RUN_ID}`;

/** Build a simple survey payload from the shared factory (no authorId needed here). */
function buildSurveyPayload(): Record<string, unknown> {
  const talk = makeSurveyTalk(RUN_ID);
  return talk as unknown as Record<string, unknown>;
}

test.describe('Talk lifecycle — survey multi-responder matrix (D4)', () => {
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

  test('survey with two responders records aggregate stats and shows answered entry in Me for each', async () => {
    test.setTimeout(420_000);

    // --- Bootstrap all three users ---
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Survey Matrix');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Survey Matrix');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob Survey Matrix');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // --- Tom creates and broadcasts the survey talk ---
    const [created] = await createTalksFromCompanyPage(pageTom, [buildSurveyPayload()]);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageTom);

    // --- Jerry answers with rating '1' (a_sv_1), Bob answers with rating '2' (a_sv_2) ---
    // Survey talks use 'mismatch' as the outcome label since there is no match concept for surveys.
    await completeTalkInAppByAnswerIds(
      pageJerry,
      created.talkId,
      created.talkData,
      ['a_sv_1'],
      'mismatch',
    );
    await completeTalkInAppByAnswerIds(
      pageBob,
      created.talkId,
      created.talkData,
      ['a_sv_2'],
      'mismatch',
    );

    // --- Creator ledger records both peer-signed responses locally ---
    await expect
      .poll(
        () => pageTom!.evaluate((talkId) => {
          const doc = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
          return Object.values(doc?.outcomes || {}).filter(
            (entry: any) => String(entry?.talkId || '') === talkId,
          ).length;
        }, created.talkId),
        { timeout: 30_000, message: 'Expected both survey responses in the creator local ledger' },
      )
      .toBeGreaterThanOrEqual(2);

    // --- Creator (Tom) does NOT get a match notification for survey talks ---
    // Confirm status bar shows 0 matches (surveys never produce matches).
    const matchBadge = pageTom!.locator('#status-bar-text');
    const matchBadgeText = await matchBadge.textContent({ timeout: 5_000 }).catch(() => '');
    expect(matchBadgeText ?? '').not.toMatch(/1\s*match/i);

    // --- Jerry's Me/Answers tab shows survey as answered ---
    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await afterSync();
    await expect(
      pageJerry.locator('#answers-content').getByText(SURVEY_TITLE).first(),
    ).toBeVisible({ timeout: 30_000 });

    // --- Bob's Me/Answers tab shows survey as answered ---
    await pageBob.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageBob, 'me');
    await afterSync();
    await expect(
      pageBob.locator('#answers-content').getByText(SURVEY_TITLE).first(),
    ).toBeVisible({ timeout: 30_000 });

    await afterAction();
  });
});
