/**
 * Production-only geolocation permission coverage.
 *
 * Development bundles intentionally use a fixed location and cannot exercise this path. Run via
 * `npm run test:e2e:firefox-permissions`, which builds the production bundle and serves it from
 * the ordinary E2E static server.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { gotoWebApp } from '../helpers/clear-database';
import { webBaseURL } from '../helpers/ports';

const ENABLED = process.env.E2E_PRODUCTION_PERMISSIONS === '1';

async function freshPage(context: BrowserContext): Promise<Page> {
  await context.addInitScript(() => localStorage.setItem('iinpublic_walkthrough_seen', 'true'));
  const page = await context.newPage();
  await gotoWebApp(page, webBaseURL(), 30_000);
  return page;
}

test.describe('@smoke production geolocation permissions', () => {
  test.skip(!ENABLED, 'Run with npm run test:e2e:firefox-permissions (production bundle required)');

  test.beforeEach(async () => clearGunForStage1Spec());
  test.afterEach(async () => clearGunForStage1Spec());

  test('granted Firefox geolocation is requested, cached, and applied without blocking boot', async ({ browser }) => {
    const expected = { latitude: 37.7749, longitude: -122.4194 };
    const context = await browser.newContext({
      geolocation: { ...expected, accuracy: 12 },
      permissions: ['geolocation'],
    });
    try {
      const page = await freshPage(context);
      await expect
        .poll(() => page.evaluate(() => {
          const raw = localStorage.getItem('iinpublic_cached_location');
          return raw ? JSON.parse(raw) : null;
        }))
        .toMatchObject({ ...expected, accuracy: 12 });
      await expect(page.locator('body')).not.toContainText('Oops! Something went wrong');
    } finally {
      await context.close();
    }
  });

  test('denied Firefox geolocation keeps the app usable and does not invent a cached fix', async ({ browser }) => {
    const context = await browser.newContext();
    await context.clearPermissions();
    try {
      const page = await freshPage(context);
      await expect(page.locator('.bottom-nav')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Oops! Something went wrong');
      expect(await page.evaluate(() => localStorage.getItem('iinpublic_cached_location'))).toBeNull();
    } finally {
      await context.close();
    }
  });
});
