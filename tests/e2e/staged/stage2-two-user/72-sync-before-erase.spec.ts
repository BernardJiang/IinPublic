/**
 * Sync-before-erase flow (GUI redesign §11.2, TODO item J).
 *
 * With a linked personal device recorded, the Erase dialog leads with "Save to
 * ⟨device⟩ first"; that opens the Sync-progress dialog, which reports per-category
 * progress as the archive is built locally. §J's encrypted P2P handoff transfer is now
 * wired for real (web-device-handoff-service.ts) — the real two-device send→ack→import
 * round trip is `stage2-two-user/74-device-handoff-transfer.spec.ts`.
 *
 * This spec seeds a *fake* linked-device row (`phone-pub`) that was never a real SEA
 * identity and never published an epub — deliberately, to prove the safety invariant
 * spec §11.3 requires: "erase stays disabled until the archive is acknowledged by the
 * receiving device." A send to an unreachable/non-existent receiver must fail loudly
 * (an error shown, Done staying disabled), never silently succeed just because the local
 * archive-build step completed. Before §J's real wiring landed, this test asserted the
 * OPPOSITE (Done enabling on a fake device) — that was the intentionally-stubbed
 * placeholder behavior of a promise that always resolved locally; now that sending is
 * real, that old assertion would itself have been the safety-invariant violation it
 * exists to catch.
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
          JSON.stringify([{ pub: 'phone-pub', stageName: 'My Phone', platform: 'ios', linkedAt: Date.now(), state: 'linked' }]),
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

  test('sync offer → progress → a send to an unreachable device fails and keeps erase disabled', async () => {
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
    // Categories are rendered — the local archive build itself always completes.
    await expect(p.locator('.erase-sync-category')).toHaveCount(6);

    // `phone-pub` is not a real identity and never published an epub, so the real
    // encrypted send correctly fails (no-epub) — the safety invariant under test.
    await expect(p.locator('[data-testid="erase-sync-error"]')).not.toHaveText('', { timeout: 8000 });
    await expect(p.locator('[data-testid="erase-sync-done"]')).toBeDisabled();

    // Cancel out of the failed sync attempt; erase remains reachable but ungated by a
    // sync that never actually happened.
    await p.locator('#erase-sync-cancel').click();
    await afterSync();

    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeDisabled();
    await p.fill('[data-testid="erase-confirm-input"]', 'ERASE');
    await expect(p.locator('[data-testid="erase-device-btn"]')).toBeEnabled();
  });
});
