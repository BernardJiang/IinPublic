/**
 * Settings: UI language and profile language selections persist after page.reload().
 * Switches UI language from en → zh, verifies UI labels change, reloads, and
 * verifies the language persists. Then switches back to en and verifies persistence again.
 * Also tests profile language persistence.
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

test.describe('Settings: language selections persist across reload', () => {
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

  test('UI language and profile language selections persist after reload', async () => {
    await bootstrapUser('LanguageSettingsTestUser');

    // Navigate to settings
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();

    const uiLanguageSelect = page.locator('#settings-ui-language');
    const profileLanguageSelect = page.locator('#settings-profile-languages');

    // === Change UI language from en to zh ===
    await expect(uiLanguageSelect).toHaveValue('en', { timeout: 5000 });
    await uiLanguageSelect.selectOption('zh');
    await afterSync();

    // Verify UI language changed - check that Chinese strings appear
    // Expected Chinese labels from 00y-chinese-ui-traversal.spec.ts:
    // 界面语言, 个人资料语言, etc.
    await expect(page.locator('#settings-content')).toContainText('界面语言', { timeout: 5000 });

    // Verify nav labels changed to Chinese
    const navLabels = ['聊天室', '联系人', '话题', '我的', '设置'];
    await expect(page.locator('.bottom-nav .nav-btn .nav-label')).toHaveText(navLabels, { timeout: 5000 });

    // === Reload and verify UI language persists ===
    await page.reload();
    await afterLoad();

    // Navigate back to settings
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();

    // Wait for settings content to render
    await page.waitForSelector('#settings-content > *', { timeout: 10000 });
    await afterLoad();

    // Re-query selectors after reload
    const uiLanguageSelectAfterReload = page.locator('#settings-ui-language');

    // Verify UI is still in Chinese
    await expect(page.locator('#settings-content')).toContainText('界面语言', { timeout: 5000 });
    await expect(page.locator('.bottom-nav .nav-btn .nav-label')).toHaveText(navLabels, { timeout: 5000 });

    // Verify UI language select still shows zh
    await expect(uiLanguageSelectAfterReload).toHaveValue('zh', { timeout: 5000 });

    // === Switch back to en and verify it persists ===
    await uiLanguageSelectAfterReload.selectOption('en');
    await uiLanguageSelectAfterReload.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await afterSync();

    // Verify UI changed back to English
    const enNavLabels = ['Chatrooms', 'Contacts', 'Talks', 'Me', 'Settings'];
    await expect(page.locator('.bottom-nav .nav-btn .nav-label')).toHaveText(enNavLabels, { timeout: 5000 });
    await expect(uiLanguageSelectAfterReload).toHaveValue('en', { timeout: 5000 });

    // Reload and verify en persists
    await page.reload();
    await afterLoad();

    // Navigate to settings
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();

    // Wait for settings content to render
    await page.waitForSelector('#settings-content > *', { timeout: 10000 });
    await afterLoad();

    // Re-query selectors after second reload
    const uiLanguageSelectFinal = page.locator('#settings-ui-language');

    // Verify UI is in English
    await expect(page.locator('.bottom-nav .nav-btn .nav-label')).toHaveText(enNavLabels, { timeout: 5000 });
    await expect(uiLanguageSelectFinal).toHaveValue('en', { timeout: 5000 });

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
