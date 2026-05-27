import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  completeTalkInAppByAnswerIds,
  createTalksFromCompanyPage,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
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
import { buildFlowTalkPayload, flowMatchAnswerIds } from '../../helpers/talk-lifecycle-fixtures';

test.describe('Talk lifecycle: stranger before match, then contact', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  const MATCH_TALK = 'Lifecycle Stranger Match';

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await shutdownThreeBrowsers(browsers);
    await maybeClearGunDatabases();
  });

  test('shows stranger in contacts after match without a saved relationship label', async () => {
    test.setTimeout(360_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Lifecycle');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Lifecycle');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const tomId = await pageTom.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const [created] = await createTalksFromCompanyPage(pageTom, [
      buildFlowTalkPayload(tomId, MATCH_TALK, { matchText: 'Yes, lets meet.', ignoreText: 'No thanks.' }),
    ]);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 120_000);
    await clickBroadcastUntilBulkAck(pageTom);
    await completeTalkInAppByAnswerIds(
      pageJerry,
      created.talkId,
      created.talkData,
      flowMatchAnswerIds(),
      'match',
    );
    await waitForStatusBarMatchCountAtLeast(pageTom, 1, 120_000);

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageTom, 'contacts');
    await afterSync();
    const jerryRow = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry Lifecycle' });
    await expect(jerryRow).toBeVisible({ timeout: 60_000 });
    await expect(jerryRow).toContainText(/Stranger/i);
    await afterAction();
  });
});
