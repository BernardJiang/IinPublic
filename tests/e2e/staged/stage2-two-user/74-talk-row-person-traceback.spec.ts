/**
 * TODO §N3 (single exchange partner): from a Talks-tab item, trace back to who I exchanged
 * it with, then DM them — clicking the matched-name (OUT) / sender-name (IN) should navigate
 * straight to the DM via navigateToGraphNode's 'person' destination, not just open the talk.
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, afterNav, afterSync } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

async function createSimpleFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await selectTalkEditorType(page, 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('Traceback smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Talk row -> person traceback (N3, single partner)', () => {
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

  test('OUT row: clicking the sole matched name opens the DM with that responder', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'TraceTom', 'TraceJerry');
    const { pageA, userIdB } = pair;

    // Tom (author/OUT side) leaves the conversation for the Talks tab.
    await pageA.locator('#back-from-conversation').click();
    await afterNav();
    await pageA.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageA, 'talks');
    await afterNav();

    const matchedLine = pageA.locator('.talk-matched-people').first();
    await expect(matchedLine).toBeVisible({ timeout: 15_000 });
    await expect(matchedLine).toContainText('TraceJerry');

    await matchedLine.click();
    await afterAction();

    await expect(pageA.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(pageA.locator('#conversation-user-name')).toContainText('TraceJerry');
    const openedConversationId = await pageA.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.currentConversationId || '',
    );
    expect(openedConversationId.length).toBeGreaterThan(0);

    const openedOtherUserId = await pageA.evaluate((cid: string) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      return conversations[cid]?.otherUserId || '';
    }, openedConversationId);
    expect(openedOtherUserId).toBe(userIdB);
  });

  // setupFastMatchedDm's synthetic pair-direct match doesn't populate a real senderId on the
  // responder's incoming-cluster senders map (only the answered-history fallback path, which
  // never carries an id — see ui-manager.ts's answeredIncomingEntries), so this case needs a
  // real broadcast-and-receive flow to exercise the live cluster.senders senderId that N3 traces
  // back through.
  test('IN row: clicking the sender name opens the DM, without also opening the talk detail', async () => {
    const tom = await bootstrapUser(browserA, 'TraceTomIn2', 'TraceTomIn2');
    const jerry = await bootstrapUser(browserB, 'TraceJerryIn2', 'TraceJerryIn2');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await createSimpleFlowTalk(pageTom, 'IN row traceback talk');
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app.deliverPendingBroadcastTalksForE2e(1);
      });
      expect(delivery).toMatchObject({ talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();

      const tomId = await pageTom.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));

      // Name assertion is loose (deliverPendingBroadcastTalksForE2e bypasses the normal
      // announce/full-body handshake that would carry Tom's real stage name to Jerry's mesh
      // cache, so cluster.senders[id].senderName resolves to a generated placeholder here) —
      // the point under test is that the real senderId is threaded through and navigated to
      // correctly, not the display name.
      const senderLine = pageJerry.locator('.talk-sender-people').first();
      await expect(senderLine).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => senderLine.getAttribute('data-sender-people'), { timeout: 15_000 })
        .toContain(tomId);

      await senderLine.click();
      await afterAction();

      // Clicking the sender opens the DM, not the talk detail/response dialog.
      await expect(pageJerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
      await expect(pageJerry.locator('#talk-response-modal')).toHaveCount(0);
      const openedConversationId = await pageJerry.evaluate(
        () => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.currentConversationId || '',
      );
      const openedOtherUserId = await pageJerry.evaluate((cid: string) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        return conversations[cid]?.otherUserId || '';
      }, openedConversationId);
      expect(openedOtherUserId).toBe(tomId);
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
