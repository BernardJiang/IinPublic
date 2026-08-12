/**
 * Mobile viewport sanity: core app navigation stays usable on phone-sized screens.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe('Mobile viewport navigation', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
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

  test('bottom navigation and primary panels fit a phone viewport', async () => {
    expect(page).toBeTruthy();
    const p = page!;

    await expect(p.locator('.bottom-nav .nav-label')).toHaveText([
      'Chatrooms',
      'Contacts',
      'Talks',
      'Me',
      'Settings',
    ]);

    for (const view of ['chatrooms', 'contacts', 'talks', 'me', 'settings']) {
      await p.locator(`.nav-btn[data-view="${view}"]`).click();
      await afterNav();
      await expect(p.locator(`#${view}-view`)).toBeVisible({ timeout: 15_000 });
      await expect(p.locator('.bottom-nav')).toBeVisible();
      const horizontalOverflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(horizontalOverflow).toBeLessThanOrEqual(2);
    }
  });

  test('connectivity controls are labelled, responsive, and persist on a phone viewport', async () => {
    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.connectivity);

    await expect(p.getByLabel('Preset')).toBeVisible();
    await expect(p.getByLabel('Metered network permission')).toBeVisible();
    await expect(p.getByLabel('Forward for peers')).toBeVisible();
    await expect(p.locator('#settings-connectivity-status')).toHaveAttribute('role', 'status');
    await p.getByLabel('Preset').selectOption('data-saver');
    await expect.poll(() => p.evaluate(() => JSON.parse(localStorage.getItem('iinpublic_connectivity_settings_v1') || '{}').preset)).toBe('data-saver');
    expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);

    await p.reload();
    await afterSync();
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await openSettingsSection(p, SETTINGS_SECTION.connectivity);
    await expect(p.getByLabel('Preset')).toHaveValue('data-saver');
  });
});
