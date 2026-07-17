/**
 * Conversation modes — auto vs manual answer reuse (spec §7.6).
 *
 * The rule under test: "Even in Auto mode the chatbot never repeats manual answers."
 * Implementation: saveAnswerPreference() writes 'auto' answers into exact chatbot
 * memory (saveTemporaryAnswer) but deliberately never writes 'manual' answers there;
 * the response dialog only auto-applies resolved preferences with mode 'auto'
 * (talk-response-dialog: `savedPreference.mode === 'auto'`).
 *
 * Single user, synthetic talks driven straight through showTalkResponseDialog:
 *  - answer Q1 with the MANUAL radio → exact memory must NOT contain Q1; a second
 *    talk with the same question text renders the question instead of auto-completing;
 *  - answer Q2 with the AUTO radio → exact memory contains Q2; a second talk with the
 *    same question auto-completes without showing the dialog.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

function syntheticFlowTalk(id: string, title: string, questionText: string) {
  return {
    id,
    talkId: id,
    title,
    authorId: 'e2e-mode-author',
    type: 'flow',
    language: 'en',
    isAdult: false,
    tags: [],
    questions: [
      {
        id: 'q1',
        text: questionText,
        answers: [
          { id: 'a_yes', text: 'Yes', isMatch: true, isTerminal: true },
          { id: 'a_no', text: 'No', isIgnore: true, isTerminal: true },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
    isTemplate: false,
    usageCount: 0,
  };
}

async function openResponseDialog(page: Page, talk: unknown): Promise<void> {
  await page.evaluate((t) => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkResponseDialog?.(t);
  }, talk);
}

async function readExactMemory(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('exactChatbotMemory') || '');
}

test.describe('Conversation modes — manual answers are never auto-reused (spec §7.6)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('manual answer stays out of chatbot memory and is not auto-applied', async () => {
    const p = page!;
    const q = 'Do you enjoy salsa dancing on Tuesdays?';
    const modal = p.locator('#talk-response-modal');

    await openResponseDialog(p, syntheticFlowTalk('e2e-mode-m1', 'Mode Manual Talk 1', q));
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toContainText(q);
    await p.locator('input.choice-radio[data-answer-id="a_yes"][data-mode="manual"]').click({ noWaitAfter: true });
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
    await afterSync();

    // §7.6: the manual answer must NOT enter exact chatbot memory. The store keeps
    // NORMALIZED text (lowercased, punctuation stripped), so assert on a normalized
    // fragment rather than the raw question string.
    expect(await readExactMemory(p)).not.toContain('salsa dancing on tuesdays');

    // A different talk with the SAME question (auto-answer allowed) must render the
    // bare question for the user — no review screen, no pre-filled choice — instead
    // of reusing the manual answer. (Contrast: the auto test below gets a pre-filled
    // review screen for the same reopen.)
    await openResponseDialog(p, syntheticFlowTalk('e2e-mode-m2', 'Mode Manual Talk 2', q));
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toContainText(q);
    await expect(modal).not.toContainText('Review your answers');
    await expect(modal).not.toContainText('pre-filled');
    await p.locator('[data-testid="close-response-btn"]').click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
    await afterNav();
  });

  test('auto answer enters chatbot memory and auto-completes the next same question', async () => {
    const p = page!;
    const q = 'Would you join a midnight astronomy walk?';
    const modal = p.locator('#talk-response-modal');

    await openResponseDialog(p, syntheticFlowTalk('e2e-mode-a1', 'Mode Auto Talk 1', q));
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await p.locator('input.choice-radio[data-answer-id="a_yes"][data-mode="auto"]').click({ noWaitAfter: true });
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
    await afterSync();

    // The auto answer is recorded in exact chatbot memory (normalized text form).
    expect(await readExactMemory(p)).toContain('midnight astronomy walk');

    // A different talk with the same question auto-applies: the dialog opens in the
    // REVIEW state with the remembered answer pre-filled (rather than asking the
    // question), and a single Confirm completes it. Contrast with the manual test
    // above, where the same reopen renders the un-prefilled question screen.
    await openResponseDialog(p, syntheticFlowTalk('e2e-mode-a2', 'Mode Auto Talk 2', q));
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toContainText('Review your answers');
    await expect(modal.locator('#review-submit-btn')).toBeVisible();
    await modal.locator('#review-submit-btn').click({ noWaitAfter: true });
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
  });
});
