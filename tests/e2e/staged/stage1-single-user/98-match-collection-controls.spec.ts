/**
 * OPEN-98, owner rule 2026-11-09: no buttons inside views. The match collection has no card on the
 * Nearby list; the Nearby status line in the AppBar opens Contacts narrowed to its people.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { gotoWebApp, injectIdbClear } from '../../helpers/clear-database';
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

  test('the Nearby status line opens the collection in Contacts; the list has no outing card', async () => {
    await expect(page.locator('[data-testid="nearby-browser-list"]')).toBeVisible();
    await expect(page.locator('[data-testid^="match-collection-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nearby-browser-list"] .btn')).toHaveCount(0);

    const status = page.locator('#status-bar-text');
    await expect(status).toHaveAttribute('role', 'link');
    await status.click();
    await expect(page.locator('.nav-btn[data-view="contacts"]')).toHaveClass(/active/);
    // Collection is on by default and starts at boot, so the chip names it.
    const chip = page.locator('[data-testid="contacts-focus-chip"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('📣');

    await chip.locator('[data-testid="contacts-focus-clear"]').click();
    await expect(chip).toBeHidden();
  });
});
