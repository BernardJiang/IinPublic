/**
 * Talks tab — filter/sort option matrix (catalog Part 5, R1–R3).
 *
 * Single user: exercises every Talks control across every value and asserts the
 * control is interactive, reflects the chosen value, and the list re-renders
 * without error. Reply-dependent *semantics* (match rate, most replies) are
 * covered by the stage-2 pass; here we prove the full option surface is wired.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openCollapsedFilters } from '../../helpers/filter-bar';

const SORTS = ['recent', 'oldest', 'latest-reply', 'matches', 'responses', 'match-rate', 'weighted', 'title'];
const TYPES = ['all', 'tag', 'flow', 'survey', 'route'];
const COMPLETION = ['all', 'unanswered', 'answered'];
const OUTCOME = ['all', 'match', 'mismatch'];

test.describe('Talks: filter/sort option matrix', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
    await page.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await page.locator('#talks-nav-out').click();
    await afterNav();
    await openCollapsedFilters(page, 'talks-filter-toggle');
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('nav modes, all 8 sorts, 5 types, completion, outcome, dates, query', async () => {
    const p = page!;

    // Nav modes.
    for (const mode of ['talks-nav-all', 'talks-nav-in', 'talks-nav-out']) {
      await p.locator(`#${mode}`).click();
      await afterNav();
      await expect(p.locator(`#${mode}`)).toHaveClass(/active/);
    }
    await p.locator('#talks-nav-out').click();
    await afterNav();
    await openCollapsedFilters(p, 'talks-filter-toggle');

    // 8 sort orders.
    for (const value of SORTS) {
      await p.selectOption('#talks-out-sort-order', value);
      await afterSync();
      await expect(p.locator('#talks-out-sort-order')).toHaveValue(value);
    }

    // 5 type filters.
    for (const value of TYPES) {
      await p.selectOption('#talks-filter-type', value);
      await afterSync();
      await expect(p.locator('#talks-filter-type')).toHaveValue(value);
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
});
