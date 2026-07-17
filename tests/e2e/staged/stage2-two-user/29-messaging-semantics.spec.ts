/**
 * Messaging semantics (merged: 29-messaging-concurrent-order, 30-messaging-read-state,
 * 31-messaging-history-order). One pair of browser launches + one Gun clear instead of
 * three; each test still creates its OWN matched DM pair (distinct stage names), torn
 * down in afterEach, so tests stay independent on the shared Gun graph.
 *
 * - Concurrent order: A and B interleave 3 sends each; both sides converge to one order.
 * - Read state: unread badge appears, clears on open, stays cleared after reload.
 * - History order: 12 alternating sends render in full identical order; 50+ row deep
 *   history scrolls; order survives B reloading and re-opening the conversation.
 */
import { chromium, Browser, type Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, reloadAppReady } from '../../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
  waitForMessageVisible,
} from '../../helpers/fast-dm-setup';
import { openConversationViaServer } from '../../helpers/conversation-e2e';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

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

test.describe('Messaging semantics — concurrent order, read state, history order (merged)', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  // Each test builds its own pair; tear it down between tests so overlays/pages
  // never leak into the next test.
  test.afterEach(async () => {
    if (pair) await teardownFastDmPair(pair);
    pair = undefined;
  });

  test.afterAll(async () => {
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
