/**
 * Sync-before-erase flow (GUI redesign §11.2, TODO item J).
 *
 * With a linked personal device recorded, the Erase dialog leads with "Save to
 * ⟨device⟩ first"; that opens the Sync-progress dialog, which reports per-category
 * progress and, on completion, enables the erase button (erase stays disabled
 * while the sync is in flight). The true cross-device receiver-merge + revocation
 * visibility is exercised by `cross-platform/x7` once the P2P handoff transfer is
 * wired; here we verify the local flow and gating.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Sync before erase', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage2Spec();
    context = await browser.newContext({ viewport: { width: 1000, height: 1100 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    // Seed one linked device so the erase dialog offers a sync first.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'iinpublic_linked_devices',
          JSON.stringify([{ pub: 'phone-pub', stageName: 'My Phone', platform: 'ios', linkedAt: Date.now() }]),
        );
      } catch {
        /* ignore */
      }
    });
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('sync offer → progress → done enables erase; erase gated during sync', async () => {
    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.eraseDevice);
    await p.waitForSelector('[data-testid="settings-erase-device-btn"]');
    await p.locator('[data-testid="settings-erase-device-btn"]').click();
    await afterNav();

    await expect(p.locator('[data-testid="erase-device-modal"]')).toBeVisible();
    // Sync-first offer present because a linked device is recorded.
    await expect(p.locator('[data-testid="erase-sync-first-btn"]')).toBeVisible();

    // Open the sync-progress dialog.
    await p.locator('[data-testid="erase-sync-first-btn"]').click();
    await afterNav();
    await expect(p.locator('[data-testid="erase-sync-progress-modal"]')).toBeVisible();
    // Categories are rendered.
    await expect(p.locator('.erase-sync-category')).toHaveCount(6);
    // Default progress completes and enables Done.
    await expect(p.locator('[data-testid="erase-sync-done"]')).toBeEnabled({ timeout: 8000 });
    await p.locator('[data-testid="erase-sync-done"]').click();
    await afterSync();

    // Back on the erase dialog: type-to-confirm still gates the erase button.
    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeDisabled();
    await p.fill('[data-testid="erase-confirm-input"]', 'ERASE');
    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeEnabled();
  });
});
