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

async function requestConversationSync(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit?.('needConversationSync');
  });
}

async function waitForConversationBadgeCount(page: Page, expectedCount: number): Promise<void> {
  /**
   * Poll with active conversation sync on every iteration.
   *
   * Why: after clearGunDatabases() resets gun._.graph = {}, the server
   * graph is empty but clients still replicate incrementally. When the
   * full suite runs (tests 01-11), the accumulated graph is large, so
   * a .once() snapshot taken immediately after the clear may return
   * stale/empty data. The badge reads from localStorage which is only
   * updated when the sync handler ingests fresh Gun data, so we must
   * keep re-syncing until the badge converges.
   */
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    // Ask Tom's client to pull the latest conversations from Gun
    await requestConversationSync(page);
    // Give Gun time to replicate the snapshot response
    await afterSync();

    const badge = page.locator('.nav-btn[data-view="me"] .notification-badge');
    try {
      const text = await badge.textContent();
      const count = Number.parseInt(String(text || '0').trim(), 10) || 0;
      if (count === expectedCount) return;
    } catch {
      // Badge not yet rendered — count stays 0
    }
    // Wait between sync + read cycles
    await afterSync();
  }
  throw new Error(`Me badge did not converge to ${expectedCount} within 45 s`);
}

async function waitForConversationVisible(page: Page, otherUserName: string): Promise<void> {
  const row = page.locator('.conversation-list-item').filter({ hasText: otherUserName }).first();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await requestConversationSync(page);
    await page.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(page, 'chatrooms');
    await afterSync();
    await page.click('.nav-btn[data-view="me"]');
    await waitForTabActive(page, 'me');
    await afterSync();
    if (await row.isVisible().catch(() => false)) return;
  }
  await expect(row).toBeVisible({ timeout: 5_000 });
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
    await waitForTabActive(pageTom, 'chatrooms'); // Tom receives match → app auto-navigates, conversation saved to localStorage
    await afterSync();

    // Bob answers mismatch
    await pageBob.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageBob, TALK_TITLE);
    await pageBob.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageBob);
    await waitForTabActive(pageBob, 'talks');
    await afterSync();

    // Force Tom to sync conversations from Gun before checking the badge.
    // In the full suite the server graph is large (accumulated from tests 01-11),
    // so after clearGunDatabases() the 2s wait isn't enough for replication to
    // converge. Explicit sync requests prevent the stale-conversation race.
    await requestConversationSync(pageTom);
    await afterSync();
    await requestConversationSync(pageTom);
    await afterSync();

    // Tom: exactly one unread match badge, and only Jerry appears in conversations
    await waitForConversationBadgeCount(pageTom, 1);
    await waitForConversationVisible(pageTom, 'Jerry');
    await expect(pageTom.locator('.conversation-list-item')).toHaveCount(1, { timeout: 10000 });
    await expect(pageTom.locator('.conversation-list-item').filter({ hasText: 'Bob' }).first()).not.toBeVisible();

    // Jerry: has conversation with Tom as well
    await waitForConversationBadgeCount(pageJerry, 1);
    await waitForConversationVisible(pageJerry, 'Tom');
  });
});
