/**
 * Long-history ordering: several messages alternating A/B (sent sequentially, not
 * concurrently, so there is one unambiguous expected order) must render identically and
 * completely on both sides. The conversation is then bulk-seeded beyond 50 total rows to
 * prove the scroll surface handles a real history depth. The same ordered core history must
 * also reappear after B reloads and re-opens the canonical pair conversation.
 */
import { chromium, Browser, type Page } from '@playwright/test';
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
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';

const MESSAGE_COUNT = 12;
const BULK_MESSAGE_COUNT = 40;

async function readConversationClassification(page: Page, conversationId: string) {
  return page.evaluate(
    ({ cid, techSupportId }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const pairConversation = conversations[cid] || null;
      const supportConversations = Object.values(conversations).filter(
        (conversation: any) =>
          conversation?.supportChannel === true &&
          conversation?.otherUserId === techSupportId,
      ) as any[];
      return {
        pairExists: !!pairConversation,
        pairOtherUserId: String(pairConversation?.otherUserId || ''),
        pairSupportChannel: pairConversation?.supportChannel === true,
        supportConversationCount: supportConversations.length,
      };
    },
    { cid: conversationId, techSupportId: TECHSUPPORT_ROOT_USER_ID },
  );
}

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

    await expect.poll(async () => readConversationClassification(pageA, conversationId)).toEqual({
      pairExists: true,
      pairOtherUserId: userIdB,
      pairSupportChannel: false,
      supportConversationCount: 1,
    });
    await expect.poll(async () => readConversationClassification(pageB, conversationId)).toEqual({
      pairExists: true,
      pairOtherUserId: userIdA,
      pairSupportChannel: false,
      supportConversationCount: 1,
    });

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
      return all.filter((t) => t.startsWith('hist-'));
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

    const bulkMessages = Array.from({ length: BULK_MESSAGE_COUNT }, (_, i) => ({
      id: `bulk-history-${i.toString().padStart(2, '0')}`,
      text: `bulk-history-${i.toString().padStart(2, '0')}`,
      senderId: i % 2 === 0 ? userIdA : userIdB,
      timestamp: new Date(Date.now() + 10_000 + i).toISOString(),
    }));
    const deepHistoryMessages = [
      { id: 'warmup-A', text: 'warmup-A', senderId: userIdA, timestamp: new Date(Date.now()).toISOString() },
      { id: 'warmup-B', text: 'warmup-B', senderId: userIdB, timestamp: new Date(Date.now() + 1).toISOString() },
      ...texts.map((text, i) => ({
        id: `render-${text}`,
        text,
        senderId: i % 2 === 0 ? userIdA : userIdB,
        timestamp: new Date(Date.now() + 100 + i).toISOString(),
      })),
      ...bulkMessages,
    ];

    await Promise.all(
      [pageA, pageB].map((page) =>
        page.evaluate(
          ({ cid, messages }) => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            app?.uiManager?.displayConversationMessages?.(
              cid,
              messages.map((message: any) => ({
                ...message,
                timestamp: new Date(message.timestamp),
                channel: 'public',
                readBy: [],
              })),
            );
          },
          { cid: conversationId, messages: deepHistoryMessages },
        ),
      ),
    );

    const expectedTotalRows = 2 + MESSAGE_COUNT + BULK_MESSAGE_COUNT;
    await expect
      .poll(
        async () => pageA.locator('#conversation-messages .message-text').count(),
        { timeout: 20_000 },
      )
      .toBe(expectedTotalRows);
    await expect
      .poll(
        async () => pageB.locator('#conversation-messages .message-text').count(),
        { timeout: 20_000 },
      )
      .toBe(expectedTotalRows);

    await messagesA.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(messagesA.locator('.message-text').filter({ hasText: 'bulk-history-39' })).toBeVisible();
    await messagesA.evaluate((el) => { el.scrollTop = 0; });
    await expect(messagesA.locator('.message-text').filter({ hasText: 'warmup-A' })).toBeVisible();

    // Conversation message edit/delete is intentionally unsupported right now: the overlay has
    // only navigation and send controls, and message rows expose no action buttons.
    const overlayButtonIds = await pageA
      .locator('#conversation-detail-overlay button')
      .evaluateAll((buttons) => buttons.map((button) => (button as HTMLButtonElement).id).sort());
    expect(overlayButtonIds).toEqual(['back-from-conversation', 'send-conversation-message']);
    await expect(pageA.locator('#conversation-messages .message button')).toHaveCount(0);

    await reloadAppReady(pageB);
    await openConversationViaServer(pageB, userIdB, pair.nameA, userIdA);
    await expect.poll(async () => (await readHistoryOrder(pageB)).length, { timeout: 25_000 }).toBe(MESSAGE_COUNT);
    expect(await readHistoryOrder(pageB)).toEqual(texts);
  });
});
