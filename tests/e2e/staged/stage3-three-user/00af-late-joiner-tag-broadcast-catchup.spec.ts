/**
 * Regression test for two bugs found together while investigating a manual report
 * that an already-broadcast `type: 'tag'` talk never reached a chatroom member who
 * joined the room after the broadcast:
 *
 *  1. The "already sent" ledger check used by the automatic late-joiner catch-up path
 *     (`isBroadcastUnsentForReceiver`) compared the wrong identity key — the whole-talk
 *     key — against what delivery actually records for tag talks (per-tag keys via
 *     `buildTagIdentityKeys`). Fixed in `ui-manager.ts`.
 *  2. `syncPeerMeshRoom` permanently marked a newly-arrived peer as "scheduled" (never
 *     retried) whenever the broadcaster wasn't viewing the room at the exact moment the
 *     mesh join promise resolved, silently dropping catch-up for that peer forever even
 *     if the broadcaster returned to the room later. Fixed in `app.ts`.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { createTagTalkForLifecycle } from '../../helpers/talk-lifecycle-fixtures';
import {
  bootstrapUser,
  finalCleanupPages,
  incomingClustersIncludeTitleForUser,
  resetTalksMatchingSession,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

const TAG_TITLE = 'Late Joiner Tag Catchup';

test.describe('Late joiner receives an already-broadcast tag talk (catch-up)', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserKate: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextKate: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageKate: Page | undefined;

  test.beforeAll(async () => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserKate = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageKate },
      { tom: contextTom, jerry: contextJerry, bob: contextKate },
      clearGunForStage3Spec,
    );
    pageTom = pageJerry = pageKate = undefined;
    contextTom = contextJerry = contextKate = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry, bob: pageKate },
      { tom: contextTom, jerry: contextJerry, bob: contextKate },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('tag talk broadcast before Kate joined the room still reaches her automatically', async () => {
    test.setTimeout(300_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Catchup');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Catchup');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await createTagTalkForLifecycle(pageTom, TAG_TITLE);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageTom, { minSent: 1 });

    const jerryId = await pageJerry.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    await expect
      .poll(
        async () =>
          (await incomingClustersIncludeTitleForUser(pageJerry, jerryId, TAG_TITLE)) ? 'found' : 'absent',
        { timeout: 60_000, intervals: [500, 1000] },
      )
      .toBe('found');

    // Kate joins the same room only now, after Tom's broadcast to Jerry already
    // completed. Tom stays on the chatroom tab the whole time so the roster-change
    // callback that drives catch-up (syncPeerMeshRoom) fires while he is actually
    // watching this room — the exact condition bug #2 above depends on.
    const kate = await bootstrapUser(browserKate, 'Kate', 'Kate Catchup');
    contextKate = kate.context;
    pageKate = kate.page;
    await pageKate.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await waitForDistinctGunPeersExcludingSelf(pageTom, 2, 120_000);

    const kateId = await pageKate.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    await expect
      .poll(
        async () =>
          (await incomingClustersIncludeTitleForUser(pageKate, kateId, TAG_TITLE)) ? 'found' : 'absent',
        {
          timeout: 60_000,
          intervals: [500, 1000, 2000],
          message: 'Kate (late joiner) should automatically receive the tag talk Tom already broadcast to Jerry',
        },
      )
      .toBe('found');
  });
});
