/**
 * Alice creates a tag, broadcasts. Tom opens it and leaves the checkbox unchecked (mismatch).
 * Answered incoming tags are removed from IN and retained in Me history.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterAction } from '../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../helpers/talks-matching-browsers';
import { confirmBroadcastTagPreambleIfVisible } from '../helpers/broadcast-preamble';
import {
  bootstrapUser,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtMost } from '../helpers/durable-ui';

const TAG_TITLE = 'E2E Tag Reopen Coffee';

test.describe('Talks matching — tag answer removed from IN', () => {
  let browsers: ThreeBrowsers;
  let browserAlice: Browser;
  let browserTom: Browser;
  let browserBob: Browser;
  let contextAlice: BrowserContext | undefined;
  let contextTom: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageAlice: Page | undefined;
  let pageTom: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserAlice = browsers.tom;   // reuse the three-browser pool
    browserTom = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageAlice, jerry: pageTom, bob: pageBob },
      { tom: contextAlice, jerry: contextTom, bob: contextBob },
    );
    pageAlice = pageTom = pageBob = undefined;
    contextAlice = contextTom = contextBob = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageAlice, jerry: pageTom, bob: pageBob },
      { tom: contextAlice, jerry: contextTom, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunDatabases();
  });

  test('Tom ignores tag (unchecked), reopens it, checks box → match', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Alice creates and broadcasts a tag
    await pageAlice.click('#create-talk-btn');
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.locator('input[name="talk-type-radio"][value="tag"]').click();
    await afterAction();
    await pageAlice.fill('#talk-title', TAG_TITLE);
    await pageAlice.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageAlice.click('#broadcast-talk-btn');
    await confirmBroadcastTagPreambleIfVisible(pageAlice);
    await afterAction();

    // Tom opens the tag and leaves the checkbox unchecked → mismatch
    await afterSync();
    await openIncomingTalkModal(pageTom, TAG_TITLE);
    await pageTom.locator('#tag-submit-response').click({ noWaitAfter: true });
    await waitForResponseModalClosed(pageTom);
    await afterSync();

    await waitForStatusBarMatchCountAtMost(pageTom, 0);
    await waitForStatusBarMatchCountAtMost(pageAlice, 0);

    // Tom's Answers tab: tag listed with Mismatch
    await pageTom.click('.nav-btn[data-view="me"]');
    await afterSync();
    await expect(pageTom.locator('#answers-content').getByText(TAG_TITLE).first()).toBeVisible({ timeout: 15000 });
    await expect(pageTom.locator('#answers-content').getByText(/Mismatch/i).first()).toBeVisible({ timeout: 10000 });

    // Answered incoming tags are removed from IN, so the old reopen path is no longer available.
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageTom.click('#talks-nav-in');
    await afterSync();
    await expect(pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: TAG_TITLE })).toHaveCount(0);
  });
});
