/**
 * More template usage cases + "a template is a starting point, not a form" (talk template
 * picker follow-up, `src/web/ui/talk-templates.ts`). Adds 4 everyday-errand templates alongside
 * the original 4 (🤝 Buy/Sell, 🚕 Taxi, 💼 Job Seeker/Hiring, ❤️ Dating): 🏠 Roommate Search,
 * 🔍 Lost & Found, 🐾 Pet Sitting, 📚 Study Buddy/Tutoring — all reuse the same two-sided
 * Pair-tag `buildTwoSidedOfferTemplate` generator the original 4 already prove out
 * (83-talk-template-picker.spec.ts), so this file doesn't re-prove the picker mechanism itself,
 * only that these 4 render and pre-fill correctly.
 *
 * The second test is the actual point of this file: a template is not a fixed form. It proves
 * a realistic "start from a template, then make it your own" flow — the author edits the
 * template's pre-filled wording (both sides of the Pair tag, and Q2's answer) and then EXPANDS
 * the talk by adding a brand-new 3rd question with `#add-question-btn`, rewiring Q2's match
 * answer (`.answer-next`) to chain into it instead of terminating — exactly what a real user
 * does when a template gets them 90% of the way there but they need one more question. Saves
 * for real and reads the persisted talk back out of `myTalks` to confirm the edits and the new
 * question round-tripped through `processTalkForm` correctly (customized text, `nextQuestionId`
 * chaining instead of `isMatch`/`isTerminal`, deterministic `q_2`/`a_2_0` ids).
 */
import { Browser } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { submitTalkEditorAndWaitForOut, readCreatedTalkFromMyTalks } from '../../helpers/talk-demo-ui';

test.describe('Talk template picker — more use cases + customize/expand', () => {
  let browser: Browser;

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({ headless });
  });

  test.afterEach(async () => {
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  const openPicker = async (page: import('@playwright/test').Page) => {
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-modal');
    await page.click('#browse-talk-templates-btn');
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });
    await expect(page.locator('#talk-template-picker-modal')).toBeVisible();
  };

  test('Roommate, Lost & Found, Pet Sitting, and Study Buddy/Tutoring templates render and pre-fill correctly', async () => {
    const user = await bootstrapUser(browser, 'MoreTemplates', 'MoreTemplatesUser');
    const { page } = user;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    await openPicker(page);
    await expect(page.locator('[data-testid="talk-template-roommate"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-lostFound"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-petSitting"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-tutor"]')).toBeVisible();

    // ── Roommate Search ──────────────────────────────────────────────────────────────
    await page.click('[data-testid="talk-template-roommate"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Roommate Search');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('need a roommate');
    await expect(page.locator('.question-item[data-question-index="0"] .question-reciprocal-tag')).toBeChecked();
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('have a room');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue("What's your monthly budget?");
    await expect(page.locator('.question-item[data-question-index="1"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('$800-1200/month');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Lost & Found ──────────────────────────────────────────────────────────────────
    await openPicker(page);
    await page.click('[data-testid="talk-template-lostFound"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Lost & Found');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('lost something');
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('found something');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue('What did you lose?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Pet Sitting ───────────────────────────────────────────────────────────────────
    await openPicker(page);
    await page.click('[data-testid="talk-template-petSitting"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Pet Sitting');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('need a pet sitter');
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('offering pet sitting');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue('What kind of pet?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Study Buddy / Tutoring ────────────────────────────────────────────────────────
    await openPicker(page);
    await page.click('[data-testid="talk-template-tutor"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Study Buddy / Tutoring');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('need a tutor');
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('offering tutoring');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue('What subject?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });
  });

  test('user customizes the Roommate template\'s wording and expands it with a new question before saving', async () => {
    const user = await bootstrapUser(browser, 'Customize', 'CustomizeUser');
    const { page } = user;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    await openPicker(page);
    await page.click('[data-testid="talk-template-roommate"]');
    await page.waitForSelector('#talk-editor-modal');

    // Customize both sides of the template's pre-filled wording — a template is a starting
    // point, not a locked form. Q1's own tag word (narrows the audience) and its counterpart
    // word (the wording the other side must have offered).
    const q0 = page.locator('.question-item[data-question-index="0"]');
    await q0.locator('.question-text').fill('need a roommate near campus');
    await q0.locator('.answer-item[data-answer-index="0"] .answer-text').fill('have a furnished room near campus');

    // Customize Q2's match answer (the budget the template suggested).
    const q1 = page.locator('.question-item[data-question-index="1"]');
    await q1.locator('.answer-item[data-answer-index="0"] .answer-text').fill('$1000-1500/month');

    // Expand: the 2-question template isn't enough — add a real 3rd question with
    // "+ Add Question" and rewire Q2's match answer to chain into it instead of terminating.
    await page.click('#add-question-btn');
    const q2 = page.locator('.question-item[data-question-index="2"]');
    await expect(q2).toBeVisible();
    await q2.locator('.question-text').fill('Do you allow pets?');
    await q2.locator('.answer-item[data-answer-index="0"] .answer-text').fill('Yes');
    await q2.locator('.answer-item[data-answer-index="0"] .answer-next').selectOption('noticed');
    await q2.locator('.answer-item[data-answer-index="1"] .answer-text').fill('No');
    await q2.locator('.answer-item[data-answer-index="1"] .answer-next').selectOption('ignore');

    // Q2's match answer now chains to the new question (q_2) instead of ending the talk.
    await q1.locator('.answer-item[data-answer-index="0"] .answer-next').selectOption('q_2');

    await submitTalkEditorAndWaitForOut(page, 'Roommate Search');

    const { talkData } = await readCreatedTalkFromMyTalks(page, 'Roommate Search');
    expect(talkData.questions).toHaveLength(3);

    const savedQ0 = talkData.questions.find((q: any) => q.id === 'q_0');
    expect(savedQ0.text).toBe('need a roommate near campus');
    expect(savedQ0.reciprocalTagContext).toBe(true);
    const savedQ0Answer = savedQ0.answers.find((a: any) => a.id === 'a_0_0');
    expect(savedQ0Answer.text).toBe('have a furnished room near campus');
    expect(savedQ0Answer.nextQuestionId).toBe('q_1');

    const savedQ1 = talkData.questions.find((q: any) => q.id === 'q_1');
    const savedQ1Answer = savedQ1.answers.find((a: any) => a.id === 'a_1_0');
    expect(savedQ1Answer.text).toBe('$1000-1500/month');
    // The whole point of the expansion: this answer used to be a terminal match
    // (isMatch/isTerminal) and now chains onward instead.
    expect(savedQ1Answer.nextQuestionId).toBe('q_2');
    expect(savedQ1Answer.isMatch).toBeFalsy();
    expect(savedQ1Answer.isTerminal).toBeFalsy();

    const savedQ2 = talkData.questions.find((q: any) => q.id === 'q_2');
    expect(savedQ2.text).toBe('Do you allow pets?');
    const savedQ2Yes = savedQ2.answers.find((a: any) => a.id === 'a_2_0');
    expect(savedQ2Yes.text).toBe('Yes');
    expect(savedQ2Yes.isMatch).toBe(true);
    expect(savedQ2Yes.isTerminal).toBe(true);
    const savedQ2No = savedQ2.answers.find((a: any) => a.id === 'a_2_1');
    expect(savedQ2No.text).toBe('No');
    expect(savedQ2No.isIgnore).toBe(true);
  });
});
