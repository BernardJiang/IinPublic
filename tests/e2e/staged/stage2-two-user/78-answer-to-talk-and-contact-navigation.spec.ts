/**
 * Me tab (Answers): each answer's detail popup now links to both the source talk and the
 * sender's Contacts detail, mirroring the same cross-navigation just built between the
 * Contacts and Talks tabs.
 *
 * "View talk" behavior forks on whether the answer has a sender: a talk someone else sent
 * me (senderIds.length > 0, this scenario) still opens the single-talk detail/response
 * view unchanged; a talk I authored myself (no senders) instead opens the Talks-tab
 * responses list for that talk (showCreatorRepliesForTalk) — not covered here since it
 * needs a self-authored-and-self-answered talk, an unusual flow to construct in e2e; the
 * branch itself is a simple boolean gate covered at the type level and by the existing
 * Contacts/Talks responses-list spec (09-contacts-talks-cross-navigation.spec.ts) this
 * reuses showCreatorRepliesForTalk from.
 *
 * "View contact" is new: only rendered when senderIds.length > 0, jumps to the sender's
 * Contacts detail via the same navigateToGraphNode dispatcher other cross-navigation uses.
 *
 * Companion doc: tests/e2e/staged/stage2-two-user/78-answer-to-talk-and-contact-navigation.md
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterSync, afterNav } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { waitForContactDetailReady } from '../../helpers/durable-ui';
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
  await q.locator('.question-text').fill('Coming to trivia night?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Me tab: an answer links to its talk and to the sender\'s contact', () => {
  let browserA: Browser;
  let browserB: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('"View contact" jumps to the sender\'s Contacts detail; "View talk" still opens the talk unchanged', async () => {
    test.setTimeout(90_000);
    const tom = await bootstrapUser(browserA, 'AnswerTom', 'AnswerTom');
    const jerry = await bootstrapUser(browserB, 'AnswerJerry', 'AnswerJerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await createSimpleFlowTalk(pageTom, 'Trivia Night');
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app.deliverPendingBroadcastTalksForE2e(1);
      });
      expect(delivery).toMatchObject({ talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();
      const incomingRow = pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: 'Trivia Night' });
      await expect(incomingRow).toBeVisible({ timeout: 15_000 });
      const talkId = await incomingRow.getAttribute('data-talk-id');
      expect(talkId).toBeTruthy();

      const talkData = await pageJerry.evaluate(async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 });
      }, talkId);
      const matchAnswerId = String(talkData.questions?.[0]?.answers?.[0]?.id || '');
      await completeTalkInAppByAnswerIds(pageJerry, talkId!, talkData, [matchAnswerId], 'match');

      await pageJerry.click('.nav-btn[data-view="me"]');
      await waitForTabActive(pageJerry, 'me');
      await afterSync();
      const answerRow = pageJerry.locator('.answer-talk-item').filter({ hasText: 'Trivia Night' }).first();
      await expect(answerRow).toBeVisible({ timeout: 15_000 });
      await answerRow.click();
      await expect(pageJerry.locator('#item-details-popup')).toBeVisible({ timeout: 10_000 });

      // A talk someone else (Tom) sent me: "View contact" is offered.
      const viewContactBtn = pageJerry.locator('#item-details-popup .answer-view-contact-btn');
      await expect(viewContactBtn).toBeVisible({ timeout: 10_000 });

      // "View talk" is unchanged for this case: opens the single-talk response view.
      await pageJerry.locator('#item-details-popup .answer-view-talk-btn').click();
      await expect(pageJerry.locator('#talk-response-modal')).toBeVisible({ timeout: 10_000 });
      await pageJerry.locator('#talk-response-modal .response-close-button, #talk-response-modal .close-button').first().click().catch(() => {});
      await pageJerry.evaluate(() => document.getElementById('talk-response-modal')?.remove());

      // Reopen the popup (closing the talk modal did not close it) and click "View contact".
      await pageJerry.locator('#item-details-popup .answer-view-contact-btn').click();
      await afterNav();
      await waitForContactDetailReady(pageJerry, 20_000);
      await expect(pageJerry.locator('.peer-history-item').filter({ hasText: 'Trivia Night' })).toBeVisible({ timeout: 10_000 });
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
