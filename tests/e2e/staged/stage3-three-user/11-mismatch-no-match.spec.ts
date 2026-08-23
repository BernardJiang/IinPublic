/**
 * Tom broadcasts a flow talk. Jerry answers the ignore (mismatch) branch.
 * Verifies: no match on either side (status bar), Tom's status bar shows no match,
 * Jerry's Answers tab lists the talk with a Mismatch label.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../../helpers/talks-matching-browsers';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';

import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtMost } from '../../helpers/durable-ui';

const TALK_TITLE = 'E2E Mismatch No Match Flow';

test.describe('Talks matching — mismatch path yields no match', () => {
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

  test('Jerry picks the ignore branch → no match toast, Tom has 0 matches, Jerry Answers tab shows Mismatch', async () => {
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

    // Tom creates a talk with a clear match branch and a clear ignore branch
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want to play tennis?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets play!');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await submitTalkEditorAndWaitForOut(pageTom, TALK_TITLE);
    await broadcastFromGlobalChatroom(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    // Jerry answers with the ignore branch
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry, TALK_TITLE);
    await pageJerry
      .locator('input.choice-radio[data-answer-text="No thanks."][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');

    await afterSync();

    await waitForStatusBarMatchCountAtMost(pageJerry, 0);
    await waitForStatusBarMatchCountAtMost(pageTom, 0);

    // Jerry's Answers tab: talk listed with Mismatch label
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterSync();
    // docs/TODO.md §LL.2 follow-up: the row's visible content is the question prompt, not the
    // talk title; the outcome is carried on the row's own data-outcome attribute now.
    const answerRow = pageJerry.locator('#answers-content .answer-talk-item').filter({ hasText: 'Want to play tennis?' }).first();
    await expect(answerRow).toBeVisible({ timeout: 15000 });
    await expect(answerRow).toHaveAttribute('data-outcome', 'mismatch');
  });
});
