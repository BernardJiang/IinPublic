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
 * This spec proves the picker renders the original 4 templates + scratch and that each
 * template's prefill is structurally correct — title/type/Q1 Pair-tag word/Q2 text, and for
 * Dating, the new `ageRange` built-in fields (§DD) plus the force-checked-and-disabled
 * adult-content lock. It does NOT re-prove the underlying Pair-tag + chatbot cross-talk matching
 * mechanism (already proven by 89-buy-sell-chatbot-cross-talk-match.spec.ts and the taxi spec) —
 * only Dating's genuinely new `ageRange` mechanism gets its own full match spec,
 * 94-dating-agerange-match.spec.ts. The 4 newer templates' prefills, and a customize+expand
 * flow proving a template's fields and question flow stay fully editable after picking it, live
 * in 85-talk-template-customize-and-expand.spec.ts.
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

    // ── Buy / Sell ────────────────────────────────────────────────────────────────────
    await page.click('[data-testid="talk-template-buySell"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Buy / Sell');
    await expect(page.locator('#talk-type')).toHaveValue('flow');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('buy');
    await expect(page.locator('.question-item[data-question-index="0"] .question-reciprocal-tag')).toBeChecked();
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('sell');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue('What are you looking to buy or sell?');
    await expect(page.locator('.question-item[data-question-index="1"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('iPhone');
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
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('passenger');
    await expect(page.locator('.question-item[data-question-index="0"] .question-reciprocal-tag')).toBeChecked();
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('driver');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue('Are you available right now?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Job Seeker / Hiring ───────────────────────────────────────────────────────────
    await openPicker();
    await page.click('[data-testid="talk-template-job"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Job Seeker / Hiring');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('job seeker');
    await expect(page.locator('.question-item[data-question-index="0"] .question-reciprocal-tag')).toBeChecked();
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('hiring');
    await expect(page.locator('.question-item[data-question-index="1"] .question-text')).toHaveValue('What role are you interested in?');
    await page.locator('#cancel-talk-btn').click();
    await page.waitForSelector('#talk-editor-modal', { state: 'detached' });

    // ── Dating (the one with the new ageRange built-in + forced adult lock) ─────────────
    await openPicker();
    await page.click('[data-testid="talk-template-dating"]');
    await page.waitForSelector('#talk-editor-modal');
    await expect(page.locator('#talk-title')).toHaveValue('Dating');
    await expect(page.locator('.question-item[data-question-index="0"] .question-text')).toHaveValue('seeking women');
    await expect(page.locator('.question-item[data-question-index="0"] .question-reciprocal-tag')).toBeChecked();
    await expect(page.locator('.question-item[data-question-index="0"] .answer-item[data-answer-index="0"] .answer-text')).toHaveValue('seeking men');
    // Progressive disclosure: the template's Pair tag is already set, so its advanced <details>
    // starts open — the value is never hidden behind an extra click.
    await expect(page.locator('.question-item[data-question-index="0"] .question-advanced')).toHaveJSProperty('open', true);
    const q2 = page.locator('.question-item[data-question-index="1"]');
    await expect(q2.locator('.question-advanced')).toHaveJSProperty('open', true);
    await expect(q2.locator('.question-text')).toHaveValue('Age range');
    await expect(q2.locator('.builtin-kind')).toHaveValue('ageRange');
    await expect(q2.locator('.builtin-agerange-age')).toHaveValue('30');
    await expect(q2.locator('.builtin-agerange-min')).toHaveValue('25');
    await expect(q2.locator('.builtin-agerange-max')).toHaveValue('40');
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
