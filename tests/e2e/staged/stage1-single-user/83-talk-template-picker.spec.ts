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
 * Dating (§DD, reshaped 2026-08-26) is structurally similar but inverted: an `ageRange` built-in
 * root — not a Pair-tag — asked first, whose Compatible outcome fans out (parallel, threshold 1)
 * into 3 independent single-answer Pair-tag leaves, one per accepted gender — docs/TODO.md §DD's
 * multi-value gender/race preference matching, modeled as several independent Pair-tag
 * declarations rather than one Pair-tag with several answers. This spec proves both the
 * `ageRange` built-in comparator renders correctly nested inside the route editor and that all 3
 * fanned-out gender branches prefill correctly, plus the force-checked-and-disabled
 * adult-content lock. It does NOT re-prove the underlying Pair-tag + chatbot cross-talk matching
 * mechanism (already proven by 89-buy-sell-chatbot-cross-talk-match.spec.ts and the taxi spec)
 * or the fan-out veto itself (unit-tested directly in talk-engine.test.ts) — see
 * 96-dating-multi-gender-match.spec.ts for a real cross-browser proof of the reshaped template.
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

    // ── Dating (age asked first, then 3 parallel Pair-tag gender branches fan out off its
    // Compatible outcome — docs/TODO.md §DD's multi-value gender/race preference matching) ──
    await openPicker();
    await page.click('[data-testid="talk-template-dating"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Dating');
    await expect(page.locator('.route-node-advanced[data-qid="q_0"]')).toHaveJSProperty('open', true);
    await expect(page.locator('.route-question-text[data-qid="q_0"]')).toHaveValue('Age range');
    await expect(page.locator('.route-builtin-kind[data-qid="q_0"]')).toHaveValue('ageRange');
    await expect(page.locator('.route-builtin-agerange-age[data-qid="q_0"]')).toHaveValue('28');
    await expect(page.locator('.route-builtin-agerange-min[data-qid="q_0"]')).toHaveValue('21');
    await expect(page.locator('.route-builtin-agerange-max[data-qid="q_0"]')).toHaveValue('45');
    await expect(page.locator('#talk-is-adult')).toBeChecked();
    await expect(page.locator('#talk-is-adult')).toBeDisabled();
    // The age root's Compatible outcome fans out (parallel, threshold 1 — any ONE accepted
    // gender is enough) into 3 independent Pair-tag branches, one per accepted gender, each
    // followed by a trivial confirmation leaf (needed for the responder-tag veto to have
    // something to run against — a bare Pair-tag leaf has nothing after it for the existing
    // mid-tree veto mechanism to gate, see talk-templates.ts's own doc comment).
    await expect(page.locator('.route-question-text[data-qid="q_1"]')).toHaveValue('men');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_1"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_1"][data-aid="a_1_match"]')).toHaveValue('men');
    await expect(page.locator('.route-question-text[data-qid="q_1c"]')).toHaveValue('Confirm: interested in men');
    await expect(page.locator('.route-answer-text[data-qid="q_1c"][data-aid="a_1c_match"]')).toHaveValue('Yes');
    await expect(page.locator('.route-question-text[data-qid="q_2"]')).toHaveValue('men');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_2"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_2"][data-aid="a_2_match"]')).toHaveValue('women');
    await expect(page.locator('.route-question-text[data-qid="q_2c"]')).toHaveValue('Confirm: interested in women');
    await expect(page.locator('.route-question-text[data-qid="q_3"]')).toHaveValue('men');
    await expect(page.locator('.route-question-reciprocal-tag[data-qid="q_3"]')).toBeChecked();
    await expect(page.locator('.route-answer-text[data-qid="q_3"][data-aid="a_3_match"]')).toHaveValue('non-binary people');
    await expect(page.locator('.route-question-text[data-qid="q_3c"]')).toHaveValue('Confirm: interested in non-binary people');
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
