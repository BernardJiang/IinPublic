/** OPEN-98: the outing handlers remained wired after their UI entry points disappeared. */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { gotoWebApp, injectIdbClear } from '../../helpers/clear-database';
import { afterNav } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('match-collection controls', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('starts, reviews, and stops an outing from the phone-width Nearby list', async () => {
    const card = page.locator('[data-testid="match-collection-card"]');
    await expect(card).toBeVisible();
    // Collection is default-on, so startup/catch-up activity may already have lazily opened the
    // first outing. Normalize to the stopped state before exercising the explicit Start control.
    if (await card.locator('[data-testid="match-collection-start"]').count() === 0) {
      await card.locator('[data-testid="match-collection-stop"]').click();
      await expect(card.locator('[data-testid="match-collection-start"]')).toBeVisible();
    }
    await card.locator('[data-testid="match-collection-start"]').click();
    await afterNav();

    await expect(card.locator('[data-testid="match-collection-broadcast"]')).toBeVisible();
    await expect(card.locator('[data-testid="match-collection-review"]')).toBeVisible();
    await expect(card.locator('[data-testid="match-collection-stop"]')).toBeVisible();

    await card.locator('[data-testid="match-collection-review"]').click();
    await expect(page.locator('[data-testid="match-collection-review-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="match-collection-review-overlay"]')).toContainText('No one has been reached');
    await page.locator('#match-collection-review-close').click();

    await card.locator('[data-testid="match-collection-stop"]').click();
    await afterNav();
    await expect(card.locator('[data-testid="match-collection-start"]')).toBeVisible();
    await expect(card.locator('[data-testid="match-collection-review"]')).toBeVisible();
    await expect(card.locator('[data-testid="match-collection-stop"]')).toHaveCount(0);
  });
});
