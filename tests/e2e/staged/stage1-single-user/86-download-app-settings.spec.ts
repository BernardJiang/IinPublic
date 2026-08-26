/**
 * Settings > "Download the app" + the app-download banner's rewording. IinPublic really does
 * ship native Mac/Windows/Android apps (Electron desktop, `platforms/desktop`; `android/` is a
 * real Gradle project) — the old banner copy ("App not available on this network yet") read
 * like a network/connectivity problem when it actually just meant "no build published for your
 * platform yet." Neither the banner nor the new Settings section ever says "not
 * available"/"network" now — a platform with no published build shows "Coming soon" instead,
 * and the banner's non-matching-platform state links straight into this section rather than
 * dead-ending.
 *
 * This test env sets no `IINPUBLIC_DOWNLOAD_*_URL` env var and hosts nothing under
 * `public/downloads/`, so every platform is deterministically in the "Coming soon" state — the
 * "real download link" branch (`GET /api/downloads` returning a URL) is exercised only by
 * manual verification (downloads-routes.ts's manifest-building logic is otherwise untested
 * elsewhere in this suite), not re-proven here.
 */
import { Browser } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Download the app (banner rewording + Settings section)', () => {
  let browser: Browser;

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({ headless });
  });

  test.afterEach(async () => {
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('Settings > Download the app lists all 3 platforms, each "Coming soon" with nothing published', async () => {
    const user = await bootstrapUser(browser, 'Downloader', 'DownloaderUser');
    const { page } = user;

    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    await openSettingsSection(page, SETTINGS_SECTION.downloadApp);

    const body = page.locator('#settings-download-app-body');
    await expect(body).toBeVisible();
    for (const platform of ['mac', 'windows', 'android']) {
      await expect(page.locator(`[data-testid="settings-download-app-row-${platform}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="settings-download-app-soon-${platform}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="settings-download-app-link-${platform}"]`)).toHaveCount(0);
    }
  });

  test('app-download banner never says "not available"/"network" and its fallback link opens the Settings section', async () => {
    const user = await bootstrapUser(browser, 'Downloader2', 'Downloader2User');
    const { page } = user;

    const banner = page.locator('#app-download-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).not.toContainText(/not available/i);
    await expect(banner).not.toContainText(/network/i);

    // No download URL for this test env's detected platform — the fallback is a "See download
    // options" action, not a dead end, and it drills straight into the Settings section.
    const seeOptions = banner.locator('[data-action="see-options"]');
    await expect(seeOptions).toBeVisible();
    await seeOptions.click();

    await expect(page.locator('#settings-detail-container')).toBeVisible();
    await expect(page.locator('#settings-section-download-app')).toBeVisible();
    await expect(page.locator('#settings-download-app-body')).toBeVisible();
  });
});
