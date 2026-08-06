/**
 * Option-matrix sweeps (merged: 64-talks-filter-sort-options, 65-me-filter-options,
 * 68-system-announcement, 67-talk-editor-option-matrix, 66-settings-option-matrix).
 * One boot instead of five; each test performs its own tab/dialog prologue (moved from
 * the source specs' beforeEach hooks).
 *
 * Ordering is deliberate: 66 (settings matrix) runs LAST because it mutates persisted
 * intake filters and the stage name; 67 closes its editor via #cancel-talk-btn so it
 * cannot leave a modal covering later tests.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openCollapsedFilters } from '../../helpers/filter-bar';

test.describe('Option matrices — talks/me filters, announcement, talk editor, settings (merged)', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeAll(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1200 }, deviceScaleFactor: 1 });
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

  test('nav modes, all 8 sorts, 5 types, completion, outcome, dates, query', async () => {
    const SORTS = ['recent', 'oldest', 'latest-reply', 'matches', 'responses', 'match-rate', 'weighted', 'title'];
    const TYPES = ['tag', 'flow', 'survey', 'route'];
    const COMPLETION = ['all', 'unanswered', 'answered'];
    const OUTCOME = ['all', 'match', 'mismatch'];
    await page!.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await page!.locator('#talks-filter-incoming').uncheck();
    await afterNav();
    await openCollapsedFilters(page!, 'talks-filter-toggle');
    const p = page!;

    // Direction checkboxes: both on (all), incoming-only, outgoing-only.
    await p.locator('#talks-filter-incoming').check();
    await afterNav();
    await expect(p.locator('#talks-filter-incoming')).toBeChecked();
    await expect(p.locator('#talks-filter-outgoing')).toBeChecked();

    await p.locator('#talks-filter-outgoing').uncheck();
    await afterNav();
    await expect(p.locator('#talks-filter-incoming')).toBeChecked();
    await expect(p.locator('#talks-filter-outgoing')).not.toBeChecked();

    await p.locator('#talks-filter-outgoing').check();
    await p.locator('#talks-filter-incoming').uncheck();
    await afterNav();
    await expect(p.locator('#talks-filter-incoming')).not.toBeChecked();
    await expect(p.locator('#talks-filter-outgoing')).toBeChecked();

    await p.locator('#talks-filter-incoming').check();
    await afterNav();
    await openCollapsedFilters(p, 'talks-filter-toggle');

    // 8 sort orders.
    for (const value of SORTS) {
      await p.selectOption('#talks-out-sort-order', value);
      await afterSync();
      await expect(p.locator('#talks-out-sort-order')).toHaveValue(value);
    }

    // 4 type checkboxes, toggled independently.
    for (const value of TYPES) {
      const checkbox = p.locator(`.talks-type-checkbox[value="${value}"]`);
      await checkbox.uncheck();
      await afterSync();
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
      await afterSync();
      await expect(checkbox).toBeChecked();
    }

    // 3 completion states.
    for (const value of COMPLETION) {
      await p.selectOption('#talks-filter-completion', value);
      await afterSync();
      await expect(p.locator('#talks-filter-completion')).toHaveValue(value);
    }

    // 3 outcomes.
    for (const value of OUTCOME) {
      await p.selectOption('#talks-filter-outcome', value);
      await afterSync();
      await expect(p.locator('#talks-filter-outcome')).toHaveValue(value);
    }

    // Date range + query.
    await p.fill('#talks-filter-date-from', '2020-01-01');
    await p.fill('#talks-filter-date-to', '2020-12-31');
    await afterSync();
    await expect(p.locator('#talks-filter-date-from')).toHaveValue('2020-01-01');
    await expect(p.locator('#talks-filter-date-to')).toHaveValue('2020-12-31');

    await p.fill('#talks-filter-query', 'nonexistent-term');
    await afterSync();
    await expect(p.locator('#talks-filter-query')).toHaveValue('nonexistent-term');

    // The Talks view is still rendered (no crash through the whole sweep).
    await expect(p.locator('#talks-view')).toBeVisible();
  });

  test('type toggles, tag states, outcome, sorts, query, dates, clear', async () => {
    const TYPES = ['tag', 'flow', 'survey', 'route'];
    const TAG_STATES = ['checked', 'unchecked', 'indeterminate'];
    const OUTCOMES = ['all', 'match', 'mismatch'];
    const SORTS = ['answered-desc', 'answered-asc', 'chatbot-recent', 'chatbot-count'];
    await page!.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await openCollapsedFilters(page!, 'me-filter-toggle');
    const p = page!;

    // 4 talk-type checkboxes: each starts checked; clicking toggles it off/on.
    for (const type of TYPES) {
      const cb = p.locator(`.me-talk-type-filter[data-me-talk-type="${type}"] input`);
      await expect(cb).toBeChecked();
      await cb.uncheck();
      await afterSync();
      await expect(cb).not.toBeChecked();
      await cb.check(); // restore
      await afterSync();
      await expect(cb).toBeChecked();
    }

    // 3 tag-state checkboxes toggle.
    for (const state of TAG_STATES) {
      const cb = p.locator(`.me-tag-state-filter[data-me-tag-state="${state}"] input`);
      await expect(cb).toBeChecked();
      await cb.uncheck();
      await afterSync();
      await expect(cb).not.toBeChecked();
      await cb.check();
      await afterSync();
    }

    // Outcome select.
    for (const value of OUTCOMES) {
      await p.selectOption('#me-outcome-filter', value);
      await afterSync();
      await expect(p.locator('#me-outcome-filter')).toHaveValue(value);
    }

    // 4 sort orders.
    for (const value of SORTS) {
      await p.selectOption('#me-answer-sort', value);
      await afterSync();
      await expect(p.locator('#me-answer-sort')).toHaveValue(value);
    }

    // Selected-answer query + date range.
    await p.fill('#me-answer-filter', 'yes');
    await p.fill('#me-answer-date-from', '2020-01-01');
    await p.fill('#me-answer-date-to', '2020-12-31');
    await afterSync();
    await expect(p.locator('#me-answer-filter')).toHaveValue('yes');

    // Deactivate a type, then Clear resets everything to defaults.
    await p.locator('.me-talk-type-filter[data-me-talk-type="tag"] input').click();
    await afterSync();
    await p.locator('#me-clear-filters').click();
    await afterSync();
    await expect(p.locator('.me-talk-type-filter[data-me-talk-type="tag"] input')).toBeChecked();
    await expect(p.locator('#me-outcome-filter')).toHaveValue('all');
    await expect(p.locator('#me-answer-filter')).toHaveValue('');
  });

  test('renders, dismisses, and stays dismissed for the same id', async () => {
    await page!.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    const p = page!;
    const ann = { id: 'e2e-announce-1', text: 'Scheduled maintenance tonight.' };

    await p.evaluate((a) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showSystemAnnouncement?.(a), ann);
    await afterSync();
    const banner = p.locator(`#system-announcement-${ann.id}`);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('maintenance');

    // Dismiss.
    await banner.locator('button').click();
    await afterSync();
    await expect(p.locator(`#system-announcement-${ann.id}`)).toHaveCount(0);

    // Re-show the same id → suppressed (dismissal recorded).
    await p.evaluate((a) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showSystemAnnouncement?.(a), ann);
    await afterSync();
    await expect(p.locator(`#system-announcement-${ann.id}`)).toHaveCount(0);
  });

  test('type radios, expirations, radii, checkboxes, and title validation', async () => {
    const TYPES = ['tag', 'flow', 'survey', 'route'];
    const EXPIRATIONS = ['', '1y', '1M', '1w', '1d'];
    const RADII = ['', '10', '100', '1000'];
    // Open the editor programmatically (stable across AppBar overflow states).
    await page!.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog?.());
    await afterNav();
    await page!.waitForSelector('#talk-editor-modal');
    const p = page!;

    // 4 type radios; route reveals the route editor, others the question container.
    for (const type of TYPES) {
      await p.check(`input[name="talk-type-radio"][value="${type}"]`);
      await afterSync();
      await expect(p.locator(`input[name="talk-type-radio"][value="${type}"]`)).toBeChecked();
      if (type === 'route') {
        await expect(p.locator('#route-form-group')).toBeVisible();
      } else if (type === 'tag') {
        // Tag talks have no question editor — one keyword plus the like-checkbox group.
        await expect(p.locator('#tag-like-group')).toBeVisible();
        await expect(p.locator('#questions-form-group')).toBeHidden();
      } else {
        await expect(p.locator('#questions-form-group')).toBeVisible();
      }
    }

    // 5 expirations.
    for (const value of EXPIRATIONS) {
      await p.selectOption('#talk-expires', value);
      await afterSync();
      await expect(p.locator('#talk-expires')).toHaveValue(value);
    }

    // 4 location radii.
    for (const value of RADII) {
      await p.selectOption('#talk-location-radius', value);
      await afterSync();
      await expect(p.locator('#talk-location-radius')).toHaveValue(value);
    }

    // Checkboxes toggle. Tag talks hide the options groups (minimal editor), so
    // drive the checkboxes on a flow talk where they are visible.
    await p.check('input[name="talk-type-radio"][value="flow"]');
    await afterSync();
    const sendChatroom = p.locator('#talk-send-to-chatroom');
    await expect(sendChatroom).toBeVisible();
    await sendChatroom.uncheck();
    await expect(sendChatroom).not.toBeChecked();
    const adult = p.locator('#talk-is-adult');
    await adult.check();
    await expect(adult).toBeChecked();

    // Validation: empty title blocks submit (modal stays open).
    await p.fill('#talk-title', '');
    await p.locator('#talk-submit-btn').click();
    await afterSync();
    await expect(p.locator('#talk-editor-modal')).toBeVisible();
    // Merged-file hygiene: close the editor so it cannot cover the next test.
    await p.locator('#cancel-talk-btn').click();
    await afterNav();
    await expect(p.locator('#talk-editor-modal')).toHaveCount(0);
  });

  test('stage-name, distance, language, and type guards', async () => {
    await page!.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await page!.waitForSelector('#settings-stage-name-input');
    const p = page!;

    // Set a valid stage name first.
    await p.fill('#settings-stage-name-input', 'ValidName');
    await p.locator('#settings-stage-name-input').blur();
    await afterSync();

    // Guard: stage name < 3 chars → inline error, value reverts to the valid one.
    await p.fill('#settings-stage-name-input', 'ab');
    await p.locator('#settings-stage-name-input').blur();
    await afterSync();
    await expect(p.locator('#settings-stage-name-error')).toBeVisible();
    await expect(p.locator('#settings-stage-name-input')).toHaveValue('ValidName');

    // Guard: min distance > max distance → rejected (revert).
    await p.fill('#settings-min-distance', '10');
    await p.locator('#settings-min-distance').dispatchEvent('change');
    await afterSync();
    await p.fill('#settings-max-distance', '25');
    await p.locator('#settings-max-distance').dispatchEvent('change');
    await afterSync();
    await p.fill('#settings-min-distance', '999');
    await p.locator('#settings-min-distance').dispatchEvent('change');
    await afterSync();
    // Min should not have persisted above max (reverted to prior valid 10).
    await expect(p.locator('#settings-min-distance')).not.toHaveValue('999');

    // Fallback: uncheck every allowed language → persisted as ['en'].
    const langOptions = p.locator('.settings-filter-language-option');
    const n = await langOptions.count();
    for (let i = 0; i < n; i++) {
      const cb = langOptions.nth(i);
      if (await cb.isChecked()) {
        await cb.uncheck();
        await cb.dispatchEvent('change');
      }
    }
    await afterSync();
    const langs = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').allowedLanguages,
    );
    expect(langs).toEqual(['en']);

    // Fallback: uncheck every allowed talk type → persisted as all four.
    const typeOptions = p.locator('.settings-talk-filter-type');
    const tn = await typeOptions.count();
    for (let i = 0; i < tn; i++) {
      const cb = typeOptions.nth(i);
      if (await cb.isChecked()) {
        await cb.uncheck();
        await cb.dispatchEvent('change');
      }
    }
    await afterSync();
    const types = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').allowedTalkTypes,
    );
    expect([...types].sort()).toEqual(['flow', 'route', 'survey', 'tag']);
  });
});
