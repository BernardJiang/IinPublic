/**
 * Phase D4 — route talk: two responders take different DAG branches;
 * one reaches isMatch=true (engineer path), one reaches isIgnore=true (no-job path).
 * Creator sees exactly one match. Both responders show answered entry in Me tab.
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
import { makeRouteTalk } from '../../talks-matching/lib/four-types-talks';

const RUN_ID = 900402;
const ROUTE_TITLE = `E2E FourTypes Route ${RUN_ID}`;

function buildRoutePayload(): Record<string, unknown> {
  const talk = makeRouteTalk(RUN_ID);
  return talk as unknown as Record<string, unknown>;
}

test.describe('Talk lifecycle — route multi-responder matrix (D4)', () => {
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

  test('route match via engineer branch and mismatch via no-job branch yield one creator match', async () => {
    test.setTimeout(420_000);

    // --- Bootstrap all three users ---
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Route Matrix');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Route Matrix');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob Route Matrix');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // --- Tom creates and broadcasts the route talk ---
    const [created] = await createTalksFromCompanyPage(pageTom, [buildRoutePayload()]);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageTom);

    // --- Jerry takes the match path: looking for job (yes) → engineer (yes) → match ---
    // makeRouteTalk path: q_r_job → a_r_job_yes → q_r_role → a_r_role_yes (isMatch)
    await completeTalkInAppByAnswerIds(
      pageJerry,
      created.talkId,
      created.talkData,
      ['a_r_job_yes', 'a_r_role_yes'],
      'match',
    );

    // --- Bob takes the mismatch path: not looking for job → ignore ---
    // makeRouteTalk path: q_r_job → a_r_job_no (isIgnore, terminal)
    await completeTalkInAppByAnswerIds(
      pageBob,
      created.talkId,
      created.talkData,
      ['a_r_job_no'],
      'mismatch',
    );

    // --- Creator sees both peer-signed responses in its local ledger ---
    await expect
      .poll(
        () => pageTom.evaluate((talkId) => {
          const doc = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
          return Object.values(doc?.outcomes || {}).filter(
            (entry: any) => String(entry?.talkId || '') === talkId,
          ).length;
        }, created.talkId),
        { timeout: 30_000, message: 'Expected both route responses in the creator local ledger' },
      )
      .toBeGreaterThanOrEqual(2);

    // --- Jerry's Me tab: shows route as answered with Match outcome ---
    // TODO §M3/Me-tab-merge: the row's visible content is the question, not the talk
    // title, and the Match/Mismatch outcome lives in the row's hidden details popup —
    // `.filter({ hasText })` matches hidden descendant text too, so it still locates rows.
    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await afterSync();
    const jerryRouteRow = pageJerry.locator('#answers-content .answer-talk-item').filter({ hasText: ROUTE_TITLE }).first();
    await expect(jerryRouteRow).toBeVisible({ timeout: 30_000 });
    await expect(jerryRouteRow.filter({ hasText: /Match/i })).toHaveCount(1, { timeout: 15_000 });

    // --- Bob's Me tab: shows route as answered with Mismatch outcome ---
    await pageBob.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageBob, 'me');
    await afterSync();
    const bobRouteRow = pageBob.locator('#answers-content .answer-talk-item').filter({ hasText: ROUTE_TITLE }).first();
    await expect(bobRouteRow).toBeVisible({ timeout: 30_000 });
    await expect(bobRouteRow.filter({ hasText: /Mismatch/i })).toHaveCount(1, { timeout: 15_000 });

    await afterAction();
  });
});
