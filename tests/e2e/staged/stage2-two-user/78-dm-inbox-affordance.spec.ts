/**
 * TODO §N2: the cross-tab "pick a conversation" affordance. The Me-tab badge only shows while
 * on the Me tab; #dm-inbox-btn is reachable from every tab, badge-driven off the same aggregate
 * unread count, and opens a sorted list of senders with unread messages. Picking one navigates
 * to that conversation.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, afterNav } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair, sendConversationMessage } from '../../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Cross-tab DM inbox affordance (N2)', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
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

  test('badge updates on a non-Me tab; picker lists the sender; picking navigates to the conversation', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'InboxTom', 'InboxJerry');
    const { pageA, pageB, conversationId, userIdA } = pair;

    // Jerry leaves the conversation for Settings — not the Me tab, not Contacts.
    await pageB.locator('#back-from-conversation').click();
    await afterNav();
    await pageB.click('.nav-btn[data-view="settings"]');
    await afterNav();

    await sendConversationMessage(pageA, conversationId, userIdA, 'Hello from Tom');

    const badge = pageB.locator('#dm-inbox-btn .notification-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(pageB.locator('.nav-btn[data-view="settings"]')).toHaveClass(/active/);

    await pageB.click('#dm-inbox-btn');
    const modal = pageB.locator('#dm-inbox-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    // Name assertion is loose (setupFastMatchedDm's synthetic conversation doesn't populate
    // conversation.otherUserName the way a normal talk-editor/broadcast match does, so
    // getPeerName falls back to a generated placeholder here) — the point under test is that
    // the sender is listed by the right id and picking it navigates correctly.
    const row = modal.locator(`.dm-inbox-row[data-user-id="${userIdA}"]`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('1');

    await row.click();
    await afterAction();

    await expect(pageB.locator('#dm-inbox-modal')).toHaveCount(0);
    await expect(pageB.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    const openedConversationId = await pageB.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.currentConversationId || '',
    );
    expect(openedConversationId).toBe(conversationId);
  });
});
