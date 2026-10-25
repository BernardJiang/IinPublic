/**
 * Alice creates a tag and broadcasts it. Tom Passes it, then changes his mind from the Passed
 * list and Likes it. Pass stays out of Me; Like saves the tag to outgoing and Me.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../../helpers/talks-matching-browsers';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openCollapsedFilters } from '../../helpers/filter-bar';

import {
  bootstrapUser,
  clickIncomingTagDecision,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtMost } from '../../helpers/durable-ui';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';
import { openTalkEditor } from '../../helpers/open-talk-editor';

const TAG_TITLE = 'E2E Tag Reopen Coffee';

test.describe('Talks matching — change a Tag from Passed to Liked', () => {
  let browsers: ThreeBrowsers;
  let browserAlice: Browser;
  let browserTom: Browser;
  let contextAlice: BrowserContext | undefined;
  let contextTom: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageAlice: Page | undefined;
  let pageTom: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserAlice = browsers.tom;   // reuse the three-browser pool
    browserTom = browsers.jerry;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageAlice, jerry: pageTom, bob: pageBob },
      { tom: contextAlice, jerry: contextTom, bob: contextBob },
      clearGunForStage3Spec,
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
    await clearGunForStage3Spec();
  });

  test('Tom Passes a tag, then Likes it directly from Passed', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await openCurrentChatroom(pageAlice);
    await afterSync();

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await openCurrentChatroom(pageTom);
    await afterSync();
    // Keep this assertion focused on answered IN history rather than the
    // independent auto-copy-to-OUT preference.
    await pageTom.evaluate(() => localStorage.setItem('copyTalkAutoSave', 'false'));

    // Alice creates and broadcasts a tag
    await pageAlice.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openTalkEditor(pageAlice);
    await pageAlice.waitForSelector('#talk-editor-form');
    await pageAlice.locator('input[name="talk-type-radio"][value="tag"]').click();
    await afterAction();
    await pageAlice.fill('#talk-title', TAG_TITLE);
    await submitTalkEditorAndWaitForOut(pageAlice, TAG_TITLE);
    await broadcastFromGlobalChatroom(pageAlice);
    await afterAction();

    // Tom privately Passes the tag from its compact incoming row.
    const incomingTag = pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: TAG_TITLE });
    await clickIncomingTagDecision(pageTom, TAG_TITLE, 'pass', { timeout: 90_000 });
    await expect(incomingTag).toHaveCount(0);
    await afterSync();

    await waitForStatusBarMatchCountAtMost(pageTom, 0);
    await waitForStatusBarMatchCountAtMost(pageAlice, 0);

    // Pass is a private routing decision, not an ordinary answer in Me.
    await pageTom.click('.nav-btn[data-view="me"]');
    await afterSync();
    const tagRow = pageTom.locator('#answers-content .answer-talk-item').filter({ hasText: TAG_TITLE }).first();
    await expect(tagRow).toHaveCount(0);

    // In the Passed list a tap likes the tag again; no Restore/intermediate state.
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageTom.locator('#talks-filter-outgoing').uncheck();
    await openCollapsedFilters(pageTom, 'talks-filter-toggle');
    await pageTom.locator('#talks-filter-completion').selectOption('ignored');
    await afterSync();
    const passedTag = pageTom.locator('.talk-list-item[data-role="ignored"]').filter({ hasText: TAG_TITLE });
    await expect(passedTag).toBeVisible();
    await passedTag.click();
    await expect(passedTag).toHaveCount(0);

    await pageTom.locator('#talks-filter-outgoing').check();
    await pageTom.locator('#talks-filter-completion').selectOption('unanswered');
    await expect(pageTom.locator('.talk-list-item[data-role="copied"]').filter({ hasText: TAG_TITLE })).toBeVisible();

    await pageTom.click('.nav-btn[data-view="me"]');
    await afterSync();
    await expect(tagRow).toBeVisible({ timeout: 15_000 });
    await expect(tagRow).toHaveAttribute('data-tag-state', 'checked');
    await expect(tagRow).toHaveAttribute('data-outcome', 'match');
  });
});
