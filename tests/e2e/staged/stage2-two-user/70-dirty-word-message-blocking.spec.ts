/**
 * Dirty-word message filtering, both directions (redesign §9.1, TODO item H / T9).
 *
 * SEND path (sender's own filter): a composer message containing a blocked word is
 *   not sent, the composer text is preserved, a warning toast fires
 *   (`data-content-filter-notification="send"`), and the peer receives nothing.
 * Clean + "cocktail" messages pass (whole-word matching — "cocktail" ≠ "cock").
 * RECEIVE path (receiver's own filter): when the sender has the filter off but the
 *   receiver has it on, the message reaches the receiver's Gun graph but is
 *   suppressed at render — a collapsed placeholder row + a
 *   `data-content-filter-notification="receive"` toast. Toggling the receiver's
 *   filter off reveals the previously hidden message.
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

/** Set this device's message filters directly (localStorage + live UIManager state) and re-render. */
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

const DEFAULTS = ['fuck', 'cunt', 'bitch', 'cock'];

test.describe('Messaging: dirty-word filter blocks on send and hides on receive', () => {
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

  test('send-block, clean pass, cocktail pass, receive-hide + reveal', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'DirtyA', 'DirtyB');
    const { pageA, pageB, conversationId, userIdB } = pair;

    // Both sides start with the filter enabled and the default list.
    await setFilters(pageA, { blockDirtyWords: true, requireGoodGrammar: false, dirtyWords: DEFAULTS });
    await setFilters(pageB, { blockDirtyWords: true, requireGoodGrammar: false, dirtyWords: DEFAULTS });

    // --- SEND BLOCK: A types a blocked word into the real composer ---
    await pageA.fill('#conversation-message-input', 'you fuck');
    await pageA.click('#send-conversation-message');
    await afterSync();

    // Toast fired with the send marker.
    await expect(pageA.locator('[data-content-filter-notification="send"]').first()).toBeVisible({ timeout: 5000 });
    // Composer text preserved (not sent, not cleared).
    await expect(pageA.locator('#conversation-message-input')).toHaveValue('you fuck');
    // Peer B never receives it.
    await afterSync();
    expect(
      await pageB.locator('#conversation-messages .message-text').filter({ hasText: 'you fuck' }).count(),
    ).toBe(0);

    // Clear the composer for the next case.
    await pageA.fill('#conversation-message-input', '');

    // --- CLEAN PASS ---
    await pageA.fill('#conversation-message-input', 'hello there friend');
    await pageA.click('#send-conversation-message');
    await waitForMessageVisible(pageB, 'hello there friend', 20_000);
    await expect(pageA.locator('#conversation-message-input')).toHaveValue('');

    // --- "cocktail" PASSES (whole-word: cocktail != cock) ---
    await pageA.fill('#conversation-message-input', 'lets grab a cocktail');
    await pageA.click('#send-conversation-message');
    await waitForMessageVisible(pageB, 'lets grab a cocktail', 20_000);

    // --- RECEIVE HIDE: B turns its own filter OFF so it can send a blocked word;
    //     A keeps the filter ON, so A hides it at render. ---
    await setFilters(pageB, { blockDirtyWords: false, requireGoodGrammar: false, dirtyWords: DEFAULTS });
    await sendConversationMessage(pageB, conversationId, userIdB, 'you cock');

    // A shows a collapsed placeholder + a receive toast, and never the raw text.
    await expect(pageA.locator('[data-testid="hidden-message-placeholder"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(pageA.locator('[data-content-filter-notification="receive"]').first()).toBeVisible({ timeout: 5000 });
    expect(
      await pageA.locator('#conversation-messages .message-text').filter({ hasText: 'you cock' }).count(),
    ).toBe(0);

    // --- REVEAL: A turns its filter off; the hidden message becomes visible. ---
    await setFilters(pageA, { blockDirtyWords: false, requireGoodGrammar: false, dirtyWords: DEFAULTS });
    await expect
      .poll(
        () => pageA.locator('#conversation-messages .message-text').filter({ hasText: 'you cock' }).count(),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    expect(await pageA.locator('[data-testid="hidden-message-placeholder"]').count()).toBe(0);
  });
});
