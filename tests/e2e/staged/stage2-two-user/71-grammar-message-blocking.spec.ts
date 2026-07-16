/**
 * Grammar message filtering, both directions (redesign §9.2, TODO item H / T9).
 *
 * Same shape as the dirty-word spec, driven by the grammar filter
 * (`assessGrammar` vs CONFIG.GRAMMAR_THRESHOLD = 0.7):
 *   SEND: a below-threshold message is blocked (`data-content-filter-notification="grammar-send"`),
 *     text preserved, peer gets nothing.
 *   RECEIVE: sender's filter off + receiver's filter on ⇒ message hidden at render
 *     (`grammar-receive` toast + placeholder); toggling the receiver's filter off reveals it.
 * A well-formed sentence passes.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterSync } from '../../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
  waitForMessageVisible,
} from '../../helpers/fast-dm-setup';

type MsgFilters = { blockDirtyWords: boolean; requireGoodGrammar: boolean; dirtyWords: string[] };

async function setFilters(page: FastDmPair['pageA'], filters: MsgFilters): Promise<void> {
  await page.evaluate((f) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const full = {
      allowedLanguages: ['en'],
      minDistanceMiles: 0,
      maxDistanceMiles: 50,
      requireGoodGrammar: f.requireGoodGrammar,
      blockDirtyWords: f.blockDirtyWords,
      allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      customBlockedTerms: [],
      dirtyWords: f.dirtyWords,
    };
    localStorage.setItem('iinpublic_talk_intake_filters', JSON.stringify(full));
    const ui = app?.uiManager;
    if (ui) {
      if (ui.currentUser) ui.currentUser.talkFilters = full;
      ui.hiddenMessageToastIds?.clear?.();
      ui.rerenderOpenConversation?.();
    }
  }, filters);
  await afterSync();
}

// Five heavily-repetitive unpunctuated-feeling sentences score below the 0.7 threshold.
const BAD_GRAMMAR = 'aa aa aa aa aa aa. aa aa aa aa aa aa. aa aa aa aa aa aa. aa aa aa aa aa aa. aa aa aa aa aa aa.';
const GOOD_GRAMMAR = 'Hello, how are you doing today?';

test.describe('Messaging: grammar filter blocks on send and hides on receive', () => {
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

  test('grammar send-block, good passes, receive-hide + reveal', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'GramA', 'GramB');
    const { pageA, pageB, conversationId, userIdB } = pair;

    // Isolate grammar: dirty-word filter off, grammar filter on, on both sides.
    await setFilters(pageA, { blockDirtyWords: false, requireGoodGrammar: true, dirtyWords: [] });
    await setFilters(pageB, { blockDirtyWords: false, requireGoodGrammar: true, dirtyWords: [] });

    // --- SEND BLOCK ---
    await pageA.fill('#conversation-message-input', BAD_GRAMMAR);
    await pageA.click('#send-conversation-message');
    await afterSync();
    await expect(pageA.locator('[data-content-filter-notification="grammar-send"]').first()).toBeVisible({ timeout: 5000 });
    await expect(pageA.locator('#conversation-message-input')).toHaveValue(BAD_GRAMMAR);
    expect(
      await pageB.locator('#conversation-messages .message-text').filter({ hasText: 'aa aa aa' }).count(),
    ).toBe(0);

    await pageA.fill('#conversation-message-input', '');

    // --- GOOD GRAMMAR PASSES ---
    await pageA.fill('#conversation-message-input', GOOD_GRAMMAR);
    await pageA.click('#send-conversation-message');
    await waitForMessageVisible(pageB, GOOD_GRAMMAR, 20_000);

    // --- RECEIVE HIDE: B grammar off sends the bad message; A (grammar on) hides it. ---
    await setFilters(pageB, { blockDirtyWords: false, requireGoodGrammar: false, dirtyWords: [] });
    await sendConversationMessage(pageB, conversationId, userIdB, BAD_GRAMMAR);

    await expect(pageA.locator('[data-testid="hidden-message-placeholder"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(pageA.locator('[data-content-filter-notification="grammar-receive"]').first()).toBeVisible({ timeout: 5000 });
    expect(
      await pageA.locator('#conversation-messages .message-text').filter({ hasText: 'aa aa aa' }).count(),
    ).toBe(0);

    // --- REVEAL ---
    await setFilters(pageA, { blockDirtyWords: false, requireGoodGrammar: false, dirtyWords: [] });
    await expect
      .poll(
        () => pageA.locator('#conversation-messages .message-text').filter({ hasText: 'aa aa aa' }).count(),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    expect(await pageA.locator('[data-testid="hidden-message-placeholder"]').count()).toBe(0);
  });
});
