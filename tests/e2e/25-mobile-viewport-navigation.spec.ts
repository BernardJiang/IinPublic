/**
 * Mobile viewport sanity: core app navigation stays usable on phone-sized screens.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { afterNav, afterSync } from './helpers/timing';
import { webBaseURL } from './helpers/ports';

test.describe('Mobile viewport navigation', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunDatabases();
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunDatabases();
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
});
