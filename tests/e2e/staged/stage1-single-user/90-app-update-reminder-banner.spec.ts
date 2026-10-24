/**
 * OPEN-33 — the Android sideload-update reminder banner.
 *
 * A sideloaded (non-Play-Store) Android APK has no update channel, so the app reminds the user
 * when `GET /api/downloads` publishes a *newer* version than the running one: it renders a
 * dismissible banner (linking straight to the APK) plus a "!" badge on the Settings gear.
 *
 * The show-or-not decision (`shouldShowUpdateReminder`) is covered by unit tests in
 * `app-update-reminder-view.test.ts`, but the real DOM lifecycle — banner rendering, Settings
 * badge attachment, dismiss persistence via `localStorage`, and re-reminding for a still-newer
 * version — has never been exercised in a browser. Each test here boots the app the way the
 * real Android WebView would (the `?native_platform=android&app_version=` query that
 * `MainActivity.kt` appends to its loopback URL, per `native-host-info.ts`) against a mocked
 * `/api/downloads` manifest, and asserts the banner + badge end-to-end.
 *
 * Structure follows the sibling `86-download-app-settings.spec.ts`: a fresh browser context per
 * test (fresh `localStorage` / IndexedDB) so tests are self-contained and independent — no
 * state is assumed to come from another test in this file. Determinism: the manifest is served
 * by a context-level `page.route` whose shape is set per test via `setAdvertised`, and the
 * running version is pinned in the app URL query param. For negative tests (no banner
 * expected), we wait on an in-page `MANIFEST_SERVED` flag (set by that same route) before
 * asserting absence, so a still-in-flight boot render cannot cause a false pass.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

const RUNNING_VERSION = '1.0.50';
const SERVER_VERSION = '1.0.99';
const SERVER_VERSION_2 = '1.0.100';
const APK_URL = '/api/downloads/IinPublic-1.0.99.apk';
const APK_URL_2 = '/api/downloads/IinPublic-1.0.100.apk';
const DISMISSED_KEY = 'iinpublic_update_reminder_dismissed_version';

/** Set in-page by the mocked `/api/downloads` route so negative tests can deterministically
 * wait until the boot-time manifest fetch (and the render decision that follows) has been
 * handled, instead of asserting on a banner that could still be arriving. */
const MANIFEST_SERVED_FLAG = '__e2e_manifest_served';

/** Module-scope manifest the route serves; tests call `setAdvertised` before `gotoWebApp` to
 * fix the version / APK the banner's decision sees. */
let advertised = { version: SERVER_VERSION, android: APK_URL };
function setAdvertised(version: string, android: string): void {
  advertised = { version, android };
}

/** True once the mocked route has served the manifest (for negative-test waiting). */
const manifestServed = (pageRef: Page): Promise<boolean> =>
  pageRef.evaluate((flag: string) => Boolean((window as unknown as Record<string, boolean>)[flag]), MANIFEST_SERVED_FLAG);

const bannerLocator = (pageRef: Page) => pageRef.locator('#app-update-reminder-banner');
const settingsBadgeLocator = (pageRef: Page) =>
  pageRef.locator('.nav-btn[data-view="settings"] .nav-icon .notification-badge');

test.describe('OPEN-33 Android update-reminder banner (real-browser DOM lifecycle)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch();
  });

  test.beforeEach(async () => {
    setAdvertised(SERVER_VERSION, APK_URL);
    context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await context.route('**/api/downloads', async (route) => {
      await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify(advertised) });
      // Mark in-page that the manifest has been served, so negative tests can deterministically
      // wait on it (the banner's render call is a void fire-and-forget whose fetch is async and
      // can outlive `initialized=true`).
      await page
        .evaluate((flag: string) => { (window as unknown as Record<string, boolean>)[flag] = true; }, MANIFEST_SERVED_FLAG)
        .catch(() => {});
    });
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
  });

  test('shows the banner and Settings badge at boot when a newer APK is published', async () => {
    setAdvertised(SERVER_VERSION, APK_URL);
    await gotoWebApp(page, `${webBaseURL()}/?native_platform=android&app_version=${RUNNING_VERSION}`);

    // `gotoWebApp` → `waitForAppReady` returns as soon as `initialized=true`; the banner render
    // (a `void` `app.ts`-boot-time call) runs just before that flag but its fetch is async, so
    // wait for the served flag first — that guarantees the render has had its decision input.
    await expect(async () => {
      expect(await manifestServed(page)).toBe(true);
    }).toPass({ timeout: 15_000, intervals: [200, 400, 800] });

    const banner = bannerLocator(page);
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(SERVER_VERSION);
    await expect(page.locator('[data-testid="app-update-reminder-link"]')).toHaveAttribute('href', APK_URL);
    await expect(settingsBadgeLocator(page)).toHaveText('!');
  });

  test('dismiss removes banner + badge, persists the dismissal, and the same version stays hidden on re-render', async () => {
    setAdvertised(SERVER_VERSION, APK_URL);
    await gotoWebApp(page, `${webBaseURL()}/?native_platform=android&app_version=${RUNNING_VERSION}`);
    const banner = bannerLocator(page);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(settingsBadgeLocator(page)).toHaveText('!');

    await page.locator('[data-testid="app-update-reminder-dismiss"]').click();
    await afterSync();
    await expect(banner).toHaveCount(0);
    await expect(settingsBadgeLocator(page)).toHaveCount(0);
    expect(await page.evaluate((k: string) => localStorage.getItem(k), DISMISSED_KEY)).toBe(SERVER_VERSION);

    // Re-run the same real UI-manager call against the same (now-dismissed) version: must stay hidden.
    await page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.uiManager?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();
    await expect(banner).toHaveCount(0);
  });

  test('a still-newer version re-triggers after the older one was dismissed', async () => {
    setAdvertised(SERVER_VERSION, APK_URL);
    await gotoWebApp(page, `${webBaseURL()}/?native_platform=android&app_version=${RUNNING_VERSION}`);
    const banner = bannerLocator(page);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(settingsBadgeLocator(page)).toHaveText('!');
    await page.locator('[data-testid="app-update-reminder-dismiss"]').click();
    await afterSync();
    await expect(banner).toHaveCount(0);

    // A later publish, with the older dismissal still recorded in `localStorage`: re-render must
    // show the banner again because `1.0.99` < `1.0.100`.
    setAdvertised(SERVER_VERSION_2, APK_URL_2);
    await page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.uiManager?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(SERVER_VERSION_2);
    await expect(page.locator('[data-testid="app-update-reminder-link"]')).toHaveAttribute('href', APK_URL_2);
    await expect(settingsBadgeLocator(page)).toHaveText('!');
  });

  test('does not render when the published version is not newer than the running one', async () => {
    setAdvertised(RUNNING_VERSION, APK_URL);
    await gotoWebApp(page, `${webBaseURL()}/?native_platform=android&app_version=${RUNNING_VERSION}`);

    // Wait until the manifest has actually been served, then assert the banner is absent.
    await expect(async () => {
      expect(await manifestServed(page)).toBe(true);
    }).toPass({ timeout: 15_000, intervals: [200, 400, 800] });
    await expect(bannerLocator(page)).toHaveCount(0);
    await expect(settingsBadgeLocator(page)).toHaveCount(0);
  });

  test('does not render on a non-Android (web) shell even when a newer version is published', async () => {
    setAdvertised(SERVER_VERSION, APK_URL);
    await gotoWebApp(page, `${webBaseURL()}/?app_version=${RUNNING_VERSION}`);

    // The platform guard short-circuits before any fetch: a plain absence assertion is safe here.
    await afterSync();
    await expect(bannerLocator(page)).toHaveCount(0);
    await expect(settingsBadgeLocator(page)).toHaveCount(0);
  });
});
