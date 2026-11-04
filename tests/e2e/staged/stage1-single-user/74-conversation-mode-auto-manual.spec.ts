/**
 * Conversation modes — auto vs manual answer reuse (spec §7.6).
 *
 * The rule under test: "Even in Auto mode the chatbot never repeats manual answers."
 * Implementation (OPEN-106): each answer's mode goes into the device graph with it; a manual
 * (Just once) answer is remembered there as a suggestion only (`ix/ctx` reuse `once`), and the
 * response dialog only auto-applies answers the chatbot may reuse.
 *
 * Single user, synthetic talks driven straight through showTalkResponseDialog:
 *  - answer Q1 with the MANUAL radio → the chatbot does not reuse it; a second talk with the
 *    same question text renders the question instead of auto-completing;
 *  - answer Q2 with the AUTO radio → the chatbot reuses it; a second talk with the same
 *    question auto-completes after one Confirm.
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

function syntheticFruitTalk(id: string, choices: string[]) {
  return {
    id,
    talkId: id,
    title: `Fruit contract ${id}`,
    authorId: 'e2e-fruit-author',
    type: 'flow',
    language: 'en',
    isAdult: false,
    tags: [],
    questions: [{
      id: `q_${id}`,
      text: 'Which fruit would you pack for this trip?',
      answers: choices.map((text, index) => ({
        id: `a_${index}_${text.toLowerCase()}`,
        text,
        isMatch: true,
        isTerminal: true,
      })),
    }],
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

/** The answers the chatbot reuses, from the device graph (OPEN-106): Just once ones are left out. */
async function readReusedMemory(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const remembered = (await (window as any).__iinpublic_graph_remembered?.()) ?? [];
    return JSON.stringify(remembered.filter((r: any) => r.reuse !== 'once').map((r: any) => [r.questionText, r.answerTexts])).toLowerCase();
  });
}

/** The question's Whenever offered answers, highest priority first. */
async function readWheneverOffered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const remembered = (await (window as any).__iinpublic_graph_remembered?.()) ?? [];
    return remembered.filter((r: any) => r.reuse === 'whenever').map((r: any) => r.answerTexts[0]);
  });
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

    // §7.6: the manual (Just once) answer is never reused by the chatbot.
    expect(await readReusedMemory(p)).not.toContain('salsa dancing on tuesdays');

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
    // Same-context auto answers are what this test covers; the app default is "Whenever offered".
    await p.evaluate(() => localStorage.setItem('iinpublic_auto_answer_scope', 'same-context'));

    await openResponseDialog(p, syntheticFlowTalk('e2e-mode-a1', 'Mode Auto Talk 1', q));
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await p.locator('input.choice-radio[data-answer-id="a_yes"][data-mode="auto"]').click({ noWaitAfter: true });
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
    await afterSync();

    // The auto answer is one the chatbot reuses.
    await expect.poll(() => readReusedMemory(p)).toContain('midnight astronomy walk');

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

  test('the global Whenever offered setting keeps ordered Apple/Kiwi defaults across choice sets', async () => {
    const p = page!;
    const modal = p.locator('#talk-response-modal');
    await p.setViewportSize({ width: 320, height: 760 });
    await p.evaluate(() => localStorage.setItem('iinpublic_auto_answer_scope', 'whenever'));

    // Bob explicitly contracts Apple without creating hashes for possible future subsets.
    await openResponseDialog(p, syntheticFruitTalk('default-apple', ['Apple', 'Banana', 'Pears']));
    await expect(modal).toContainText('Auto');
    await expect(modal).toContainText('Manual');
    await expect(modal).not.toContainText('Same context');
    await expect(modal).not.toContainText('Whenever offered');
    const gridMetrics = await modal.locator('.answer-radio-grid').evaluate((grid) => ({
      clientWidth: grid.clientWidth,
      scrollWidth: grid.scrollWidth,
      modalWidth: grid.closest('.modal-content')?.clientWidth,
    }));
    expect(gridMetrics.scrollWidth, JSON.stringify(gridMetrics)).toBeLessThanOrEqual(gridMetrics.clientWidth);
    await modal.locator('input.choice-radio[data-answer-text="Apple"][data-mode="whenever"]').click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });

    await expect.poll(() => readWheneverOffered(p)).toEqual(['Apple']);

    // Carol offers only Banana/Apple. The broad contract pre-fills Apple even though this exact
    // choice frame has never been saved. Exit through Edit so this check creates no exact rule.
    await openResponseDialog(p, syntheticFruitTalk('carol-two', ['Banana', 'Apple']));
    await expect(modal.locator('#review-submit-btn')).toBeVisible();
    await expect(modal.locator('input[data-answer-text="Apple"]')).toBeChecked();
    await modal.locator('#review-edit-btn').click();
    await modal.locator('[data-testid="close-response-btn"]').click();

    // A four-choice set also starts with Apple. Bob edits it and promotes Kiwi with Auto;
    // the global Whenever offered scope moves Kiwi ahead of Apple while retaining Apple.
    await openResponseDialog(p, syntheticFruitTalk('four-with-kiwi', ['Apple', 'Banana', 'Pears', 'Kiwi']));
    await expect(modal.locator('input[data-answer-text="Apple"]')).toBeChecked();
    await modal.locator('input[data-answer-text="Kiwi"]').click();
    await modal.locator('.review-mode-select').selectOption('auto');
    await modal.locator('#review-submit-btn').click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });

    await expect.poll(() => readWheneverOffered(p)).toEqual(['Kiwi', 'Apple']);

    await openResponseDialog(p, syntheticFruitTalk('kiwi-priority', ['Mango', 'Apple', 'Kiwi']));
    await expect(modal.locator('input[data-answer-text="Kiwi"]')).toBeChecked();
    await modal.locator('#review-edit-btn').click();
    await modal.locator('[data-testid="close-response-btn"]').click();

    await openResponseDialog(p, syntheticFruitTalk('apple-fallback', ['Orange', 'Apple']));
    await expect(modal.locator('input[data-answer-text="Apple"]')).toBeChecked();
    await modal.locator('#review-edit-btn').click();
    await modal.locator('[data-testid="close-response-btn"]').click();

    // No contracted answer is present, so the chatbot leaves the decision to Bob.
    await openResponseDialog(p, syntheticFruitTalk('no-default', ['Banana', 'Pears']));
    await expect(modal).toContainText('Which fruit would you pack for this trip?');
    await expect(modal.locator('#review-submit-btn')).toHaveCount(0);
    await modal.locator('[data-testid="close-response-btn"]').click();
  });
});
