/**
 * My Talks dialog (catalog Part 5, T6 tail; G4).
 * Single user: open the dialog, assert it renders, close via ✕.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('My Talks dialog', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('opens and closes', async () => {
    const p = page!;
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showMyTalksDialog?.());
    await afterNav();
    await expect(p.locator('#my-talks-modal')).toBeVisible({ timeout: 8000 });
    await p.locator('#close-my-talks-modal').click();
    await afterNav();
    await expect(p.locator('#my-talks-modal')).toHaveCount(0);
  });
});
