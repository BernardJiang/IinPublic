/**
 * TODO §Q: Talk -> Me-tab Q&A reverse edge — the missing direction of P's Q&A -> Talk join.
 * Viewing a talk I've actually answered shows a "View in My Answers" link that jumps to the
 * Me-tab entry it produced; a talk not yet answered shows no such link (nothing to view yet).
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterAction, afterSync } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { completeTalkInAppByAnswerIds, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
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
  await q.locator('.question-text').fill('Reverse edge smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await submitTalkEditorAndWaitForOut(page, title);
}

test.describe('Talk -> Me-tab Q&A reverse edge', () => {
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

  test('not yet answered: no "View in My Answers" link; after answering: link appears and jumps to the Me-tab entry', async () => {
    const tom = await bootstrapUser(browserA, 'ReverseTom', 'ReverseTom');
    const jerry = await bootstrapUser(browserB, 'ReverseJerry', 'ReverseJerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await createSimpleFlowTalk(pageTom, 'Reverse Edge Talk');
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app.deliverPendingBroadcastTalksForE2e(1);
      });
      expect(delivery).toMatchObject({ talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();

      const incomingRow = pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: 'Reverse Edge Talk' });
      await expect(incomingRow).toBeVisible({ timeout: 15_000 });
      const talkId = await incomingRow.getAttribute('data-talk-id');
      expect(talkId).toBeTruthy();

      // Not yet answered: opening the talk (to answer it) shows no "View in My Answers" link —
      // there's no Me-tab entry to jump to yet.
      await incomingRow.locator('.view-talk-btn').click();
      await expect(pageJerry.locator('#talk-response-modal')).toBeVisible({ timeout: 10_000 });
      await expect(pageJerry.locator('#view-in-my-answers-btn')).toHaveCount(0);
      await pageJerry.locator('#talk-response-modal .response-close-button, #talk-response-modal .close-button').first().click().catch(() => {});
      await pageJerry.evaluate(() => document.getElementById('talk-response-modal')?.remove());

      const talkData = await pageJerry.evaluate(async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app?.talkService?.getTalkWithRetry?.(id, { attempts: 30, gapMs: 250 });
      }, talkId);
      const matchAnswerId = String(talkData.questions?.[0]?.answers?.[0]?.id || '');
      await completeTalkInAppByAnswerIds(pageJerry, talkId!, talkData, [matchAnswerId], 'match');

      // Now answered: reopen the (now-answered) IN row's response view — the link appears.
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
      // docs/TODO.md §LL.2 follow-up: the row's visible content is the question prompt, not
      // the talk title.
      const highlighted = pageJerry.locator('.answer-talk-item.answer-item-highlighted');
      await expect(highlighted).toBeVisible({ timeout: 10_000 });
      await expect(highlighted).toContainText('Reverse edge smoke?');
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
