/**
 * Concurrent send ordering: A and B each fire 3 messages without awaiting between sends
 * (interleaved, not sequential). Both sides must converge on the SAME final order and all
 * 6 messages must be visible on both. Gun is authoritative (timestamp-ordered on read;
 * see GunMessageStore.collectAndDecryptMessages' `.sort((a, b) => a.timestamp - b.timestamp)`),
 * so convergence is expected even though the two senders raced each other.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
  waitForMessageVisible,
} from '../../helpers/fast-dm-setup';

test.describe('Messaging: concurrent interleaved sends converge to the same order on both sides', () => {
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

  test('A and B interleave 3 messages each; both sides converge to the same 6-message order', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'ConcA', 'ConcB');
    const { pageA, pageB, conversationId, userIdA, userIdB } = pair;

    const aTexts = ['A-msg-1', 'A-msg-2', 'A-msg-3'];
    const bTexts = ['B-msg-1', 'B-msg-2', 'B-msg-3'];

    // Fire all 6 sends concurrently (interleaved across both users) — no awaiting between
    // individual sends on either side. Promise.all races them against each other; the
    // in-flight order is intentionally nondeterministic.
    await Promise.all([
      ...aTexts.map((text) => sendConversationMessage(pageA, conversationId, userIdA, text)),
      ...bTexts.map((text) => sendConversationMessage(pageB, conversationId, userIdB, text)),
    ]);

    // All 6 must become visible on both sides.
    for (const text of [...aTexts, ...bTexts]) {
      await waitForMessageVisible(pageA, text, 20_000);
      await waitForMessageVisible(pageB, text, 20_000);
    }

    const readOrder = (page: typeof pageA) =>
      page.locator('#conversation-messages .message-text').allTextContents();

    // Poll until both sides report exactly 6 rendered message rows (avoids reading mid-render).
    await expect
      .poll(async () => (await readOrder(pageA)).length, { timeout: 15_000 })
      .toBe(6);
    await expect
      .poll(async () => (await readOrder(pageB)).length, { timeout: 15_000 })
      .toBe(6);

    const orderA = await readOrder(pageA);
    const orderB = await readOrder(pageB);

    expect(new Set(orderA)).toEqual(new Set([...aTexts, ...bTexts]));
    expect(orderB).toEqual(orderA);
  });
});
