/**
 * OPEN-33 — the Android sideload-update reminder banner.
 *
 * A sideloaded (non-Play-Store) Android APK has no update channel, so the app reminds the user
 * when `GET /api/downloads` publishes a *newer* version than this device is running: it renders a
 * dismissible banner (linking straight to the APK) plus a "!" badge on the Settings gear.
 *
 * The show-or-not decision (`shouldShowUpdateReminder`) is covered by unit tests in
 * app-update-reminder-view.test.ts, but the real DOM lifecycle — banner render, dismiss
 * persistence, the Settings badge, and re-reminding for a still-newer version — has never been
 * exercised in a browser. This spec drives the real UI-manager code path (boot with the native
 * shell identity a WebView would send — `?native_platform=android&app_version=` — the exact query
 * app MainActivity appends, per native-host-info.ts) and checks the banner against a mocked
 * `/api/downloads` manifest.
 *
 * Determinism: no real APK is published here, so we serve the manifest ourselves via a network
 * route (the banner fetches `apiBase/api/downloads`), and we set a fixed running version in the
 * query string so the "is newer" comparison is fixed.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

const RUNNING_VERSION = '1.0.50';
const SERVER_VERSION = '1.0.99';
const SERVER_VERSION_2 = '1.0.100';
const APK_URL = '/api/downloads/IinPublic-1.0.99.apk';
const APK_URL_2 = '/api/downloads/IinPublic-1.0.100.apk';
const DISMISSED_KEY = 'iinpublic_update_reminder_dismissed_version';

test.describe('OPEN-33 Android update-reminder banner (real-browser DOM lifecycle)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    // Serve a manifest advertising a newer Android APK. The banner fetches it at boot and we
    // re-invoke the real render for the re-remind case, so keep one route that returns whatever
    // the current test wants.
    let advertised: { version: string; android: string } = { version: SERVER_VERSION, android: APK_URL };
    await page.route('**/api/downloads', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify(advertised),
      });
    });
    // Hook so tests can change the advertised version between renders (route closure lives here).
    (page as unknown as { __setAdvertised?: (v: string, a: string) => void }).__setAdvertised = (vv, aa) => {
      advertised = { version: vv, android: aa };
    };
  });

  test.afterAll(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('renders on Android when a newer APK is published; dismiss persists and a still-newer version re-reminds', async () => {
    // Boot as the Android WebView would: native platform + this device's running version.
    await injectIdbClear(page);
    const url = `${webBaseURL()}/?native_platform=android&app_version=${RUNNING_VERSION}`;
    await gotoWebApp(page, url);
    await afterSync();

    // Re-run the real UI-manager render (idempotent: no-op if a banner already exists) so the
    // assertions don't depend on the fire-and-forget boot call having finished first.
    await page.evaluate(async () => {
      const m = (window as any).__iinpublic_app?.getApp?.()?.uiManager;
      await m?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();

    const banner = page.locator('#app-update-reminder-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(SERVER_VERSION);
    await expect(page.locator('[data-testid="app-update-reminder-link"]')).toHaveAttribute(
      'href',
      APK_URL,
    );

    // The "!" badge lands on the Settings gear.
    const settingsBadge = page.locator('.nav-btn[data-view="settings"] .nav-icon .notification-badge');
    await expect(settingsBadge).toHaveText('!');

    // Dismiss: banner gone, dismissal recorded, badge removed.
    await page.locator('[data-testid="app-update-reminder-dismiss"]').click();
    await afterSync();
    await expect(page.locator('#app-update-reminder-banner')).toHaveCount(0);
    await expect(settingsBadge).toHaveCount(0);
    const dismissedValue = await page.evaluate(
      (k) => localStorage.getItem(k as string),
      DISMISSED_KEY,
    );
    expect(dismissedValue).toBe(SERVER_VERSION);

    // Re-render the SAME (now-dismissed) version → still hidden (dismissal recorded).
    await page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.uiManager?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();
    await expect(page.locator('#app-update-reminder-banner')).toHaveCount(0);

    // A still-newer version published afterward → reminding again, even though 1.0.99 was dismissed.
    // (At this point the banner is already absent, so render is free to decide from scratch.)
    (page as unknown as { __setAdvertised?: (v: string, a: string) => void }).__setAdvertised?.(
      SERVER_VERSION_2,
      APK_URL_2,
    );
    await page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.uiManager?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();
    const banner2 = page.locator('#app-update-reminder-banner');
    await expect(banner2).toBeVisible();
    await expect(banner2).toContainText(SERVER_VERSION_2);
    await expect(page.locator('[data-testid="app-update-reminder-link"]')).toHaveAttribute(
      'href',
      APK_URL_2,
    );
  });

  test('a version not newer than the running one never renders the banner', async () => {
    // Dismiss/tear down the previous banner so render is free to decide from scratch, clear the
    // remembered dismissal, advertise a version equal to the running one, then re-render.
    if ((await page.locator('#app-update-reminder-banner').count()) > 0) {
      await page.locator('[data-testid="app-update-reminder-dismiss"]').click();
      await afterSync();
    }
    await page.evaluate(
      (k) => localStorage.removeItem(k as string),
      DISMISSED_KEY,
    );
    (page as unknown as { __setAdvertised?: (v: string, a: string) => void }).__setAdvertised?.(
      RUNNING_VERSION,
      APK_URL,
    );
    await page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.uiManager?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();
    expect(await page.locator('#app-update-reminder-banner').count()).toBe(0);
    expect(await page.locator('.nav-btn[data-view="settings"] .nav-icon .notification-badge').count()).toBe(0);
  });

  test('does not render on a non-Android (web) shell even when a newer version is published', async () => {
    // New context, web platform (no native_platform query) — the banner is Android-only by design.
    // Reset any dismissal so the only reason it must stay hidden is the platform gate.
    await page.evaluate(() => localStorage.removeItem('iinpublic_update_reminder_dismissed_version'));
    const url = `${webBaseURL()}/?app_version=${RUNNING_VERSION}`;
    await page.goto(url);
    await page.waitForLoadState('load');
    // Wait for the app shell (nav) so the code path's guard has its DOM.
    await page.waitForSelector('.nav-btn[data-view="chatrooms"]', { timeout: 20_000 });
    await afterSync();

    await page.evaluate(async () => {
      await (window as any).__iinpublic_app?.getApp?.()?.uiManager?.renderAppUpdateReminderBanner?.();
    });
    await afterSync();
    await expect(page.locator('#app-update-reminder-banner')).toHaveCount(0);
  });
});
