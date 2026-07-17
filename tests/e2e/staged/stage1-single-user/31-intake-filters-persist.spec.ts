/**
 * Settings: intake filter settings persist after page.reload().
 * Changes min/max distance, grammar/dirty words toggles,
 * talk type filters, and custom blocked terms. Verifies all changed values
 * are still present in the UI after reload.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, afterAction } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Settings: intake filters persist across reload', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless: true,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  async function bootstrapUser(stageName: string): Promise<void> {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    attachE2eBrowserTabLabel(page, stageName);
  }

  test('Intake filter settings persist after reload', async () => {
    await bootstrapUser('IntakeFiltersTestUser');

    // Navigate to settings
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();

    // Wait for settings to be fully rendered
    await page.waitForSelector('#settings-grammar-filter', { timeout: 10000 });
    await afterLoad();

    // === Change all settings from defaults ===

    // 1. Toggle grammar filter (default: true → false)
    const grammarCheckbox = page.locator('#settings-grammar-filter');
    let grammarChecked = await grammarCheckbox.isChecked();
    if (grammarChecked) {
      await grammarCheckbox.click();
      await grammarCheckbox.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await afterSync(); // Explicit sync after change
    }

    // 2. Toggle dirty words filter (default: true → false)
    const dirtyWordsCheckbox = page.locator('#settings-dirty-words-filter');
    let dirtyWordsChecked = await dirtyWordsCheckbox.isChecked();
    if (dirtyWordsChecked) {
      await dirtyWordsCheckbox.click();
      await dirtyWordsCheckbox.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await afterSync(); // Explicit sync after change
    }

    // 3. Set distance filters (defaults: min=0, max=50)
    const minDistanceInput = page.locator('#settings-min-distance');
    const maxDistanceInput = page.locator('#settings-max-distance');
    await minDistanceInput.fill('10');
    await minDistanceInput.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await afterSync();
    await maxDistanceInput.fill('25');
    await maxDistanceInput.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await afterSync();

    // 4. Change talk type filters (default: all checked → uncheck 'tag' and 'route')
    const tagTypeCheckbox = page.locator('.settings-talk-filter-type[value="tag"]');
    const routeTypeCheckbox = page.locator('.settings-talk-filter-type[value="route"]');

    let tagChecked = await tagTypeCheckbox.isChecked();
    if (tagChecked) {
      await tagTypeCheckbox.click();
      await tagTypeCheckbox.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await afterSync();
    }

    let routeChecked = await routeTypeCheckbox.isChecked();
    if (routeChecked) {
      await routeTypeCheckbox.click();
      await routeTypeCheckbox.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await afterSync();
    }

    // 5. Toggle allowed languages (default: ['en'] → add 'zh')
    const zhLanguageCheckbox = page.locator('.settings-filter-language-option[value="zh"]');
    if (!(await zhLanguageCheckbox.isChecked())) {
      await zhLanguageCheckbox.click();
      await zhLanguageCheckbox.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      await afterSync();
    }

    // 6. Add custom blocked terms (default: empty)
    const customBlockedInput = page.locator('#settings-custom-blocked');
    await customBlockedInput.fill('badword1, badword2');
    await customBlockedInput.evaluate((el: any) => el.dispatchEvent(new Event('input', { bubbles: true })));
    await afterSync();

    // Extra wait for all changes to be persisted
    await afterSync();

    // === Reload and verify all settings persist ===
    await page.reload();
    await afterLoad();

    // Navigate back to settings
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();

    // Wait for settings content to load
    await page.waitForSelector('#settings-content', { timeout: 10000 });
    await afterLoad();

    // Re-query selectors after reload
    const grammarAfterReload = page.locator('#settings-grammar-filter');
    const dirtyWordsAfterReload = page.locator('#settings-dirty-words-filter');
    const minDistanceAfterReload = page.locator('#settings-min-distance');
    const maxDistanceAfterReload = page.locator('#settings-max-distance');
    const customBlockedAfterReload = page.locator('#settings-custom-blocked');
    const tagTypeAfterReload = page.locator('.settings-talk-filter-type[value="tag"]');
    const routeTypeAfterReload = page.locator('.settings-talk-filter-type[value="route"]');
    const flowTypeAfterReload = page.locator('.settings-talk-filter-type[value="flow"]');
    const surveyTypeAfterReload = page.locator('.settings-talk-filter-type[value="survey"]');

    // Verify grammar filter is still unchecked
    await expect(grammarAfterReload).not.toBeChecked({ timeout: 5000 });

    // Verify dirty words filter is still unchecked
    await expect(dirtyWordsAfterReload).not.toBeChecked({ timeout: 5000 });

    // Verify distance filters persisted
    await expect(minDistanceAfterReload).toHaveValue('10', { timeout: 5000 });
    await expect(maxDistanceAfterReload).toHaveValue('25', { timeout: 5000 });

    // Verify talk type filters (tag and route should be unchecked, flow and survey checked)
    await expect(tagTypeAfterReload).not.toBeChecked({ timeout: 5000 });
    await expect(routeTypeAfterReload).not.toBeChecked({ timeout: 5000 });
    await expect(flowTypeAfterReload).toBeChecked({ timeout: 5000 });
    await expect(surveyTypeAfterReload).toBeChecked({ timeout: 5000 });

    // Verify allowed-languages selection persisted ('en' default plus added 'zh')
    await expect(page.locator('.settings-filter-language-option[value="zh"]')).toBeChecked({ timeout: 5000 });
    await expect(page.locator('.settings-filter-language-option[value="en"]')).toBeChecked({ timeout: 5000 });

    // Verify custom blocked terms persisted
    await expect(customBlockedAfterReload).toHaveValue('badword1, badword2', { timeout: 5000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
