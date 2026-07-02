/**
 * Read-state / unread badge lifecycle on top of the fast-matched-DM setup:
 * 1. A sends 2 messages while B's conversation overlay is closed → B's Me-tab badge appears.
 * 2. B opens the conversation → badge clears (read cursor recorded).
 * 3. B reloads the page → badge stays cleared (read cursor persisted in localStorage,
 *    survives reload — see ui-manager.ts syncConversationMessageSummary's
 *    `iinpublic:conversation-read-cursors` key).
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, reloadAppReady } from '../../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
} from '../../helpers/fast-dm-setup';

test.describe('Messaging: unread badge appears, clears on open, and stays cleared after reload', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=640,1100'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('unread badge lifecycle survives a reload via persisted read cursor', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'ReadA', 'ReadB');
    const { pageA, pageB, conversationId, userIdA } = pair;

    // Both overlays are open after setup — close B's so the incoming messages register as
    // unread (displayConversationMessages/syncConversationMessageSummary only counts a
    // conversation unread when it is NOT the currently-open one).
    await pageB.click('#back-from-conversation');
    await afterAction();

    await sendConversationMessage(pageA, conversationId, userIdA, 'Read-state message 1');
    await sendConversationMessage(pageA, conversationId, userIdA, 'Read-state message 2');

    const meNavB = pageB.locator('.nav-btn[data-view="me"]');
    await pageB.click('.nav-btn[data-view="me"]');

    // Badge appears once B's preview subscription (wired on conversationAdded/ingest) picks
    // up both new messages.
    await expect(meNavB.locator('.notification-badge')).toBeVisible({ timeout: 20_000 });

    // Opening the conversation clears the badge (records the read cursor).
    await pageB.evaluate((cid: string) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      app?.uiManager?.showConversationDetail?.(cid);
    }, conversationId);
    await expect(pageB.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(
        () =>
          pageB
            .locator('#conversation-messages .message-text')
            .filter({ hasText: 'Read-state message 2' })
            .first()
            .isVisible()
            .catch(() => false),
        { timeout: 20_000 },
      )
      .toBe(true);

    await pageB.click('#back-from-conversation');
    await afterAction();
    await expect(meNavB.locator('.notification-badge')).not.toBeVisible({ timeout: 10_000 });

    // Reload B: read cursor must survive (localStorage), so the badge stays cleared even
    // though the conversation preview subscription re-establishes from scratch.
    await reloadAppReady(pageB);
    await pageB.click('.nav-btn[data-view="me"]');
    await afterAction();
    await expect(meNavB.locator('.notification-badge')).not.toBeVisible({ timeout: 15_000 });
  });
});
