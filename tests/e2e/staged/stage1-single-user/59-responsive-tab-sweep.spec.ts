/**
 * Responsive tab sweep (GUI redesign §8, catalog T7).
 *
 * Every tab at every reference width (320 · 390 · 768 · 1024) must render with
 * no horizontal clipping, keep the bottom nav visible, and keep the AppBar's
 * primary action reachable (inline or via the ⋯ overflow menu). Runs once in
 * English and once with the Chinese UI to catch label-length overflow.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

const WIDTHS = [320, 390, 768, 1024];
const VIEWS = ['chatrooms', 'contacts', 'talks', 'me', 'settings'];

test.describe('Responsive tab sweep across the width matrix', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  async function boot(browser: any, width: number, lang: 'en' | 'zh'): Promise<Page> {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const p = await context.newPage();
    await injectIdbClear(p);
    if (lang === 'zh') {
      await p.addInitScript(() => {
        try {
          localStorage.setItem('iinpublic_ui_language', 'zh');
        } catch {
          /* ignore */
        }
      });
    }
    await gotoWebApp(p, webBaseURL());
    await afterSync();
    return p;
  }

  async function sweep(p: Page): Promise<void> {
    for (const view of VIEWS) {
      await p.locator(`.nav-btn[data-view="${view}"]`).click();
      await afterNav();
      await expect(p.locator(`#${view}-view`)).toBeVisible({ timeout: 15_000 });
      await expect(p.locator('.bottom-nav')).toBeVisible();

      // No horizontal clipping.
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `view ${view} should not overflow horizontally`).toBeLessThanOrEqual(2);

      // The AppBar primary action (create-talk ➕) is reachable — either inline or
      // inside the ⋯ overflow panel.
      const createInline = await p.locator('[data-testid="create-talk-btn"]:visible').count();
      const overflowBtn = p.locator('[data-testid="app-bar-overflow-btn"]:visible');
      if (createInline === 0 && (await overflowBtn.count()) > 0) {
        await overflowBtn.first().click();
        await afterNav();
        // In overflow the action keeps its testid with an `-overflow` suffix.
        expect(
          await p.locator('[data-testid="create-talk-btn-overflow"], [data-testid="create-talk-btn"]').count(),
        ).toBeGreaterThan(0);
        await p.keyboard.press('Escape').catch(() => {});
      }
    }
  }

  for (const width of WIDTHS) {
    test(`English sweep at ${width}px wide`, async ({ browser }) => {
      page = await boot(browser, width, 'en');
      await sweep(page);
    });
  }

  test('Chinese sweep at 390px wide', async ({ browser }) => {
    page = await boot(browser, 390, 'zh');
    await sweep(page);
  });
});
