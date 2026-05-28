/**
 * Phase D4 — intake-filtered responder in multi-responder matrix:
 * Tom broadcasts a flow talk; Jerry matches; Bob has flow type filtered out
 * (allowedTalkTypes excludes 'flow') so Bob never receives the talk.
 * Creator sees exactly 1 match (Jerry). Bob's IN list stays empty.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  createTalksFromCompanyPage,
  completeTalkInAppByAnswerIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
import {
  buildFlowTalkPayload,
  flowMatchAnswerIds,
  LIFECYCLE_FLOW_MATCH_TEXT,
  LIFECYCLE_FLOW_IGNORE_TEXT,
} from '../../helpers/talk-lifecycle-fixtures';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  syncIncomingFromServer,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

const FLOW_TITLE = 'Lifecycle Matrix Flow Intake Filtered';

test.describe('Talk lifecycle — intake-filtered responder matrix (D4)', () => {
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
    await maybeClearGunDatabases();
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
    await maybeClearGunDatabases();
  });

  test('flow talk filtered for Bob yields only Jerry match visible to creator', async () => {
    test.setTimeout(420_000);

    // --- Bootstrap all three users ---
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Filtered Matrix');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Filtered Matrix');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob Filtered Matrix');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // --- Bob disables flow talks in intake filter settings ---
    await pageBob.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageBob.locator('.settings-talk-filter-type[value="flow"]').uncheck();
    await expect(pageBob.locator('.settings-talk-filter-type[value="flow"]')).not.toBeChecked();
    await pageBob.evaluate(async () => {
      const app = (window as any).__iinpublic_app.getApp();
      await app.userService.updateTalkFilters(app.currentUser.id, app.currentUser.talkFilters);
    });
    // Wait until localStorage confirms filter persisted
    await expect
      .poll(
        () =>
          pageBob!.evaluate(() => {
            const raw = localStorage.getItem('iinpublic_talk_intake_filters') || '{}';
            const filters = JSON.parse(raw) as { allowedTalkTypes?: string[] };
            return filters.allowedTalkTypes ?? [];
          }),
        { timeout: 15_000 },
      )
      .not.toContain('flow');
    await pageBob.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();

    // --- Tom creates and broadcasts the flow talk ---
    const tomId = await pageTom.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const [created] = await createTalksFromCompanyPage(pageTom, [
      buildFlowTalkPayload(tomId, FLOW_TITLE, {
        matchText: LIFECYCLE_FLOW_MATCH_TEXT,
        ignoreText: LIFECYCLE_FLOW_IGNORE_TEXT,
      }),
    ]);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageTom);

    // --- Jerry answers with the match path ---
    await completeTalkInAppByAnswerIds(
      pageJerry,
      created.talkId,
      created.talkData,
      flowMatchAnswerIds(),
      'match',
    );

    // --- Creator sees exactly 1 match (from Jerry) ---
    await waitForStatusBarMatchCountAtLeast(pageTom, 1, 120_000);

    // --- Bob's IN list must NOT contain the flow talk (filtered server-side) ---
    await pageBob.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageBob, 'talks');
    await syncIncomingFromServer(pageBob);
    await afterSync();
    await expect(pageBob.locator('#talks-list')).not.toContainText(FLOW_TITLE);

    // --- Bob's Me/Answers tab should have no answered entry for this talk ---
    await pageBob.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageBob, 'me');
    await afterSync();
    await expect(pageBob.locator('#answers-content')).not.toContainText(FLOW_TITLE);

    await afterAction();
  });
});
