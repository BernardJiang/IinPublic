/**
 * Platform smoke set (@smoke) — catalog Part 6 / TODO item G.
 *
 * A compact, single-browser pass that runs on desktop (chromium project) and on
 * the mobile device-profile projects (iphone-webkit, android-chromium) when
 * E2E_DEVICE_PROFILES=1. Covers the cross-platform-invariant surface:
 *   - tab sweep with no horizontal clipping (T2/T7)
 *   - AppBar ⋯ overflow reachability (T1/T2)
 *   - a full-screen-takeover dialog opens and closes (§8)
 *   - settings persistence across a reload (R2/R4)
 *
 * The two-user match round-trip and cross-platform presence live in the
 * cross-platform harness (X1/X2) and native-app suites — this file is the part
 * that is meaningful on a single emulated device.
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage1Spec } from '../helpers/e2e-stage-pipeline';
import { afterNav, afterSync, afterLoad } from '../helpers/timing';
import { webBaseURL } from '../helpers/ports';

const VIEWS = ['chatrooms', 'contacts', 'talks', 'me', 'settings'];

test.describe('@smoke platform smoke set', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterLoad();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('tab sweep, overflow, dialog takeover, settings persistence', async () => {
    const p = page!;

    // Tab sweep — no horizontal clipping, bottom nav present.
    for (const view of VIEWS) {
      await p.locator(`.nav-btn[data-view="${view}"]`).click();
      await afterNav();
      await expect(p.locator(`#${view}-view`)).toBeVisible({ timeout: 15000 });
      await expect(p.locator('.bottom-nav')).toBeVisible();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `view ${view} overflow`).toBeLessThanOrEqual(2);
    }

    // ⋯ overflow reachability: the create-talk action is reachable inline or via ⋯.
    await p.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    const createInline = await p.locator('[data-testid="create-talk-btn"]:visible').count();
    const overflowBtn = p.locator('[data-testid="app-bar-overflow-btn"]:visible');
    if (createInline === 0 && (await overflowBtn.count())) {
      await overflowBtn.first().click();
      await afterNav();
      expect(
        await p.locator('[data-testid="create-talk-btn-overflow"], [data-testid="create-talk-btn"]').count(),
      ).toBeGreaterThan(0);
      await p.keyboard.press('Escape').catch(() => {});
    }

    // A full-screen-takeover dialog (Talk Editor, size-xl) opens and closes.
    await p.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog?.());
    await afterNav();
    await expect(p.locator('#talk-editor-modal')).toBeVisible({ timeout: 8000 });
    await p.locator('#cancel-talk-btn').click();
    await afterNav();
    await expect(p.locator('#talk-editor-modal')).toHaveCount(0);

    // Settings persistence across reload: toggle the grammar filter, reload, verify.
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await p.waitForSelector('#settings-grammar-filter');
    const grammar = p.locator('#settings-grammar-filter');
    const was = await grammar.isChecked();
    await grammar.click();
    await grammar.dispatchEvent('change');
    await afterSync();
    await p.reload();
    await afterLoad();
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await p.waitForSelector('#settings-grammar-filter');
    await expect(p.locator('#settings-grammar-filter')).toBeChecked({ checked: !was });
  });
});
