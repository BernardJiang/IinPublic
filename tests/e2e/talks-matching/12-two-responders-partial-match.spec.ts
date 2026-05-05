/**
 * Tom broadcasts one talk. Jerry answers the match branch; Bob answers the ignore branch.
 * Verifies: Tom sees exactly 1 match (not 2), Jerry has a conversation with Tom,
 * Bob does NOT appear in Tom's conversation list.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterAction } from '../helpers/timing';
import { gunBaseURL } from '../helpers/ports';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../helpers/talks-matching-flow';

const TALK_TITLE = 'E2E Partial Match Tennis';

/**
 * Confirm `expectedCount` conversations exist on the server for this page's user, then inject
 * them into the browser state via addNewConversation.
 *
 * Gun's WebSocket push from server → browser is unreliable under multi-browser Playwright load,
 * so we bypass it entirely: poll GET /api/test/user-conversations/:userId (reads the server-side
 * Gun graph directly, using page.request from the test process with the correct parallelSlot port)
 * and call uiManager.addNewConversation() from inside the page once the server confirms the data
 * exists. This updates localStorage and the badge without waiting for any Gun replication.
 */
async function waitForServerConversations(page: Page, expectedCount: number): Promise<void> {
  const userId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
  if (!userId) throw new Error('waitForServerConversations: could not get userId from page');

  const url = `${gunBaseURL()}/api/test/user-conversations/${encodeURIComponent(userId)}`;

  let convs: any[] = [];
  await expect
    .poll(
      async () => {
        const res = await page.request.get(url);
        if (!res.ok()) return 0;
        const data = (await res.json()) as { conversations: any[] };
        convs = data.conversations ?? [];
        return convs.length;
      },
      { timeout: 10_000, message: `Expected ${expectedCount} conversation(s) on server for user ${userId}` },
    )
    .toBeGreaterThanOrEqual(expectedCount);

  // Inject into browser state so localStorage and badge update immediately.
  await page.evaluate((conversations) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    for (const conv of conversations) {
      app?.uiManager?.addNewConversation?.(conv);
    }
  }, convs);
}

test.describe('Talks matching — one match one mismatch from two responders', () => {
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
    await clearGunDatabases();
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
    await clearGunDatabases();
  });

  test('Jerry matches, Bob mismatches → Tom sees exactly 1 match, no Bob conversation', async () => {
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

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(pageTom, 'chatrooms');

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want tennis?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    // Jerry answers match
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry, TALK_TITLE);
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    // Bob answers mismatch
    await pageBob.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageBob, TALK_TITLE);
    await pageBob.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageBob);
    await waitForTabActive(pageBob, 'talks');
    await afterSync();

    // Tom: confirm conversation exists server-side then inject into browser state.
    await waitForServerConversations(pageTom, 1);
    await pageTom.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageTom, 'me');
    await expect(pageTom.locator('.nav-btn[data-view="me"] .notification-badge')).toHaveText('1', { timeout: 5_000 });
    await expect(pageTom.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first()).toBeVisible({ timeout: 5_000 });
    await expect(pageTom.locator('.conversation-list-item')).toHaveCount(1, { timeout: 5_000 });
    await expect(pageTom.locator('.conversation-list-item').filter({ hasText: 'Bob' }).first()).not.toBeVisible();

    // Jerry: has conversation with Tom (server returned convId in the HTTP response,
    // so localStorage is already updated before the modal closed)
    await waitForServerConversations(pageJerry, 1);
    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await expect(pageJerry.locator('.conversation-list-item').filter({ hasText: 'Tom' }).first()).toBeVisible({ timeout: 5_000 });
  });
});
