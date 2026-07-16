/**
 * System announcement banner (catalog Part 5 — closes the last "None" gap; G3).
 *
 * Single user: a server announcement renders a dismissible full-width banner
 * under the AppBar; dismissing removes it and records the dismissal so the same
 * announcement id does not reappear.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('System announcement banner', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
    await page.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('renders, dismisses, and stays dismissed for the same id', async () => {
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
});
