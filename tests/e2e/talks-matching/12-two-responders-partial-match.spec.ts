/**
 * Tom broadcasts one talk. Jerry answers the match branch; Bob answers the ignore branch.
 * Verifies: Tom sees exactly 1 match (not 2), Jerry has a conversation with Tom,
 * Bob does NOT appear in Tom's conversation list.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunDatabases } from '../helpers/clear-database';
import { afterSync, afterAction } from '../helpers/timing';
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
 * Wait for localStorage to contain exactly `expectedCount` unread conversations.
 *
 * On each poll cycle: emit needConversationSync (which now uses .map().once() to
 * correctly resolve Gun soul-references), wait 700ms for the Gun snapshot to land
 * in localStorage, then read the count. Returns as soon as the count matches.
 *
 * expect.poll re-runs the async function until toBe() passes or the timeout fires,
 * so we get retries without a manual loop.
 */
async function waitForConversationsInLocalStorage(page: Page, expectedCount: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit?.('needConversationSync');
        });
        // Gun .map().once() resolves with a 500ms internal timeout; add buffer.
        await new Promise((r) => setTimeout(r, 700));
        return page.evaluate(() => {
          try {
            const c = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(c).filter((v: any) => v && v.unread === true).length;
          } catch {
            return 0;
          }
        });
      },
      { timeout: 15_000, message: `Expected ${expectedCount} unread conversation(s) in localStorage` },
    )
    .toBe(expectedCount);
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

    // Tom: wait for localStorage to show exactly 1 unread conversation (Jerry), then verify the UI.
    // waitForConversationsInLocalStorage uses page.waitForFunction so it returns the instant
    // the condition is true — no fixed sleep loop, no 45s deadline.
    await waitForConversationsInLocalStorage(pageTom, 1);
    await pageTom.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageTom, 'me');
    await expect(pageTom.locator('.nav-btn[data-view="me"] .notification-badge')).toHaveText('1', { timeout: 5_000 });
    await expect(pageTom.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first()).toBeVisible({ timeout: 5_000 });
    await expect(pageTom.locator('.conversation-list-item')).toHaveCount(1, { timeout: 5_000 });
    await expect(pageTom.locator('.conversation-list-item').filter({ hasText: 'Bob' }).first()).not.toBeVisible();

    // Jerry: has conversation with Tom (server returned convId in the HTTP response,
    // so localStorage is already updated before the modal closed)
    await waitForConversationsInLocalStorage(pageJerry, 1);
    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await expect(pageJerry.locator('.conversation-list-item').filter({ hasText: 'Tom' }).first()).toBeVisible({ timeout: 5_000 });
  });
});
