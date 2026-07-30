/**
 * TODO §N1: a DM-arrival toast should be clickable and navigate to the conversation with
 * the sender, using the same "land on a person" destination every other click-to-a-person
 * surface uses (N2a / navigateToGraphNode's 'person' target) — not just dismiss on click.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, afterNav } from '../../helpers/timing';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  FastDmPair,
  sendConversationMessage,
} from '../../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('DM-arrival toast navigation (N1)', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  test.afterEach(async () => {
    if (pair) await teardownFastDmPair(pair);
    pair = undefined;
  });

  test.afterAll(async () => {
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('clicking the DM-arrival toast opens the conversation with the sender', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'TomToast', 'JerryToast');
    const { pageA, pageB, conversationId, userIdA } = pair;

    // Jerry leaves the conversation for an unrelated tab, so the arriving message isn't
    // suppressed by "already viewing this conversation" (ui-manager.ts's currentConversationId check).
    await pageB.locator('#back-from-conversation').click();
    await afterNav();
    await pageB.click('.nav-btn[data-view="settings"]');
    await afterNav();

    // The toast only fires on a genuine *delta* (ui-manager.ts's lastNotifiedMessageIdByConversation
    // seeds silently on first sight, to avoid a burst of toasts on history/boot loads) — so the
    // first message never toasts. Wait for B's preview subscription to actually process message 1
    // (the "first sight" seed) before sending message 2, so the two sends can't get batched into a
    // single callback invocation that would seed and never fire a delta.
    await sendConversationMessage(pageA, conversationId, userIdA, 'Hello from Tom');
    await expect
      .poll(
        () =>
          pageB.evaluate((cid: string) => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return conversations[cid]?.lastMessage || '';
          }, conversationId),
        { timeout: 15_000 },
      )
      .toBe('Hello from Tom');
    await sendConversationMessage(pageA, conversationId, userIdA, 'Second message from Tom');

    // Match on the toast's fixed prefix, not the peer's display name: setupFastMatchedDm's
    // synthetic pair-direct match doesn't populate conversation.otherUserName the way a normal
    // talk-editor/broadcast match does, so getPeerName falls back to a generated placeholder here.
    // The point under test is click-to-navigate, not name rendering.
    const toast = pageB.locator('.notification').filter({ hasText: 'New message from' });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await toast.click();
    await afterAction();

    await expect(pageB.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(
      pageB.locator('#conversation-messages .message-text').filter({ hasText: 'Second message from Tom' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
