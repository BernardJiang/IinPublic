/**
 * TODO §Q: verify the full graph traversal chain — Chatroom -> Person -> Talk -> Me-tab Q&A — has
 * no dead end. Each edge was already built and tested individually (Chatroom->Person: build-order
 * item 3; Person->Talk exchanged-history: item 11/§O; Talk->Q&A reverse edge: item 12); this test
 * walks all three hops in one continuous session as the "does the whole graph actually connect"
 * smoke test the TODO's own stage2 test requirement calls for, rather than re-testing any single
 * edge in isolation.
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, afterNav, afterSync } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { completeTalkInAppByAnswerIds } from '../../helpers/talk-demo-ui';
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
  await q.locator('.question-text').fill('Graph traversal smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Full graph traversal (Chatroom -> Person -> Talk -> Q&A) has no dead end', () => {
  let browserTom: Browser;
  let browserJerry: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserJerry = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  test.afterAll(async () => {
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('from Jerry: chatroom member -> conversation, back -> peer history -> talk, view -> Me-tab answer', async () => {
    test.setTimeout(120_000);
    const tom = await bootstrapUser(browserTom, 'GraphTom', 'GraphTom');
    const jerry = await bootstrapUser(browserJerry, 'GraphJerry', 'GraphJerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      // Set up a real match: Tom creates+broadcasts, Jerry answers with the match answer.
      await createSimpleFlowTalk(pageTom, 'Graph Traversal Talk');
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app.deliverPendingBroadcastTalksForE2e(1);
      });
      expect(delivery).toMatchObject({ talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      const incomingRow = pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: 'Graph Traversal Talk' });
      await expect(incomingRow).toBeVisible({ timeout: 15_000 });
      const talkId = await incomingRow.getAttribute('data-talk-id');
      expect(talkId).toBeTruthy();
      const talkData = await pageJerry.evaluate(async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 });
      }, talkId);
      const matchAnswerId = String(talkData.questions?.[0]?.answers?.[0]?.id || '');
      expect(matchAnswerId).toBeTruthy();
      await completeTalkInAppByAnswerIds(pageJerry, talkId!, talkData, [matchAnswerId], 'match');

      // ── Hop 1: Chatroom -> Person. Jerry clicks Tom's member row in the room roster.
      // Selecting by data-user-id (not display name) since the roster's cached stage name for a
      // just-matched peer can lag a beat behind the real one syncing over Gun. ──
      const tomId = await pageTom.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
      expect(tomId).toBeTruthy();
      await pageJerry.click('.nav-btn[data-view="chatrooms"]');
      await waitForTabActive(pageJerry, 'chatrooms');
      await pageJerry.click('.chatroom-item:has-text("Global")');
      await afterSync();
      const tomRow = pageJerry.locator(`.chatroom-member-item[data-user-id="${tomId}"]`);
      await expect(tomRow).toBeVisible({ timeout: 20_000 });
      await tomRow.click();
      await afterAction();
      await expect(pageJerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
      await expect(pageJerry.locator('#peer-detail-overlay')).toBeVisible();

      // ── Hop 2: Person -> Talk. Back to the ⟨User⟩ layout, then the exchanged-talk history
      // row for this specific talk re-opens the conversation scoped to it. ──
      await pageJerry.click('#back-from-conversation');
      await expect(pageJerry.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
      const historyRow = pageJerry.locator(`.peer-history-item[data-talk-id="${talkId}"]`);
      await expect(historyRow).toBeVisible({ timeout: 15_000 });
      await historyRow.click();
      await afterAction();
      await expect(pageJerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
      await expect(pageJerry.locator('#conversation-thread-scope')).toHaveAttribute('data-talk-id', talkId!);

      // ── Hop 3: Talk -> Q&A. Open the talk itself (not just the conversation scoped to it)
      // and use the reverse edge to jump to Jerry's own Me-tab answer. ──
      await pageJerry.click('#back-from-conversation');
      await expect(pageJerry.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
      await pageJerry.click('#back-from-peer-detail');
      // Once answered, the talk resolves out of the Talks tab's IN list (item 4's created-vs-
      // answered destination fix) — showTalkDetail is the same reopen path
      // 77-talk-to-me-tab-reverse-edge.spec.ts uses for an already-answered talk.
      await pageJerry.evaluate((id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        app?.uiManager?.showTalkDetail?.(id);
      }, talkId);
      await expect(pageJerry.locator('#talk-response-modal')).toBeVisible({ timeout: 10_000 });
      const viewInAnswersBtn = pageJerry.locator('#view-in-my-answers-btn');
      await expect(viewInAnswersBtn).toBeVisible({ timeout: 10_000 });
      await viewInAnswersBtn.click();
      await afterAction();

      await expect(pageJerry.locator('#talk-response-modal')).toHaveCount(0);
      await expect(pageJerry.locator('.nav-btn[data-view="me"]')).toHaveClass(/active/);
      const highlighted = pageJerry.locator('.answer-talk-item.answer-item-highlighted');
      await expect(highlighted).toBeVisible({ timeout: 10_000 });
      await expect(highlighted).toContainText('Graph Traversal Talk');
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
