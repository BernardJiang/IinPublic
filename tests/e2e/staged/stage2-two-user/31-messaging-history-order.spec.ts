/**
 * Long-history ordering: several messages alternating A/B (sent sequentially, not
 * concurrently, so there is one unambiguous expected order) must render identically and
 * completely on both sides, with the oldest message reachable by scrolling up and the newest
 * reachable at the default (bottom) scroll position. The same ordered history must also
 * reappear after B reloads and re-opens the canonical pair conversation.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, reloadAppReady } from '../../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
} from '../../helpers/fast-dm-setup';
import { openConversationViaServer } from '../../helpers/conversation-e2e';

const MESSAGE_COUNT = 12;

test.describe('Messaging: long alternating history renders in full and in identical order on both sides', () => {
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

  test('alternating messages render in full and in order on both sides', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'HistA', 'HistB');
    const { pageA, pageB, conversationId, userIdA, userIdB } = pair;

    const texts: string[] = [];
    for (let i = 0; i < MESSAGE_COUNT; i++) texts.push(`hist-${i}-${i % 2 === 0 ? 'A' : 'B'}`);

    // Each side's first send pays a one-off ~8s WebRTC connect-timeout before its transport's
    // 15s post-failure cooldown kicks in (see p2p-webrtc-session.ts P2P_WEBRTC_RETRY_COOLDOWN_MS);
    // subsequent sends on that side reject fast and fall through to the (always-authoritative)
    // Gun write + offline mailbox. Paying that ~8s once per side *in parallel* up front — rather
    // than absorbing it serially inside the alternating loop below — is what keeps 16 sequential
    // sends inside budget in this sandbox (no real WebRTC connectivity between browser contexts).
    await Promise.all([
      sendConversationMessage(pageA, conversationId, userIdA, 'warmup-A'),
      sendConversationMessage(pageB, conversationId, userIdB, 'warmup-B'),
    ]);

    // Strictly sequential — alternating sender — so there is exactly one correct order.
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      const sender = i % 2 === 0 ? pageA : pageB;
      const senderId = i % 2 === 0 ? userIdA : userIdB;
      await sendConversationMessage(sender, conversationId, senderId, texts[i]);
    }

    // Two warmup messages (raced concurrently, order among themselves not asserted) precede
    // the strictly-ordered history; filter them out before comparing the ordered tail.
    const readHistoryOrder = async (page: typeof pageA) => {
      const all = await page.locator('#conversation-messages .message-text').allTextContents();
      return all.filter((t) => !t.startsWith('warmup-'));
    };

    await expect.poll(async () => (await readHistoryOrder(pageA)).length, { timeout: 15_000 }).toBe(MESSAGE_COUNT);
    await expect.poll(async () => (await readHistoryOrder(pageB)).length, { timeout: 15_000 }).toBe(MESSAGE_COUNT);

    const orderA = await readHistoryOrder(pageA);
    const orderB = await readHistoryOrder(pageB);
    expect(orderA).toEqual(texts);
    expect(orderB).toEqual(texts);

    // Newest reachable at default (bottom) scroll position.
    const messagesA = pageA.locator('#conversation-messages');
    await expect(messagesA.locator('.message-text').filter({ hasText: texts[MESSAGE_COUNT - 1] })).toBeVisible();

    // Oldest reachable by scrolling to top.
    await messagesA.evaluate((el) => { el.scrollTop = 0; });
    await expect(messagesA.locator('.message-text').filter({ hasText: texts[0] })).toBeVisible();

    await reloadAppReady(pageB);
    await openConversationViaServer(pageB, userIdB, pair.nameA, userIdA);
    await expect.poll(async () => (await readHistoryOrder(pageB)).length, { timeout: 25_000 }).toBe(MESSAGE_COUNT);
    expect(await readHistoryOrder(pageB)).toEqual(texts);
  });
});
