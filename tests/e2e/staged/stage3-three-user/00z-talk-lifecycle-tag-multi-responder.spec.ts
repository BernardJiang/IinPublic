/**
 * Phase D4 — tag talk: match vs mismatch responders; creator sees one match only.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  completeTalkInAppByAnswerIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
import {
  createTagTalkForLifecycle,
  tagMatchAnswerIds,
  tagIgnoreAnswerIds,
} from '../../helpers/talk-lifecycle-fixtures';
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

const TAG_TITLE = 'Lifecycle Matrix Tag';

test.describe('Talk lifecycle — tag multi-responder matrix (D4)', () => {
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

  test('tag match from one responder and mismatch from another yield a single creator match', async () => {
    test.setTimeout(420_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Tag Matrix');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Tag Matrix');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob Tag Matrix');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const created = await createTagTalkForLifecycle(pageTom, TAG_TITLE);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageTom);

    await completeTalkInAppByAnswerIds(
      pageJerry,
      created.talkId,
      created.talkData,
      tagMatchAnswerIds(),
      'match',
    );
    await completeTalkInAppByAnswerIds(
      pageBob,
      created.talkId,
      created.talkData,
      tagIgnoreAnswerIds(),
      'mismatch',
    );

    await waitForStatusBarMatchCountAtLeast(pageTom, 1, 120_000);

    // TODO §M3/Me-tab-merge: the row's visible content is the question, not the talk
    // title, and the Match/Mismatch outcome lives in the row's hidden details popup —
    // `.filter({ hasText })` matches hidden descendant text too, so it still locates rows.
    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await afterSync();
    const jerryTagRow = pageJerry.locator('#answers-content .answer-talk-item').filter({ hasText: TAG_TITLE }).first();
    await expect(jerryTagRow).toBeVisible({ timeout: 30_000 });
    await expect(jerryTagRow.filter({ hasText: /Match/i })).toHaveCount(1, { timeout: 15_000 });

    await pageBob.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageBob, 'me');
    await afterSync();
    const bobTagRow = pageBob.locator('#answers-content .answer-talk-item').filter({ hasText: TAG_TITLE }).first();
    await expect(bobTagRow).toBeVisible({ timeout: 30_000 });
    await expect(bobTagRow.filter({ hasText: /Mismatch/i })).toHaveCount(1, { timeout: 15_000 });
    await afterAction();
  });
});
