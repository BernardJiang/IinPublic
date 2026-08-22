/**
 * Two talks (Tennis + Coffee), Jerry/Bob match/mismatch; Tom status bar match count; Jerry Answers tab.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../../helpers/talks-matching-browsers';
import { afterCreateTalkBeforeBroadcast, E2E_ASSERT_TIMEOUT_MS } from '../../helpers/timing';
import { broadcastFromGlobalChatroom, waitForOutgoingTalkRow } from '../../helpers/talk-demo-ui';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';

test.describe('Talks matching — two talks, status bar, answers tab', () => {
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

  test('Tennis+Coffee: Jerry/Bob match/mismatch; Tom sees 2 matches; Answers tab lists both', async () => {
    test.setTimeout(180_000);
    const TITLE_TENNIS = 'TwoTalks e2e Tennis';
    const TITLE_COFFEE = 'TwoTalks e2e Coffee';

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

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TITLE_TENNIS);
    await pageTom.selectOption('#talk-type', 'flow');
    const q1 = pageTom.locator('.question-item').first();
    await q1.locator('.question-text').fill('Want tennis?');
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 10_000 });
    await waitForOutgoingTalkRow(pageTom, TITLE_TENNIS, E2E_ASSERT_TIMEOUT_MS);
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TITLE_COFFEE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q2 = pageTom.locator('.question-item').first();
    await q2.locator('.question-text').fill('Coffee?');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await pageTom.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 10_000 });
    await waitForOutgoingTalkRow(pageTom, TITLE_COFFEE, E2E_ASSERT_TIMEOUT_MS);
    await afterCreateTalkBeforeBroadcast();
    await broadcastFromGlobalChatroom(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry, TITLE_TENNIS);
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await openIncomingTalkModal(pageJerry, TITLE_COFFEE);
    await pageJerry.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    await pageBob.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageBob, TITLE_COFFEE);
    await pageBob.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageBob);
    await waitForTabActive(pageBob, 'talks');
    await openIncomingTalkModal(pageBob, TITLE_TENNIS);
    await pageBob.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageBob);
    await waitForTabActive(pageBob, 'talks');
    await afterSync();

    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await waitForStatusBarMatchCountAtLeast(pageTom, 2, 90_000);
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterSync();
    // docs/TODO.md §LL.2 follow-up: rows are merged by question text now, not talk title — no
    // popup anymore. data-search-text still carries the (lowercased) talk title (buildSearchText,
    // answers-view.ts, unaffected by the redesign), so it's still a stable way to locate the row.
    for (const title of [TITLE_TENNIS, TITLE_COFFEE]) {
      const row = pageJerry.locator(`.answer-talk-item[data-search-text*="${title.toLowerCase()}"]`).first();
      await expect(row).toBeVisible({ timeout: 15000 });
    }
  });
});
