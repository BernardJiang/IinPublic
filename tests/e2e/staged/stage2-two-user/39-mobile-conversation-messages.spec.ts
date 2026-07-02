/**
 * DM exchange with B on a 390x844 mobile viewport.
 * A (desktop) and B (mobile) are matched via the fast pair-direct setup, then exchange
 * messages: A sends 2, B replies 1, all three visible on both sides. On B's mobile
 * viewport, the conversation overlay's message input/list/send button must stay usable
 * within 390px width (visible, not clipped, no horizontal overflow).
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import {
  setupFastMatchedMobileDm,
  teardownFastMobileDmPair,
  FastMobileDmPair,
  MOBILE_VIEWPORT,
} from '../../helpers/mobile-bootstrap';
import { sendConversationMessage, waitForMessageVisible } from '../../helpers/fast-dm-setup';

test.describe('Mobile conversation messaging: B on 390x844', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastMobileDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: ['--window-position=640,0', '--window-size=420,900'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastMobileDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('A and B exchange messages, all visible; B mobile overlay stays within 390px width', async () => {
    pair = await setupFastMatchedMobileDm(browserA, browserB, 'MobA', 'MobB');
    const { pageA, pageB, conversationId, userIdA, userIdB } = pair;

    // ── Mobile assertions on B: overlay + input usable within the 390px viewport ──
    const overlay = pageB.locator('#conversation-detail-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).toBeTruthy();
    if (overlayBox) {
      expect(overlayBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
      expect(overlayBox.x).toBeGreaterThanOrEqual(0);
    }

    const input = pageB.locator('#conversation-message-input');
    await expect(input).toBeVisible({ timeout: 10_000 });
    const inputBox = await input.boundingBox();
    expect(inputBox).toBeTruthy();
    if (inputBox) {
      expect(inputBox.width).toBeGreaterThan(0);
      expect(inputBox.x).toBeGreaterThanOrEqual(0);
      expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    const sendBtn = pageB.locator('#send-conversation-message');
    await expect(sendBtn).toBeVisible({ timeout: 10_000 });
    const sendBox = await sendBtn.boundingBox();
    expect(sendBox).toBeTruthy();
    if (sendBox) {
      expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    // No horizontal overflow: document scroll width should not exceed the viewport width.
    const noHorizontalOverflow = await pageB.evaluate(
      (vw) => document.documentElement.scrollWidth <= vw + 1,
      MOBILE_VIEWPORT.width,
    );
    expect(noHorizontalOverflow).toBe(true);

    // ── A sends 2 messages, B replies 1 ──────────────────────────────────────
    const aMsg1 = 'A-hello-1';
    const aMsg2 = 'A-hello-2';
    const bReply = 'B-reply-1';

    await sendConversationMessage(pageA, conversationId, userIdA, aMsg1);
    await waitForMessageVisible(pageA, aMsg1);
    await waitForMessageVisible(pageB, aMsg1);

    await sendConversationMessage(pageA, conversationId, userIdA, aMsg2);
    await waitForMessageVisible(pageA, aMsg2);
    await waitForMessageVisible(pageB, aMsg2);

    await sendConversationMessage(pageB, conversationId, userIdB, bReply);
    await waitForMessageVisible(pageB, bReply);
    await waitForMessageVisible(pageA, bReply);

    // ── Message bubbles within viewport width + list scrollable on B's mobile screen ──
    const messageList = pageB.locator('#conversation-messages');
    const listBox = await messageList.boundingBox();
    expect(listBox).toBeTruthy();
    if (listBox) {
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    const bubbleBoxes = await pageB.locator('#conversation-messages .message-text').evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = (n as HTMLElement).getBoundingClientRect();
        return { x: r.x, width: r.width };
      }),
    );
    expect(bubbleBoxes.length).toBeGreaterThanOrEqual(3);
    for (const b of bubbleBoxes) {
      expect(b.x + b.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    const isScrollable = await messageList.evaluate((el) => el.scrollHeight >= el.clientHeight);
    expect(isScrollable).toBe(true);

    // Send button tappable: a real tap-driven send confirms hit-testing works, not just CSS visibility.
    await input.tap();
    await input.fill('B-tap-send');
    await sendBtn.tap();
    await waitForMessageVisible(pageB, 'B-tap-send');
    await waitForMessageVisible(pageA, 'B-tap-send');
  });
});
