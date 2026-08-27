/**
 * Talk template picker — talk editor usability follow-up. "+ Create Talk" itself is UNCHANGED
 * (still opens a blank editor directly — ~60 other e2e specs click `#create-talk-btn` expecting
 * exactly that, so intercepting it was rejected as too large a blast radius). Instead, a new
 * "🎨 Start from a template" button at the top of the blank editor (shown only for a genuinely
 * fresh create, never when editing/copying/already-templated) opens the picker, which now lists
 * 8 built-in templates plus ✏️ Start from scratch (🤝 Buy/Sell, 🚕 Taxi, 💼 Job Seeker/Hiring,
 * ❤️ Dating here, plus 🏠 Roommate Search, 🔍 Lost & Found, 🐾 Pet Sitting, 📚 Study
 * Buddy/Tutoring in 85-talk-template-customize-and-expand.spec.ts). Picking a template opens the
 * SAME editor pre-filled and fully editable — `showTalkEditorDialog` already accepts an
 * `existingTalk`-shaped prefill with no `id` (proven by the existing copy-talk/survey-follow-up
 * call sites), so a template is just another one, created fresh on save, not edited-in-place
 * (`src/web/ui/talk-templates.ts`).
 *
 * Every template is `type: 'route'` — a genuine branching DAG (contextPath-tracked), not the
 * simpler linear `flow` shape the picker originally shipped with. The route editor renders each
 * question as a `.route-node[data-qid]` with a `.route-question-text[data-qid]` input and
 * `.route-answer[data-qid][data-aid]` rows (`route-editor-controller.ts`), nested by indentation
 * to reflect the DAG — not the flat `.question-item[data-question-index]` list flow/tag/survey
 * use.
 *
 * This spec proves the picker renders the original 4 templates + scratch and that each
 * template's prefill is structurally correct at more than one DAG depth — title/type/Pair-tag
 * root/first branch — and for Buy/Sell, that "sell" fans out (parallel, not chained) across
 * every item for sale, each item its own Simple tag whose one answer itself fans out into
 * independent Model/Condition/Price-range specs (the whole point of moving off flow's
 * 2-question shape — adding a 2nd/3rd item, or another spec per item, is just more fan-out).
 * For Dating, it also
 * proves the new `ageRange` built-in comparator (§DD) renders correctly nested inside the route
 * editor (a route-editor gap fixed alongside this change — `route-editor-controller.ts` didn't
 * support the `ageRange` kind before) plus the force-checked-and-disabled adult-content lock. It
 * does NOT re-prove the underlying Pair-tag + chatbot cross-talk matching mechanism (already
 * proven by 89-buy-sell-chatbot-cross-talk-match.spec.ts and the taxi spec) — only Dating's
 * genuinely new `ageRange` mechanism gets its own full match spec, 94-dating-agerange-match.spec.ts.
 * The 4 newer templates' prefills, and a customize+expand flow proving a template's DAG stays
 * fully editable (including growing a brand-new branch off an existing leaf) after picking it,
 * live in 85-talk-template-customize-and-expand.spec.ts.
 */
import { Browser } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';

test.describe('Talk template picker', () => {
  let browser: Browser;

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({ headless });
  });

  test.afterEach(async () => {
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('lists all 4 templates + start-from-scratch, and each pre-fills the editor correctly', async () => {
    const user = await bootstrapUser(browser, 'Picker', 'PickerUser');
    const { page } = user;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');

    const openPicker = async () => {
      await page.click('#create-talk-btn');
      await page.waitForSelector('#talk-editor-modal');
      await expect(page.locator('#browse-talk-templates-btn')).toBeVisible();
      await page.click('#browse-talk-templates-btn');
      await page.waitForSelector('#talk-editor-modal', { state: 'detached' });
      await expect(page.locator('#talk-template-picker-modal')).toBeVisible();
    };

    // Progressive disclosure: a brand-new blank question's advanced fields (answer-selection-
    // mode, Simple/Pair tag, "Compare using") start collapsed — no value set, nothing to show.
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('.question-item[data-question-index="0"] .question-advanced')).not.toHaveJSProperty('open', true);
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    await openPicker();
    await expect(page.locator('[data-testid="talk-template-buySell"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-taxi"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-job"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-dating"]')).toBeVisible();
    await expect(page.locator('[data-testid="talk-template-scratch"]')).toBeVisible();

    // ── Buy / Sell — the deepest template: tag → item (Simple tag) → parallel model/condition/price ──
    await page.click('[data-testid="talk-template-buySell"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Buy / Sell');
    await expect(page.locator('#talk-type')).toHaveValue('route');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('buy');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_0"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('sell');
    // "sell" fans out across every item for sale (parallel, not chained) — iPhone (q_1) and
    // iPad (q_5) are independent siblings, each its own Simple tag (self-match); adding a 3rd
    // item is just another "+Parallel Q" on this same answer.
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('iPhone');
    await expect(page.locator('.route-question-simple-tag[data-qid="q_1"]')).toBeChecked();
    await expect(page.locator('.route-question-text[data-qid="q_5"]')).toHaveValue('iPad');
    await expect(page.locator('.route-question-simple-tag[data-qid="q_5"]')).toBeChecked();
    // A Simple tag's one (self-match, frozen) answer no longer shows a redundant duplicate
    // text field — just the fan-out controls (route-editor-controller.ts).
    await expect(page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a0"]')).toHaveCount(0);
    // iPhone's own answer fans out into independent Model/Condition/Price-range specs — a
    // linear `flow` talk couldn't express any of this (multi-item, nor per-item multi-spec).
    await expect(page.locator('.route-question-text[data-qid="q_2"]')).toHaveValue('Model');
    await expect(page.locator('.route-answer-text[data-qid="q_2"][data-aid="q_2_a0"]')).toHaveValue('iPhone 15 or newer');
    await expect(page.locator('.route-question-text[data-qid="q_3"]')).toHaveValue('condition');
    await expect(page.locator('.route-question-text[data-qid="q_4"]')).toHaveValue('price range');
    await expect(page.locator('.route-builtin-kind[data-qid="q_4"]')).toHaveValue('priceRange');
    // Once a template is loaded, "Start from a template" doesn't show again (only for a
    // genuinely blank create) — no accidental double-hop back into the picker.
    await expect(page.locator('#browse-talk-templates-btn')).toHaveCount(0);
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Taxi Ride ─────────────────────────────────────────────────────────────────────
    await openPicker();
    await page.click('[data-testid="talk-template-taxi"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Taxi Ride');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('passenger');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_0"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('driver');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('What type of ride?');
    await expect(page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a0"]')).toHaveValue('Standard');
    await expect(page.locator('.route-question-text[data-qid="q_2"]')).toHaveValue('Are you available right now?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Job Seeker / Hiring ───────────────────────────────────────────────────────────
    await openPicker();
    await page.click('[data-testid="talk-template-job"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Job Seeker / Hiring');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('job seeker');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_0"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('hiring');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('What role are you interested in?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Dating (the one with the new ageRange built-in + forced adult lock) ─────────────
    await openPicker();
    await page.click('[data-testid="talk-template-dating"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Dating');
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('seeking women');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_0"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_0"][data-aid="q_0_a0"]')).toHaveValue('seeking men');
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('What are you looking for?');
    await expect(page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a0"]')).toHaveValue('Something casual');
    await expect(page.locator('.route-answer-text[data-qid="q_1"][data-aid="q_1_a1"]')).toHaveValue('Something serious');
    // "Something serious" branches into its own ageRange node (q_3), independent of the
    // "Something casual" branch's (q_2) — the goal-level fork the route shape now allows.
    await expect(page.locator('.route-node-advanced[data-qid="q_3"]')).toHaveJSProperty('open', true);
    await expect(page.locator('.route-question-text[data-qid="q_3"]')).toHaveValue('Age range');
    await expect(page.locator('.route-builtin-kind[data-qid="q_3"]')).toHaveValue('ageRange');
    await expect(page.locator('.route-builtin-agerange-age[data-qid="q_3"]')).toHaveValue('30');
    await expect(page.locator('.route-builtin-agerange-min[data-qid="q_3"]')).toHaveValue('25');
    await expect(page.locator('.route-builtin-agerange-max[data-qid="q_3"]')).toHaveValue('40');
    await expect(page.locator('#talk-is-adult')).toBeChecked();
    await expect(page.locator('#talk-is-adult')).toBeDisabled();
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Start from scratch — unchanged blank-editor behavior ────────────────────────────
    await openPicker();
    await page.click('[data-testid="talk-template-scratch"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('');
    await expect(page.locator('#talk-is-adult')).not.toBeChecked();
    await expect(page.locator('#talk-is-adult')).toBeEnabled();
    // Blank again — "Start from a template" is back, so the picker stays reachable.
    await expect(page.locator('#browse-talk-templates-btn')).toBeVisible();
  });
});
