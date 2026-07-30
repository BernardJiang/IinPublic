/**
 * TODO §P: per-question deep link. A multi-question flow entry's Me-tab rows (one per
 * question, per the flattened-history model) each carry the questionId that produced them.
 * Clicking a specific question's row threads that questionId through to the response dialog,
 * which scrolls/highlights that exact `.review-question-block`, not just the talk's first
 * screen.
 *
 * The review screen itself only renders when every question auto-resolves via the real
 * exact-chatbot-memory subsystem (tryCollectAllAutoAnswers) — a separate, unrelated mechanism.
 * Rather than fight that subsystem's timing to reach the review screen from a genuine Me-tab
 * click, this test verifies the two things this item actually changed, each in isolation:
 *   1. The Me-tab row carries the right questionId (data-question-id on the clicked element).
 *   2. showTalkResponseDialog's targetQuestionId option scrolls/highlights the right block.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { completeTalkInAppByAnswerIds } from '../../helpers/talk-demo-ui';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const TITLE = 'Two Question Deep Link Talk';

test.describe('Me-tab per-question deep link (P)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('Me-tab row carries the right questionId; targetQuestionId scrolls/highlights the right review block', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'DeepLinkUser');

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await afterSync();
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', TITLE);
    await page.selectOption('#talk-type', 'flow');
    await page.click('#add-question-btn');
    await afterAction();

    const q0 = page.locator('.question-item').nth(0);
    await q0.locator('.question-text').fill('Do you like tea?');
    await q0.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_1');
    await q0.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

    const q1 = page.locator('.question-item').nth(1);
    await q1.locator('.question-text').fill('Do you like coffee?');
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');

    await page.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    const talkId = await page.evaluate((title: string) => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const entry = Object.entries(talks).find(([, t]: [string, any]) => t?.title === title || t?.fullTalk?.title === title);
      return entry ? entry[0] : '';
    }, TITLE);
    expect(talkId).toBeTruthy();

    const talkData = await page.evaluate((id: string) => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      return talks[id]?.fullTalk;
    }, talkId);
    const q0Id = String(talkData.questions[0].id);
    const q1Id = String(talkData.questions[1].id);
    const firstMatchAnswer = talkData.questions[0].answers[0];
    const secondMatchAnswer = talkData.questions[1].answers[0];

    // Self-test: complete the talk so both questions get their own flattened Me-tab row.
    await completeTalkInAppByAnswerIds(page, talkId, talkData, [firstMatchAnswer.id, secondMatchAnswer.id], 'match');

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await afterSync();

    const firstQuestionRow = page.locator('.answer-talk-item').filter({ hasText: 'Do you like tea?' }).first();
    const secondQuestionRow = page.locator('.answer-talk-item').filter({ hasText: 'Do you like coffee?' }).first();
    await expect(firstQuestionRow).toBeVisible({ timeout: 15_000 });
    await expect(secondQuestionRow).toBeVisible({ timeout: 15_000 });

    // 1. Each row's .answer-outcome-item carries the questionId that produced it.
    await expect(firstQuestionRow.locator('.answer-outcome-item')).toHaveAttribute('data-question-id', q0Id);
    await expect(secondQuestionRow.locator('.answer-outcome-item')).toHaveAttribute('data-question-id', q1Id);

    // 2. showTalkResponseDialog's targetQuestionId scrolls/highlights the matching review block
    // (forcing isTalkSuperseded reaches the review screen deterministically, independent of the
    // real exact-chatbot-memory auto-resolution timing).
    await page.evaluate(
      ({ talk, targetQuestionId }) => {
        (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkResponseDialog(talk, {
          isTalkSuperseded: true,
          targetQuestionId,
        });
      },
      { talk: talkData, targetQuestionId: q1Id },
    );
    await expect(page.locator('#talk-response-modal')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.review-question-block')).toHaveCount(2, { timeout: 10_000 });

    const highlighted = page.locator('.review-question-block.answer-item-highlighted');
    await expect(highlighted).toBeVisible({ timeout: 10_000 });
    await expect(highlighted).toHaveAttribute('data-question-id', q1Id);
    await expect(highlighted).toContainText('Do you like coffee?');

    const firstBlock = page.locator(`.review-question-block[data-question-id="${q0Id}"]`);
    await expect(firstBlock).not.toHaveClass(/answer-item-highlighted/);
  });
});
