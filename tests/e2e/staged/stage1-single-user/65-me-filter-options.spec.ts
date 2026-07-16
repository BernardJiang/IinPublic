/**
 * Me tab — answer filter/sort option matrix (catalog Part 5).
 *
 * Single user: 4 talk-type toggles, 3 tag-state checkboxes, outcome select,
 * 4 sort orders, selected-answer query, date range, and Clear. Asserts each
 * control is interactive and Clear resets them.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openCollapsedFilters } from '../../helpers/filter-bar';

const TYPES = ['tag', 'flow', 'survey', 'route'];
const TAG_STATES = ['checked', 'unchecked', 'indeterminate'];
const OUTCOMES = ['all', 'match', 'mismatch'];
const SORTS = ['answered-desc', 'answered-asc', 'chatbot-recent', 'chatbot-count'];

test.describe('Me: answer filter/sort option matrix', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
    await page.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await openCollapsedFilters(page, 'me-filter-toggle');
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('type toggles, tag states, outcome, sorts, query, dates, clear', async () => {
    const p = page!;

    // 4 talk-type toggles: each starts active; clicking toggles the active class.
    for (const type of TYPES) {
      const btn = p.locator(`.me-talk-type-filter[data-me-talk-type="${type}"]`);
      await expect(btn).toHaveClass(/active/);
      await btn.click();
      await afterSync();
      await expect(btn).not.toHaveClass(/active/);
      await btn.click(); // restore
      await afterSync();
      await expect(btn).toHaveClass(/active/);
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
    await p.locator('.me-talk-type-filter[data-me-talk-type="tag"]').click();
    await afterSync();
    await p.locator('#me-clear-filters').click();
    await afterSync();
    await expect(p.locator('.me-talk-type-filter[data-me-talk-type="tag"]')).toHaveClass(/active/);
    await expect(p.locator('#me-outcome-filter')).toHaveValue('all');
    await expect(p.locator('#me-answer-filter')).toHaveValue('');
  });
});
