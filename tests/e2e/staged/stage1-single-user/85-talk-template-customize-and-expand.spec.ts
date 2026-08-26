/**
 * More template usage cases + "a template is a starting point, not a form" (talk template
 * picker follow-up, `src/web/ui/talk-templates.ts`). Adds 4 everyday-errand templates alongside
 * the original 4 (🤝 Buy/Sell, 🚕 Taxi, 💼 Job Seeker/Hiring, ❤️ Dating): 🏠 Roommate Search,
 * 🔍 Lost & Found, 🐾 Pet Sitting, 📚 Study Buddy/Tutoring — all reuse the same Pair-tag-root
 * `buildPairTagBranchRoute` generator the original 4 already prove out
 * (83-talk-template-picker.spec.ts), so this file doesn't re-prove the picker mechanism itself,
 * only that these 4 render and pre-fill correctly. Every template is `type: 'route'` — a
 * genuine branching DAG rendered by the route editor as nested `.route-node[data-qid]` blocks
 * (`route-editor-controller.ts`), not the flat `.question-item[data-question-index]` list
 * flow/tag/survey use.
 *
 * The second test is the actual point of this file: a template is not a fixed form. It proves a
 * realistic "start from a template, then make it your own" flow — the author edits the
 * template's pre-filled wording at multiple DAG depths (both sides of the Pair-tag root, a
 * branch answer, and a leaf's match-answer text), then EXPANDS the talk by clicking a leaf
 * answer's "add child" button (`.route-add-child-btn`) to grow a brand-new question off it
 * instead of leaving it terminal — exactly what a real user does when a template gets them 90%
 * of the way there but they need one more question. Saves for real and reads the persisted talk
 * back out of `myTalks` to confirm the edits and the new question round-tripped through
 * `processTalkForm`'s route branch (`collectRouteEditorQuestions`) correctly: customized text,
 * the old leaf's `nextQuestionId` chaining onward instead of `isMatch`/`isTerminal`, and the new
 * node's deterministic `q_5`/`q_5_match`/`q_5_ignore` ids.
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
    await expect(page.locator('#talk-type')).toHaveValue('route');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('need a roommate');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_0"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('have a room');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue("What's your monthly budget?");
    await expect(page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a0"]')).toHaveValue('Under $800');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Lost & Found ──────────────────────────────────────────────────────────────────
    await openPicker(page);
    await page.click('[data-testid="talk-template-lostFound"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Lost & Found');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('lost something');
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('found something');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('What did you lose?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Pet Sitting ───────────────────────────────────────────────────────────────────
    await openPicker(page);
    await page.click('[data-testid="talk-template-petSitting"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Pet Sitting');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('need a pet sitter');
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('offering pet sitting');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('What kind of pet?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Study Buddy / Tutoring ────────────────────────────────────────────────────────
    await openPicker(page);
    await page.click('[data-testid="talk-template-tutor"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Study Buddy / Tutoring');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('need a tutor');
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('offering tutoring');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('What subject?');
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
    // point, not a locked form. The root's own tag word (narrows the audience) and its
    // counterpart word (the wording the other side must have offered).
    await page.locator('.route-question-text[data-qid="q_0"]').fill('need a roommate near campus');
    await page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]').fill('have a furnished room near campus');

    // Customize the budget branch's own wording (q_1's first branch answer).
    await page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a0"]').fill('Under $800, negotiable');

    // Customize that branch's leaf match-answer text (q_2 — "When do you need to move in?",
    // reached via the "Under $800" branch).
    await page.locator('.route-answer-text[data-qid="q_2"][data-aid="q_2_a0"]').fill('ASAP, this weekend');

    // Expand: the template's leaf isn't enough — grow a brand-new question off q_2's match
    // answer instead of leaving it terminal. The template loads 5 questions (q_0..q_4), so the
    // route editor's `.route-add-child-btn` handler deterministically assigns the new node q_5.
    await page.click('.route-add-child-btn[data-qid="q_2"][data-aid="q_2_a0"]');
    await expect(page.locator('.route-node[data-qid="q_5"]')).toBeVisible();
    await page.locator('.route-question-text[data-qid="q_5"]').fill('Do you allow pets?');
    await page.locator('.route-answer-text[data-qid="q_5"][data-aid="q_5_match"]').fill('Yes');
    await page.locator('.route-answer-text[data-qid="q_5"][data-aid="q_5_ignore"]').fill('No');

    await submitTalkEditorAndWaitForOut(page, 'Roommate Search');

    const { talkData } = await readCreatedTalkFromMyTalks(page, 'Roommate Search');
    expect(talkData.questions).toHaveLength(6);

    const savedQ0 = talkData.questions.find((q: any) => q.id === 'q_0');
    expect(savedQ0.text).toBe('need a roommate near campus');
    expect(savedQ0.reciprocalTagContext).toBe(true);
    const savedQ0Answer = savedQ0.answers.find((a: any) => a.id === 'q_0_a0');
    expect(savedQ0Answer.text).toBe('have a furnished room near campus');
    expect(savedQ0Answer.nextQuestionId).toBe('q_1');

    const savedQ1 = talkData.questions.find((q: any) => q.id === 'q_1');
    const savedQ1Answer = savedQ1.answers.find((a: any) => a.id === 'q_1_a0');
    expect(savedQ1Answer.text).toBe('Under $800, negotiable');
    expect(savedQ1Answer.nextQuestionId).toBe('q_2');

    const savedQ2 = talkData.questions.find((q: any) => q.id === 'q_2');
    const savedQ2Answer = savedQ2.answers.find((a: any) => a.id === 'q_2_a0');
    expect(savedQ2Answer.text).toBe('ASAP, this weekend');
    // The whole point of the expansion: this answer used to be a terminal match
    // (isMatch/isTerminal) and now chains onward instead.
    expect(savedQ2Answer.nextQuestionId).toBe('q_5');
    expect(savedQ2Answer.isMatch).toBeFalsy();
    expect(savedQ2Answer.isTerminal).toBeFalsy();

    const savedQ5 = talkData.questions.find((q: any) => q.id === 'q_5');
    expect(savedQ5.text).toBe('Do you allow pets?');
    const savedQ5Yes = savedQ5.answers.find((a: any) => a.id === 'q_5_match');
    expect(savedQ5Yes.text).toBe('Yes');
    expect(savedQ5Yes.isMatch).toBe(true);
    expect(savedQ5Yes.isTerminal).toBe(true);
    const savedQ5No = savedQ5.answers.find((a: any) => a.id === 'q_5_ignore');
    expect(savedQ5No.text).toBe('No');
    expect(savedQ5No.isIgnore).toBe(true);
  });
});
